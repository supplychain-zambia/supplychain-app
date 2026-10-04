import type { Config } from "@netlify/functions";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";
import postgres from "postgres";
import { AuthClaims, SyncBatch } from "@scsp/schema";

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

export default (req: Request) => app.fetch(req);
export const config: Config = { path: "/api/*" };
