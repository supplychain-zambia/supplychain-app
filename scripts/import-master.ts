// Usage: npm run import:master -- facilities.csv products.csv
// facilities.csv: code,name,level,parent_code   (level: national|province|district|facility; parents first or any order)
// products.csv:   code,name,dispensing_unit
import fs from "node:fs";
import postgres from "postgres";

const [facFile, prodFile] = process.argv.slice(2);
const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!facFile || !prodFile || !url) throw new Error("usage: import-master <facilities.csv> <products.csv> (needs DATABASE_URL_DIRECT)");

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); if (row.some((x) => x.trim())) rows.push(row); }
  const [head, ...body] = rows;
  const keys = head!.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const levels = ["national", "province", "district", "facility"];
const sql = postgres(url, { max: 1, onnotice: () => {} });

await sql.begin(async (tx) => {
  const units = parseCsv(fs.readFileSync(facFile, "utf8"));
  for (const level of levels) {
    for (const u of units.filter((x) => x.level === level)) {
      if (!u.code || !u.name) throw new Error(`Row missing code or name: ${JSON.stringify(u)}`);
      let parentId: string | null = null, parentPath = "";
      if (u.parent_code) {
        const [p] = await tx`select id, path from org_unit where code = ${u.parent_code}`;
        if (!p) throw new Error(`Parent "${u.parent_code}" not found for ${u.code}`);
        parentId = p.id as string; parentPath = (p.path as string) + ".";
      } else if (level !== "national") throw new Error(`${u.code} needs a parent_code`);
      await tx`insert into org_unit (parent_id, level, name, code, path)
               values (${parentId}, ${level}::org_level, ${u.name}, ${u.code}, ${parentPath + slug(u.code)})
               on conflict (code) do update set name = excluded.name`;
    }
  }
  const bad = units.filter((x) => !levels.includes(x.level ?? ""));
  if (bad.length) throw new Error(`Unknown level in rows: ${bad.map((b) => b.code).join(", ")}`);
  for (const p of parseCsv(fs.readFileSync(prodFile, "utf8"))) {
    if (!p.code || !p.name || !p.dispensing_unit) throw new Error(`Product row incomplete: ${JSON.stringify(p)}`);
    await tx`insert into product (code, name, dispensing_unit) values (${p.code}, ${p.name}, ${p.dispensing_unit})
             on conflict (code) do update set name = excluded.name, dispensing_unit = excluded.dispensing_unit`;
  }
});
console.log("master data imported");
await sql.end();
