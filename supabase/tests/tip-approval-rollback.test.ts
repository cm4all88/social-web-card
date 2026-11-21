/**
 * The owner-approval migration is additive and its rollback restores the
 * schema exactly: same columns, same function bodies, same grants, data kept.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const MIGRATION = "20261121220000_tip_owner_approval";
const snapshot = async (db: PGlite) => {
  const cols = await db.query<{ c: string }>(
    `SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) AS c
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'account_status'`,
  );
  const fns = await db.query<{ f: string }>(
    `SELECT string_agg(p.proname || '=' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl, ' '), ''), ',' ORDER BY p.proname) AS f
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`,
  );
  return { cols: cols.rows[0].c, fns: fns.rows[0].f };
};

describe("tip owner approval migration", () => {
  it("is additive, keeps existing rows, defaults to not approved, and rolls back exactly", async () => {
    const all = migrationSql();
    const idx = all.findIndex((s) => s.includes("owner_set_tips_approved") && s.includes("ADD COLUMN tips_approved_at"));
    expect(idx).toBeGreaterThan(-1);
    const db = new PGlite();
    await db.exec(SUPABASE_STUBS);
    await db.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
    for (const sql of all.slice(0, idx)) await db.exec(sql);
    await db.exec(SUPABASE_GRANTS);
    const uid = "00000000-0000-4000-8000-0000000000b1";
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'b@example.test', '{"username":"bee"}')`, [uid]);
    await db.query(`INSERT INTO account_status (user_id, tips_disabled_at, tips_disabled_reason) VALUES ($1, now(), 'kept')`, [uid]);
    const before = await snapshot(db);

    await db.exec(all[idx]);
    const row = await db.query<{ tips_disabled_reason: string; tips_approved_at: string | null }>(
      `SELECT tips_disabled_reason, tips_approved_at FROM account_status WHERE user_id = $1`,
      [uid],
    );
    expect(row.rows[0]).toEqual({ tips_disabled_reason: "kept", tips_approved_at: null });
    const approved = await db.query<{ a: boolean }>(`SELECT public.tips_approved($1) AS a`, [uid]);
    expect(approved.rows[0].a).toBe(false);
    // The rewritten audit trigger still works for an INSERT and an UPDATE.
    const other = "00000000-0000-4000-8000-0000000000b2";
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'c@example.test', '{"username":"cee"}')`, [other]);
    await db.query(`INSERT INTO account_status (user_id, suspended_at, suspended_reason) VALUES ($1, now(), 'test')`, [other]);
    await db.query(`UPDATE account_status SET suspended_at = NULL WHERE user_id = $1`, [other]);
    const audit = await db.query<{ action: string }>(`SELECT action FROM admin_audit_log WHERE target_id = $1 ORDER BY id`, [other]);
    expect(audit.rows.map((r) => r.action)).toEqual(["account.suspended", "account.reactivated"]);

    const down = readFileSync(new URL(`../rollbacks/${MIGRATION}.down.sql`, import.meta.url), "utf8");
    await db.exec(down);
    expect(await snapshot(db)).toEqual(before);
    const kept = await db.query<{ tips_disabled_reason: string }>(`SELECT tips_disabled_reason FROM account_status WHERE user_id = $1`, [uid]);
    expect(kept.rows[0].tips_disabled_reason).toBe("kept");
    await db.close();
  }, 60_000);
});
