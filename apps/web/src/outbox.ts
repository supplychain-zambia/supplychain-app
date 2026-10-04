import { StockEventInput } from "@scsp/schema";

const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open("scsp", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("outbox", { keyPath: "clientId" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const req = f(db.transaction("outbox", mode).objectStore("outbox"));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const pending = () => run("readonly", (s) => s.getAll() as IDBRequest<StockEventInput[]>);
export const remove = (id: string) => run("readwrite", (s) => s.delete(id));

/** Validates with the same schema as the server, then stores locally. Works with no signal. */
export async function queue(e: StockEventInput): Promise<string | null> {
  const parsed = StockEventInput.safeParse(e);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid entry";
  await run("readwrite", (s) => s.put(parsed.data));
  return null;
}
