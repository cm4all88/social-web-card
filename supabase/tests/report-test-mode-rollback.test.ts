/**
 * The reports-exclude-test-mode migration changes only two report functions,
 * and its rollback puts back exactly the earlier definitions and grants.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const fns = async (db: PGlite) =>
  (
    await db.query<{ f: string }>(
      `SELECT string_agg(p.proname || '=' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl, ' '), ''), ',' ORDER BY p.proname) AS f
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`,
    )
  ).rows[0].f;
const cols = async (db: PGlite) =>
  (
    await db.query<{ c: string }>(
      `SELECT string_agg(table_name || '.' || column_name, ',' ORDER BY table_name, ordinal_position) AS c
         FROM information_schema.columns WHERE table_schema = 'public'`,
    )
  ).rows[0].c;

describe("reports exclude test mode migration", () => {
  it("touches only the two reports and rolls back exactly", async () => {
    const all = migrationSql();
    const idx = all.findIndex((s) => s.includes("'test_connected_creators'"));
    expect(idx).toBeGreaterThan(-1);
    const db = new PGlite();
    await db.exec(SUPABASE_STUBS);
    await db.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
    for (const sql of all.slice(0, idx)) await db.exec(sql);
    await db.exec(SUPABASE_GRANTS);
    const fBefore = await fns(db);
    const cBefore = await cols(db);

    await db.exec(all[idx]);
    const changed = (await fns(db)).split(",").filter((x) => !fBefore.split(",").includes(x)).map((x) => x.split("=")[0]);
    expect(changed.sort()).toEqual(["admin_tip_report", "owner_overview"]);
    expect(await cols(db)).toBe(cBefore);

    await db.exec(
      readFileSync(new URL("../rollbacks/20261121233000_reports_exclude_test_mode.down.sql", import.meta.url), "utf8"),
    );
    expect(await fns(db)).toBe(fBefore);
    await db.close();
  }, 60_000);
});
