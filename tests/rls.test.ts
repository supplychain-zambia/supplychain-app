import postgres from "postgres";
import { beforeAll, describe, expect, it } from "vitest";

// Runs only when a migrated database is available (CI provides one).
const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : (null as unknown as postgres.Sql);
const tag = Math.random().toString(16).slice(2, 8);

const ids = {} as Record<string, string>;

async function asScope<T>(scope: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return (await sql.begin(async (tx) => {
    await tx`set local role scsp_app`;
    await tx`select set_config('app.scope_unit', ${scope}, true)`;
    return fn(tx);
  })) as T;
}

describe.skipIf(!url)("row-level security and immutability", () => {
  beforeAll(async () => {
    const unit = async (key: string, level: string, parent: string | null, path: string) => {
      const [r] = await sql`insert into org_unit (parent_id, level, name, path)
        values (${parent}, ${level}::org_level, ${key}, ${path}) returning id`;
      ids[key] = r!.id as string;
    };
    await unit("nat", "national", null, `t${tag}`);
    await unit("distA", "district", ids.nat!, `t${tag}.a`);
    await unit("distB", "district", ids.nat!, `t${tag}.b`);
    await unit("facA", "facility", ids.distA!, `t${tag}.a.f1`);
    await unit("facB", "facility", ids.distB!, `t${tag}.b.f1`);
    const [p] = await sql`insert into product (code, name, dispensing_unit) values (${"P" + tag}, 'Test product', 'bottle') returning id`;
    ids.prod = p!.id as string;
  });

  const insertEvent = (tx: postgres.TransactionSql, facility: string) =>
    tx`insert into stock_event (client_id, facility_id, product_id, event_type, quantity, occurred_on)
       values (gen_random_uuid(), ${facility}, ${ids.prod!}, 'dispense', 5, current_date)`;

  it("lets a facility write inside its own scope", async () => {
    await asScope(ids.facA!, (tx) => insertEvent(tx, ids.facA!));
  });

  it("blocks writes to a facility in another district", async () => {
    await expect(asScope(ids.distA!, (tx) => insertEvent(tx, ids.facB!))).rejects.toMatchObject({ code: "42501" });
  });

  it("hides other districts' rows and shows own", async () => {
    const own = await asScope(ids.distA!, (tx) => tx`select count(*)::int as n from stock_event where product_id = ${ids.prod!}`);
    const other = await asScope(ids.distB!, (tx) => tx`select count(*)::int as n from stock_event where product_id = ${ids.prod!}`);
    expect(own[0]!.n).toBe(1);
    expect(other[0]!.n).toBe(0);
  });

  it("national scope sees everything below it", async () => {
    const all = await asScope(ids.nat!, (tx) => tx`select count(*)::int as n from stock_event where product_id = ${ids.prod!}`);
    expect(all[0]!.n).toBe(1);
  });

  it("refuses updates and deletes on the ledger", async () => {
    await expect(sql`update stock_event set quantity = 1 where product_id = ${ids.prod!}`).rejects.toThrow(/append-only/);
    await expect(sql`delete from stock_event where product_id = ${ids.prod!}`).rejects.toThrow(/append-only/);
  });
});
