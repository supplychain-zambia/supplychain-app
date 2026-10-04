import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL_DIRECT (preferred) or DATABASE_URL");

const sql = postgres(url, { max: 1, onnotice: () => {} });
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(file)) continue;
  console.log("applying", file);
  await sql.begin(async (tx) => {
    await tx.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
    await tx`insert into schema_migrations (name) values (${file})`;
  });
}
await sql.end();
console.log("migrations up to date");
