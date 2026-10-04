import type { Config } from "@netlify/functions";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";
import postgres from "postgres";
import { SignJWT } from "jose";
import { AuthClaims, ChangePasswordInput, LoginInput, NewUserInput, SyncBatch } from "@scsp/schema";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./lib/password";

const g = globalThis as { Netlify?: { env: { get(k: string): string | undefined } } };
const env = (k: string) => g.Netlify?.env.get(k) ?? process.env[k];

// Pooled connection, one connection per function instance (serverless-safe).
let _sql: postgres.Sql | undefined;
const db = () => (_sql ??= postgres(env("DATABASE_URL") as string, { max: 1, prepare: false }));

/** Run a transaction as the low-privilege role, scoped to the caller's organisational unit (RLS). */
async function withScope<T>(scopeUnit: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return (await db().begin(async (tx) => {
    await tx`set local role scsp_app`;
    await tx`select set_config('app.scope_unit', ${scopeUnit}, true)`;
    return fn(tx);
  })) as T;
}

type AppEnv = { Variables: { user: AuthClaims } };

const auth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return c.json({ error: "unauthorized" }, 401);
  try {
    const secret = env("JWT_SECRET");
    if (!secret || secret.length < 32) throw new Error("JWT_SECRET not configured");
    const { payload } = await jwtVerify(header.slice(7), new TextEncoder().encode(secret), {
      issuer: env("JWT_ISSUER") ?? "scsp",
      algorithms: ["HS256"],
    });
    c.set("user", AuthClaims.parse(payload));
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

const app = new Hono<AppEnv>();

app.get("/api/health", async (c) => {
  try {
    await db()`select 1`;
    return c.json({ status: "ok", time: new Date().toISOString() });
  } catch {
    return c.json({ status: "degraded" }, 503);
  }
});

app.get("/api/me", auth, (c) => c.json(c.get("user")));

/**
 * Idempotent offline sync. Safe to retry: events already stored (same clientId) are skipped.
 * Row-level security rejects events for facilities outside the caller's scope.
 */
app.post("/api/sync/events", auth, async (c) => {
  const user = c.get("user");
  if (user.role !== "facility" && user.role !== "admin") return c.json({ error: "forbidden" }, 403);

  const parsed = SyncBatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_batch", issues: parsed.error.issues }, 400);
  const { events } = parsed.data;

  try {
    const stored = await withScope(user.scope, async (tx) => {
      const rows = events.map((e) => ({
        client_id: e.clientId,
        facility_id: e.facilityId,
        product_id: e.productId,
        event_type: e.type,
        quantity: e.quantity,
        reason_code: e.reasonCode ?? null,
        batch_no: e.batchNo ?? null,
        expiry_date: e.expiryDate ?? null,
        occurred_on: e.occurredOn,
        recorded_by: user.sub,
        device_id: e.deviceId ?? null,
      }));
      const inserted = await tx`
        insert into stock_event ${tx(rows)}
        on conflict (client_id) do nothing
        returning client_id`;
      await tx`insert into audit_log (actor, action, detail)
               values (${user.sub}, 'sync_events', ${tx.json({ received: events.length, stored: inserted.length })})`;
      return inserted.length;
    });
    return c.json({ received: events.length, stored, duplicates: events.length - stored });
  } catch (err) {
    if ((err as { code?: string }).code === "42501") return c.json({ error: "out_of_scope" }, 403);
    console.error("sync failed", (err as Error).message);
    return c.json({ error: "server_error" }, 500);
  }
});

const secretKey = () => {
  const s = env("JWT_SECRET");
  if (!s || s.length < 32) throw new Error("JWT_SECRET not configured");
  return new TextEncoder().encode(s);
};

app.post("/api/auth/login", async (c) => {
  const p = LoginInput.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid" }, 400);
  const [u] = await db()`select id, role, org_unit_id, password_hash, locked_until, active, must_change_password
                         from app_user where email = ${p.data.email.toLowerCase()}`;
  const locked = !!u?.locked_until && new Date(u.locked_until) > new Date();
  const passwordOk = verifyPassword(p.data.password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !passwordOk || locked || !u.active) {
    if (u && !locked) {
      await db()`update app_user set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
        where id = ${u.id}`;
    }
    return c.json({ error: "invalid_credentials" }, 401); // same answer for every failure
  }
  await db()`update app_user set failed_attempts = 0, locked_until = null where id = ${u.id}`;
  const token = await new SignJWT({ role: u.role, scope: u.org_unit_id })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuer(env("JWT_ISSUER") ?? "scsp")
    .setExpirationTime("12h")
    .sign(secretKey());
  return c.json({ token, role: u.role, scope: u.org_unit_id, mustChangePassword: u.must_change_password });
});

app.post("/api/auth/change-password", auth, async (c) => {
  const p = ChangePasswordInput.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid", issues: p.error.issues }, 400);
  const [u] = await db()`select password_hash from app_user where id = ${c.get("user").sub}`;
  if (!u || !verifyPassword(p.data.oldPassword, u.password_hash)) return c.json({ error: "invalid_credentials" }, 401);
  await db()`update app_user set password_hash = ${hashPassword(p.data.newPassword)}, must_change_password = false
             where id = ${c.get("user").sub}`;
  await db()`insert into audit_log (actor, action) values (${c.get("user").sub}, 'password_changed')`;
  return c.json({ ok: true });
});

app.post("/api/admin/users", auth, async (c) => {
  const admin = c.get("user");
  if (admin.role !== "admin") return c.json({ error: "forbidden" }, 403);
  const p = NewUserInput.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "invalid", issues: p.error.issues }, 400);
  try {
    const [u] = await db()`insert into app_user (email, role, org_unit_id, password_hash)
      values (${p.data.email.toLowerCase()}, ${p.data.role}::user_role, ${p.data.orgUnitId}, ${hashPassword(p.data.password)})
      returning id`;
    await db()`insert into audit_log (actor, action, detail)
      values (${admin.sub}, 'user_created', ${db().json({ userId: u!.id, role: p.data.role })})`;
    return c.json({ id: u!.id }, 201);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return c.json({ error: "email_exists" }, 409);
    return c.json({ error: "server_error" }, 500);
  }
});

/** Facilities in the caller's scope plus the product list: what the capture app caches for offline use. */
app.get("/api/context", auth, async (c) => {
  const user = c.get("user");
  const data = await withScope(user.scope, async (tx) => ({
    facilities: await tx`select id, code, name from org_unit where level = 'facility' and active and in_scope(id) order by name`,
    products: await tx`select id, code, name, dispensing_unit as unit from product where active order by name`,
  }));
  return c.json(data);
});

export default (req: Request) => app.fetch(req);
export const config: Config = { path: "/api/*" };
