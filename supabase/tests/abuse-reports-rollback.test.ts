/**
 * The abuse reports migration only adds: existing tables, columns, functions
 * and rows are unchanged, and its rollback puts the schema back exactly.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const one = async (db: PGlite, q: string) => (await db.query<{ v: string }>(q)).rows[0].v;
const fns = (db: PGlite) =>
  one(
    db,
    `SELECT string_agg(p.proname || '=' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl, ' '), ''), ',' ORDER BY p.proname, p.oid) AS v
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`,
  );
const cols = (db: PGlite) =>
  one(
    db,
    `SELECT string_agg(table_name || '.' || column_name || ':' || data_type, ',' ORDER BY table_name, ordinal_position) AS v
       FROM information_schema.columns WHERE table_schema = 'public'`,
  );
const policies = (db: PGlite) =>
  one(db, `SELECT coalesce(string_agg(tablename || '.' || policyname || ':' || md5(coalesce(qual,'') || coalesce(with_check,'')), ',' ORDER BY tablename, policyname), '') AS v FROM pg_policies WHERE schemaname = 'public'`);
async function rows(db: PGlite) {
  const tables = (
    await db.query<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)
  ).rows.map((r) => r.t);
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = await one(db, `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS v FROM public.${t} x`);
  return out;
}

describe("abuse reports migration", () => {
  it("adds only the reports table and its functions, keeps every row, and rolls back exactly", async () => {
    const all = migrationSql();
    const idx = all.findIndex((s) => s.includes("CREATE TABLE public.abuse_reports"));
    expect(idx).toBeGreaterThan(-1);
    const db = new PGlite();
    await db.exec(SUPABASE_STUBS);
    await db.exec(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz, ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz`);
    for (const sql of all.slice(0, idx)) await db.exec(sql);
    await db.exec(SUPABASE_GRANTS);

    // Some existing data: two accounts with profiles, links and a wishlist.
    for (const [id, u] of [
      ["00000000-0000-4000-8000-0000000000a1", "alice"],
      ["00000000-0000-4000-8000-0000000000b1", "bob"],
    ]) {
      await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
        id,
        `${u}@example.test`,
        JSON.stringify({ username: u }),
      ]);
      await db.query(
        `INSERT INTO public.social_links (user_id, platform, url, display_order) VALUES ($1, 'instagram', 'https://instagram.com/' || $2, 0)`,
        [id, u],
      );
    }
    await db.query(
      `INSERT INTO public.wishlists (user_id, slug, title) VALUES ('00000000-0000-4000-8000-0000000000a1', 'bday', 'Birthday')`,
    );

    const before = { f: await fns(db), c: await cols(db), p: await policies(db), r: await rows(db) };
    expect(Object.keys(before.r)).not.toContain("abuse_reports");

    await db.exec(all[idx]);
    await db.exec(SUPABASE_GRANTS);
    const after = await rows(db);
    for (const [t, h] of Object.entries(before.r)) expect(after[t], t).toBe(h);
    expect(Object.keys(after)).toContain("abuse_reports");
    const added = (await fns(db)).split(",").filter((x) => !before.f.split(",").includes(x)).map((x) => x.split("=")[0]);
    expect(added.sort()).toEqual([
      "owner_list_reports",
      "owner_open_report_count",
      "owner_resolve_report",
      "record_abuse_report",
    ]);
    const colsNow = (await cols(db)).split(",").filter((x) => !before.c.split(",").includes(x));
    expect(colsNow.every((c) => c.startsWith("abuse_reports."))).toBe(true);
    expect(await policies(db)).toBe(before.p);

    await db.exec(readFileSync(new URL("../rollbacks/20261121234000_abuse_reports.down.sql", import.meta.url), "utf8"));
    expect(await fns(db)).toBe(before.f);
    expect(await cols(db)).toBe(before.c);
    expect(await policies(db)).toBe(before.p);
    expect(await rows(db)).toEqual(before.r);
    await db.close();
  }, 90_000);
});
