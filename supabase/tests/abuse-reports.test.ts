/**
 * Abuse reports and self-serve account deletion, on in-memory Postgres with
 * every real migration applied.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";
import { DELETED_TABLES } from "../../src/lib/account/delete-account.server";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b1";

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

async function signUp(id: string, username: string) {
  await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
}

const report = (username: string, slug: string | null, ip: string | null, reason = "spam") =>
  svc<{ r: string }>(`SELECT public.record_abuse_report($1, $2, $3, 'details', NULL, NULL, $4) AS r`, [
    username,
    slug,
    reason,
    ip,
  ]).then((rows) => rows[0].r);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  await signUp(OWNER, "boss");
  await signUp(ALICE, "alice");
  await signUp(BOB, "bob");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
  await svc(`INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://alice.example', $1)`, [ALICE]);
  const [w] = await svc<{ id: string }>(
    `INSERT INTO wishlists (user_id, slug, title, visibility) VALUES ($1, 'birthday', 'Birthday', 'public') RETURNING id`,
    [ALICE],
  );
  await svc(`INSERT INTO wishlist_items (wishlist_id, user_id, name) VALUES ($1, $2, 'Book')`, [w.id, ALICE]);
}, 60_000);

afterAll(() => db?.close());

describe("abuse reports", () => {
  it("records a report on a profile and on a wishlist", async () => {
    expect(await report("Alice", null, "ip-1")).toBe("ok");
    expect(await report("alice", "birthday", "ip-1")).toBe("ok");
    const rows = await svc<{ target_kind: string; wishlist_id: string | null }>(
      `SELECT target_kind, wishlist_id FROM abuse_reports ORDER BY created_at`,
    );
    expect(rows.map((r) => r.target_kind)).toEqual(["profile", "wishlist"]);
  });

  it("refuses unknown people, wishlists and reasons", async () => {
    expect(await report("nobody", null, "ip-2")).toBe("not_found");
    expect(await report("alice", "nope", "ip-2")).toBe("not_found");
    expect(await fails(report("alice", null, "ip-2", "made_up"))).toMatch(/check/i);
  });

  it("limits repeats: one a day per target, five an hour per visitor", async () => {
    expect(await report("alice", null, "ip-1")).toBe("rate_limited");
    expect(await report("bob", null, "ip-3")).toBe("ok");
    expect(await report("alice", null, "ip-3")).toBe("ok");
    expect(await report("alice", "birthday", "ip-3")).toBe("ok");
    expect(await report("boss", null, "ip-3")).toBe("ok");
    await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (gen_random_uuid(), 'c@example.test', '{"username":"carol"}')`);
    expect(await report("carol", null, "ip-3")).toBe("ok");
    await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (gen_random_uuid(), 'd@example.test', '{"username":"dave"}')`);
    expect(await report("dave", null, "ip-3")).toBe("rate_limited");
  });

  it("can't be read, written or recorded from the browser", async () => {
    for (const who of [null, ALICE]) {
      expect(await as(who, `SELECT id FROM abuse_reports`)).toEqual([]);
      expect(
        await fails(as(who, `INSERT INTO abuse_reports (target_user_id, target_kind, reason) VALUES ($1, 'profile', 'spam')`, [BOB])),
      ).not.toBeNull();
      expect(await fails(as(who, `SELECT public.record_abuse_report('bob', NULL, 'spam', NULL, NULL, NULL, 'x')`))).toMatch(
        /permission denied/,
      );
    }
  });

  it("only admins list and resolve reports, and resolving is logged", async () => {
    expect(await fails(as(ALICE, `SELECT public.owner_list_reports('open')`))).toMatch(/Not authorized/);
    expect(await fails(as(null, `SELECT public.owner_list_reports('open')`))).toMatch(/permission denied/);

    const [{ list }] = await as<{ list: { id: string; target_username: string }[] }>(
      OWNER,
      `SELECT public.owner_list_reports('open') AS list`,
    );
    expect(list.length).toBeGreaterThan(0);
    const first = list[0];
    expect(await fails(as(ALICE, `SELECT public.owner_resolve_report($1, 'dismissed', 'no')`, [first.id]))).toMatch(
      /Not authorized/,
    );
    await as(OWNER, `SELECT public.owner_resolve_report($1, 'resolved', 'Page unpublished')`, [first.id]);
    const [row] = await svc<{ status: string; resolved_by: string }>(
      `SELECT status, resolved_by FROM abuse_reports WHERE id = $1`,
      [first.id],
    );
    expect(row).toEqual({ status: "resolved", resolved_by: OWNER });
    const log = await svc<{ action: string; actor_user_id: string }>(
      `SELECT action, actor_user_id FROM admin_audit_log WHERE target_type = 'report'`,
    );
    expect(log).toEqual([{ action: "report.resolved", actor_user_id: OWNER }]);
    const [{ n }] = await as<{ n: number }>(OWNER, `SELECT public.owner_open_report_count() AS n`);
    expect(n).toBe(list.length - 1);
  });
});

describe("account deletion against the real schema", () => {
  it("clears every user table without tripping a trigger, then removes the sign-in", async () => {
    for (const t of DELETED_TABLES) await svc(`DELETE FROM public.${t} WHERE user_id = $1`, [ALICE]);
    await svc(`DELETE FROM auth.users WHERE id = $1`, [ALICE]);
    const [r] = await svc<Record<string, number>>(`
      SELECT (SELECT count(*)::int FROM profiles WHERE user_id = '${ALICE}') AS profiles,
             (SELECT count(*)::int FROM social_links WHERE user_id = '${ALICE}') AS links,
             (SELECT count(*)::int FROM wishlists WHERE user_id = '${ALICE}') AS wishlists,
             (SELECT count(*)::int FROM user_roles WHERE user_id = '${ALICE}') AS roles`);
    expect(r).toEqual({ profiles: 0, links: 0, wishlists: 0, roles: 0 });
  });

  it("covers every table with a user_id column, apart from those kept on purpose", async () => {
    const rows = await svc<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'user_id'`,
    );
    const kept = new Set(["user_roles", "creator_payment_accounts", "checkout_attempts"]);
    for (const { table_name } of rows) {
      if (kept.has(table_name)) continue;
      expect(DELETED_TABLES as readonly string[]).toContain(table_name);
    }
  });
});
