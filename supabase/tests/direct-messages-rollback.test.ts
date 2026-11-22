/**
 * The direct messages migration keeps every existing row, and its rollback
 * puts the schema (functions, columns, constraints, policies) back exactly.
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
const cons = (db: PGlite) =>
  one(
    db,
    `SELECT string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), ',' ORDER BY conrelid::regclass::text, conname) AS v
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace`,
  );
const policies = (db: PGlite) =>
  one(
    db,
    `SELECT coalesce(string_agg(tablename || '.' || policyname || ':' || md5(coalesce(qual,'') || coalesce(with_check,'')), ',' ORDER BY tablename, policyname), '') AS v FROM pg_policies WHERE schemaname = 'public'`,
  );
async function rows(db: PGlite) {
  const tables = (
    await db.query<{ t: string }>(
      `SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    )
  ).rows.map((r) => r.t);
  const out: Record<string, string> = {};
  for (const t of tables)
    out[t] = await one(
      db,
      `SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS v FROM public.${t} x`,
    );
  return out;
}

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";

describe("direct messages migration", () => {
  it("keeps every row and rolls back exactly", async () => {
    const all = migrationSql();
    const idx = all.findIndex((s) => s.includes("CREATE TABLE public.dm_messages"));
    expect(idx).toBeGreaterThan(-1);
    const db = new PGlite();
    await db.exec(SUPABASE_STUBS);
    await db.exec(
      `ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz, ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz`,
    );
    for (const sql of all.slice(0, idx)) await db.exec(sql);
    await db.exec(SUPABASE_GRANTS);
    for (const [id, u] of [
      [A, "alice"],
      [B, "bob"],
    ]) {
      await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
        id,
        `${u}@example.test`,
        JSON.stringify({ username: u }),
      ]);
    }
    await db.query(
      `SELECT public.record_abuse_report('alice', NULL, 'spam', 'x', NULL, NULL, 'ip')`,
    );

    const before = {
      f: await fns(db),
      c: await cols(db),
      k: await cons(db),
      p: await policies(db),
      r: await rows(db),
    };

    await db.exec(all[idx]);
    for (const sql of all.slice(idx + 1)) await db.exec(sql);
    const after = await rows(db);
    // abuse_reports rows gain two empty columns; every other table is untouched.
    for (const [t, h] of Object.entries(before.r))
      if (t !== "abuse_reports") expect(after[t], t).toBe(h);
    expect(
      await one(
        db,
        `SELECT count(*)::text AS v FROM abuse_reports WHERE message_id IS NULL AND message_excerpt IS NULL AND target_kind = 'profile'`,
      ),
    ).toBe("1");

    // Some messaging data, including a message report, then roll back.
    await db.exec(`
      UPDATE messaging_settings SET enabled = true;
      INSERT INTO dm_settings (user_id, mode, adult_confirmed_at) VALUES ('${A}', 'everyone', now()), ('${B}', 'everyone', now());`);
    await db.exec(`SET request.jwt.claim.sub = '${A}'; SET ROLE authenticated;`);
    await db.query(`SELECT public.dm_start('bob', 'hello')`);
    await db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${B}'; SET ROLE authenticated;`);
    const m = (await db.query<{ id: string }>(`SELECT id FROM dm_messages`)).rows[0].id;
    await db.query(`SELECT public.dm_report_message($1, 'spam')`, [m]);
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
    expect(await one(db, `SELECT count(*)::text AS v FROM abuse_reports`)).toBe("2");

    await db.exec(
      readFileSync(
        new URL("../rollbacks/20261122140000_direct_messages.down.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(await fns(db)).toBe(before.f);
    expect(await cols(db)).toBe(before.c);
    expect(await cons(db)).toBe(before.k);
    expect(await policies(db)).toBe(before.p);
    expect(await rows(db)).toEqual(before.r);
    await db.close();
  }, 90_000);
});
