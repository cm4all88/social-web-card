/**
 * Owner-only "assign protected username": the brand and reserved-name block
 * stays for everyone, only an admin through owner_assign_username gets past
 * it, site paths are refused even then, and every assignment is logged.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BRAND = "00000000-0000-4000-8000-0000000000b1";
const MIG = "20261123040000_owner_assign_username";

let db: PGlite;
const svc = <T = Record<string, unknown>>(q: string, p: unknown[] = []) => db.query<T>(q, p).then((r) => r.rows);
async function as<T = Record<string, unknown>>(who: string | null, q: string, p: unknown[] = []) {
  await db.exec(who ? `SET request.jwt.claim.sub = '${who}'; SET ROLE authenticated;` : "SET ROLE anon;");
  try {
    return (await db.query<T>(q, p)).rows;
  } finally {
    await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
  }
}
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => String(e.message),
  );
const signUp = (id: string, username: string) =>
  svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
const name = async (id: string) => (await svc<{ u: string }>(`SELECT username AS u FROM profiles WHERE user_id = $1`, [id]))[0].u;
const assign = (who: string, id: string, u: string, why = "Official Yooits account") =>
  as(who, `SELECT public.owner_assign_username($1, $2, $3)`, [id, u, why]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  await signUp(OWNER, "boss");
  await signUp(ALICE, "alice");
  await signUp(BRAND, "tempbrand");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
}, 60_000);

afterAll(() => db?.close());

describe("protected usernames", () => {
  it("stay blocked at sign-up and on ordinary renames, admin included", async () => {
    expect(await fails(signUp("00000000-0000-4000-8000-0000000000c1", "yooits"))).toMatch(/reserved/);
    expect(await fails(as(ALICE, `UPDATE profiles SET username = 'yooits' WHERE user_id = $1`, [ALICE]))).toMatch(/reserved/);
    expect(await fails(as(OWNER, `UPDATE profiles SET username = 'yooits' WHERE user_id = $1`, [OWNER]))).toMatch(/reserved/);
    // Setting the switch yourself doesn't help a non-admin.
    await db.exec(`SET request.jwt.claim.sub = '${ALICE}'; SET ROLE authenticated; SET yooits.owner_username = 'yooits';`);
    const err = await db.query(`UPDATE profiles SET username = 'yooits' WHERE user_id = $1`, [ALICE]).then(
      () => null,
      (e: Error) => e.message,
    );
    await db.exec("RESET yooits.owner_username; RESET ROLE; RESET request.jwt.claim.sub;");
    expect(err).toMatch(/reserved/);
    expect(await name(ALICE)).toBe("alice");
  });

  it("can be assigned by an admin through the owner action, logged", async () => {
    expect(await fails(assign(ALICE, BRAND, "yooits"))).toMatch(/Not authorized/);
    expect(await fails(as(null, `SELECT public.owner_assign_username($1, 'yooits', 'x')`, [BRAND]))).toMatch(/permission denied/);
    expect(await fails(assign(OWNER, BRAND, "yooits", ""))).toMatch(/reason/);
    expect(await fails(assign(OWNER, BRAND, "Yoo Its"))).toMatch(/2 to 30/);
    expect(await fails(assign(OWNER, BRAND, "owner"))).toMatch(/page on the site/);
    expect(await fails(assign(OWNER, BRAND, "alice"))).toMatch(/already has/);

    const [{ r }] = await as<{ r: Record<string, unknown> }>(OWNER, `SELECT public.owner_assign_username($1, ' YOOITS ', 'Official Yooits account') AS r`, [BRAND]);
    expect(r).toMatchObject({ old_username: "tempbrand", username: "yooits", changed: true, protected: true });
    expect(await name(BRAND)).toBe("yooits");
    const [log] = await svc<{ details: Record<string, unknown> }>(`SELECT details FROM admin_audit_log WHERE action = 'user.username_assigned'`);
    expect(log.details).toEqual({ from: "tempbrand", to: "yooits", protected: true, reason: "Official Yooits account" });

    // The switch doesn't linger: the next ordinary rename in the same session is checked again.
    expect(await fails(as(OWNER, `UPDATE profiles SET username = 'yooitsme' WHERE user_id = $1`, [OWNER]))).toMatch(/reserved/);
    // The account owner can still rename away from it, and nobody else can take it.
    expect(await fails(signUp("00000000-0000-4000-8000-0000000000c2", "yooits"))).not.toBeNull();
  });
});

describe("rollback", () => {
  it("restores the functions exactly", async () => {
    const files = migrationSql();
    const all = readdirSync(join(__dirname, "..", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const idx = all.indexOf(`${MIG}.sql`);
    expect(idx).toBeGreaterThan(-1);
    const fresh = new PGlite();
    try {
      await fresh.exec(SUPABASE_STUBS);
      await fresh.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
      for (const sql of files.slice(0, idx)) await fresh.exec(sql);
      const snap = async () =>
        (
          await fresh.query<{ f: string }>(
            `SELECT string_agg(p.proname || '=' || md5(p.prosrc), ',' ORDER BY p.proname, p.oid) AS f
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`,
          )
        ).rows[0].f;
      const before = await snap();
      await fresh.exec(files[idx]);
      expect(await snap()).not.toEqual(before);
      await fresh.exec(readFileSync(join(__dirname, "..", "rollbacks", `${MIG}.down.sql`), "utf8"));
      expect(await snap()).toEqual(before);
    } finally {
      await fresh.close();
    }
  }, 60_000);
});
