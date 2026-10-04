import { pending, remove } from "./outbox";

const KEY = "scsp.session";
export interface Session { token: string; role: string; scope: string; mustChangePassword: boolean }
export const getSession = (): Session | null => JSON.parse(localStorage.getItem(KEY) ?? "null");
export const logout = () => { localStorage.removeItem(KEY); };

async function call(path: string, body?: unknown) {
  const s = getSession();
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(s ? { authorization: `Bearer ${s.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && s) logout();
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

export async function login(email: string, password: string): Promise<boolean> {
  const { status, data } = await call("/api/auth/login", { email, password });
  if (status === 200) localStorage.setItem(KEY, JSON.stringify(data));
  return status === 200;
}
export const changePassword = (oldPassword: string, newPassword: string) =>
  call("/api/auth/change-password", { oldPassword, newPassword });

export interface Context { facilities: { id: string; name: string }[]; products: { id: string; name: string; unit: string }[] }
export async function loadContext(): Promise<Context | null> {
  const { status, data } = await call("/api/context");
  if (status === 200) localStorage.setItem("scsp.context", JSON.stringify(data)); // cached for offline use
  return status === 200 ? data : JSON.parse(localStorage.getItem("scsp.context") ?? "null");
}

/** Sends queued events in batches of 200. Events leave the outbox only once the server has them. */
export async function sync(): Promise<{ sent: number; left: number; error?: string }> {
  const all = await pending();
  let sent = 0;
  for (let i = 0; i < all.length; i += 200) {
    const batch = all.slice(i, i + 200);
    let res;
    try { res = await call("/api/sync/events", { events: batch }); }
    catch { return { sent, left: all.length - sent, error: "No connection. Entries are saved and will send later." }; }
    if (res.status !== 200) return { sent, left: all.length - sent, error: `Server refused the batch (${res.status}).` };
    for (const e of batch) await remove(e.clientId);
    sent += batch.length;
  }
  return { sent, left: 0 };
}
