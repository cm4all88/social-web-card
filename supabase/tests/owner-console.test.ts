/**
 * Owner console migration: audit log and owner_* functions, on in-memory
 * Postgres with every real migration applied. No network, no Supabase project.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b1";

let db: PGlite;
const svc = (sql: string, params: unknown[] = []) => db.query(sql, params);

async function asUser<T = Record<string, unknown>>(who: string, sql: string, params: unknown[] = []) {
  await db.exec(`SET request.jwt.claim.sub = '${who}'; SET ROLE authenticated;`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
  }
}
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => String(e.message),
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  // Real auth.users has these; the shared stub doesn't.
  await db.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  for (const [id, name, display, confirmed] of [
    [OWNER, "boss", "Boss", true],
    [ALICE, "alice", "Alice 100%", false],
    [BOB, "bob", "Bob", true],
  ] as const) {
    await svc(
      `INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES ($1, $2, $3, $4)`,
      [id, `${name}@example.test`, JSON.stringify({ username: name, display_name: display }), confirmed ? new Date().toISOString() : null],
    );
  }
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
  await svc(`INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://alice.example', $1)`, [ALICE]);
  await svc(
    `INSERT INTO creator_payment_accounts (user_id, stripe_account_id, status, charges_enabled) VALUES ($1, 'acct_a', 'connected', true)`,
    [ALICE],
  );
}, 60_000);

afterAll(() => db?.close());

describe("owner functions", () => {
  it("refuse anyone who isn't an admin", async () => {
    for (const sql of [
      "SELECT public.owner_overview()",
      "SELECT * FROM public.owner_list_users()",
      `SELECT public.owner_get_user('${OWNER}')`,
      "SELECT * FROM public.owner_audit_log()",
    ]) {
      expect(await fails(asUser(BOB, sql))).toMatch(/Not authorized/);
    }
  });

  it("are not callable signed out", async () => {
    await db.exec("SET ROLE anon;");
    try {
      expect(await fails(db.query("SELECT public.owner_overview()"))).toMatch(/permission denied/);
    } finally {
      await db.exec("RESET ROLE;");
    }
  });

  it("give the admin headline numbers", async () => {
    const [{ o }] = await asUser<{ o: Record<string, number> }>(OWNER, "SELECT public.owner_overview() AS o");
    expect(o).toMatchObject({
      total_users: 3,
      signups_7d: 3,
      unconfirmed_emails: 1,
      profiles_with_links: 1,
      admins: 1,
      connected_creators: 1,
      tipping_suspended: 0,
    });
  });

  it("list and search users, matching % literally", async () => {
    const all = await asUser<{ username: string; total_count: number; is_admin: boolean }>(
      OWNER,
      "SELECT * FROM public.owner_list_users()",
    );
    expect(all).toHaveLength(3);
    expect(Number(all[0].total_count)).toBe(3);
    expect(all.find((u) => u.username === "boss")?.is_admin).toBe(true);

    const pct = await asUser<{ username: string }>(OWNER, "SELECT * FROM public.owner_list_users('100%')");
    expect(pct.map((u) => u.username)).toEqual(["alice"]);
    // "_" would match any single character as a LIKE wildcard; nobody has a literal "_".
    const wildcard = await asUser(OWNER, "SELECT * FROM public.owner_list_users('_')");
    expect(wildcard).toHaveLength(0);
    const byEmail = await asUser<{ username: string }>(OWNER, "SELECT * FROM public.owner_list_users('bob@')");
    expect(byEmail.map((u) => u.username)).toEqual(["bob"]);
  });

  it("page users and cap the page size", async () => {
    const page = await asUser(OWNER, "SELECT * FROM public.owner_list_users(NULL, 2, 2)");
    expect(page).toHaveLength(1);
    const capped = await asUser(OWNER, "SELECT * FROM public.owner_list_users(NULL, 100000, 0)");
    expect(capped).toHaveLength(3);
  });

  it("return one user's details, and null for an unknown id", async () => {
    const [{ u }] = await asUser<{ u: Record<string, unknown> }>(
      OWNER,
      "SELECT public.owner_get_user($1) AS u",
      [ALICE],
    );
    expect(u).toMatchObject({
      email: "alice@example.test",
      email_confirmed: false,
      roles: ["user"],
      links: [{ platform: "website", url: "https://alice.example", enabled: true }],
      wishlists: 0,
      tipping: { status: "connected", charges_enabled: true, suspended_at: null },
    });
    const [{ none }] = await asUser<{ none: unknown }>(
      OWNER,
      "SELECT public.owner_get_user('00000000-0000-4000-8000-000000000000') AS none",
    );
    expect(none).toBeNull();
  });
});

describe("audit log", () => {
  it("records admin grants and revokes but not ordinary signups", async () => {
    const { rows } = await svc(`SELECT action, target_id FROM admin_audit_log ORDER BY id`);
    expect(rows).toEqual([{ action: "role.granted", target_id: OWNER }]);
  });

  it("records invites without the code, with the admin as actor", async () => {
    const [inv] = await asUser<{ id: string }>(
      OWNER,
      `INSERT INTO invites (code, created_by) VALUES ('secretcode1', $1) RETURNING id`,
      [OWNER],
    );
    await asUser(OWNER, `DELETE FROM invites WHERE id = $1`, [inv.id]);
    const { rows } = await svc(
      `SELECT action, actor_user_id, details::text AS details FROM admin_audit_log WHERE target_type = 'invite' ORDER BY id`,
    );
    expect(rows.map((r: Record<string, unknown>) => r.action)).toEqual(["invite.created", "invite.revoked"]);
    expect(rows.every((r: Record<string, unknown>) => r.actor_user_id === OWNER)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("secretcode1");
  });

  it("records stopping and restoring tips through admin_set_tip_suspension", async () => {
    await asUser(OWNER, `SELECT public.admin_set_tip_suspension('alice', true, 'personal transfers')`);
    await asUser(OWNER, `SELECT public.admin_set_tip_suspension('alice', false)`);
    const entries = await asUser<{ action: string; target_username: string; actor_username: string; details: { reason?: string } }>(
      OWNER,
      "SELECT * FROM public.owner_audit_log(2)",
    );
    expect(entries.map((e) => e.action)).toEqual(["tipping.restored", "tipping.suspended"]);
    expect(entries[1]).toMatchObject({ target_username: "alice", actor_username: "boss", details: { reason: "personal transfers" } });
  });

  it("is readable by admins only and can't be written, edited or deleted from the API", async () => {
    expect((await asUser(OWNER, "SELECT id FROM admin_audit_log")).length).toBeGreaterThan(0);
    expect(await asUser(BOB, "SELECT id FROM admin_audit_log")).toHaveLength(0);
    expect(
      await fails(asUser(OWNER, `INSERT INTO admin_audit_log (action, target_type) VALUES ('role.granted', 'user')`)),
    ).toMatch(/row-level security/);
    expect(await fails(asUser(OWNER, `SELECT public.write_admin_audit('role.granted', 'user', NULL)`))).toMatch(
      /permission denied/,
    );
  });

  it("is append-only even for the database owner", async () => {
    expect(await fails(svc(`UPDATE admin_audit_log SET action = 'role.revoked'`))).toMatch(/append-only/);
    expect(await fails(svc(`DELETE FROM admin_audit_log`))).toMatch(/append-only/);
    expect(await fails(svc(`TRUNCATE admin_audit_log`))).toMatch(/append-only/);
  });

  it("still protects the last admin", async () => {
    expect(await fails(svc(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'admin'`, [OWNER]))).toMatch(
      /last Yooits admin/,
    );
  });
});
