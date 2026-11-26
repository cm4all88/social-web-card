/**
 * Upgrade path for the live database: start from the migrations already on
 * main, with an owner who became admin the old way and a creator with links,
 * then apply tipping/wishlists, Phase 0 and the owner console. Checks that
 * existing accounts, admin access, wishlists and the owner console work
 * together afterwards. In-memory Postgres; no network.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const MIGRATIONS = join(__dirname, "..", "migrations");
const FIRST_NEW = "20261118120000"; // first migration not yet on main
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const sql = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8");

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const NEWBIE = "00000000-0000-4000-8000-0000000000d1";

let db: PGlite;
const svc = (q: string, p: unknown[] = []) => db.query(q, p);

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
  svc(`INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at) VALUES ($1, $2, $3, now())`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
  await db.exec(`INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)`);

  // Today's production schema, with today's behaviour: first signup became admin.
  for (const f of files.filter((f) => f < FIRST_NEW)) await db.exec(sql(f));
  await db.exec(SUPABASE_GRANTS);
  await signUp(OWNER, "chris");
  await signUp(ALICE, "alice");
  await svc(
    `INSERT INTO social_links (platform, url, user_id, display_order) VALUES
       ('website', 'https://alice.example', $1, 1), ('email', 'alice@example.test', $1, 2)`,
    [ALICE],
  );

  // Apply everything new, in order: tipping/wishlists, Phase 0, owner console.
  for (const f of files.filter((f) => f >= FIRST_NEW)) await db.exec(sql(f));
  await db.exec(SUPABASE_GRANTS);
}, 60_000);

afterAll(() => db?.close());

describe("after the upgrade", () => {
  it("the owner is still the only admin and has the owner console", async () => {
    const { rows } = await svc(`SELECT user_id, role::text AS role FROM user_roles ORDER BY role, user_id`);
    expect(rows).toEqual([
      { user_id: OWNER, role: "admin" },
      { user_id: ALICE, role: "user" },
    ]);
    const [{ o }] = await as<{ o: Record<string, number> }>(OWNER, "SELECT public.owner_overview() AS o");
    expect(o).toMatchObject({ total_users: 2, admins: 1, profiles_with_links: 1 });
  });

  it("an existing creator keeps their page and links, readable by anyone", async () => {
    const [p] = await as(null, `SELECT username FROM profiles WHERE username = 'alice'`);
    expect(p).toEqual({ username: "alice" });
    const links = await as(null, `SELECT url FROM social_links WHERE user_id = $1 ORDER BY display_order`, [ALICE]);
    expect(links).toEqual([{ url: "https://alice.example" }, { url: "alice@example.test" }]);
  });

  it("an existing creator can still edit their profile and links", async () => {
    await as(ALICE, `UPDATE profiles SET bio = 'Hello' WHERE user_id = $1`, [ALICE]);
    await as(ALICE, `UPDATE social_links SET url = 'https://alice.example/new' WHERE user_id = $1 AND platform = 'website'`, [ALICE]);
    const { rows } = await svc(`SELECT bio FROM profiles WHERE user_id = $1`, [ALICE]);
    expect(rows[0]).toEqual({ bio: "Hello" });
  });

  it("wishlists work: public ones are visible to anyone, private ones only to the owner", async () => {
    const [pub] = await as<{ id: string }>(
      ALICE,
      `INSERT INTO wishlists (user_id, slug, title, visibility) VALUES ($1, 'birthday', 'Birthday', 'public') RETURNING id`,
      [ALICE],
    );
    await as(ALICE, `INSERT INTO wishlists (user_id, slug, title) VALUES ($1, 'secret', 'Secret')`, [ALICE]);
    await as(
      ALICE,
      `INSERT INTO wishlist_items (wishlist_id, user_id, name, url) VALUES ($1, $2, 'Book', 'https://shop.example/book')`,
      [pub.id, ALICE],
    );
    expect(await as(null, `SELECT slug FROM wishlists WHERE user_id = $1`, [ALICE])).toEqual([{ slug: "birthday" }]);
    expect(await as(null, `SELECT name FROM wishlist_items`)).toEqual([{ name: "Book" }]);
    expect(await as(ALICE, `SELECT slug FROM wishlists WHERE user_id = $1 ORDER BY slug`, [ALICE])).toHaveLength(2);
    const [{ u }] = await as<{ u: { wishlists: number } }>(OWNER, "SELECT public.owner_get_user($1) AS u", [ALICE]);
    expect(u.wishlists).toBe(2);
  });

  it("a creator gets no owner access, can't make themselves admin and can't read the audit log", async () => {
    expect(await fails(as(ALICE, "SELECT public.owner_overview()"))).toMatch(/Not authorized/);
    expect(await fails(as(ALICE, "SELECT public.admin_tip_report()"))).toMatch(/Not authorized/);
    expect(await fails(as(ALICE, `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [ALICE]))).toMatch(
      /row-level security/,
    );
    expect(await as(ALICE, "SELECT id FROM admin_audit_log")).toHaveLength(0);
  });

  it("a new signup after the upgrade is an ordinary user", async () => {
    await signUp(NEWBIE, "newbie");
    const { rows } = await svc(`SELECT role::text AS role FROM user_roles WHERE user_id = $1`, [NEWBIE]);
    expect(rows).toEqual([{ role: "user" }]);
  });

  it("stopping tips from Money is recorded with who did it", async () => {
    await svc(`INSERT INTO creator_payment_accounts (user_id, stripe_account_id, status) VALUES ($1, 'acct_a', 'connected')`, [
      ALICE,
    ]);
    await as(OWNER, `SELECT public.admin_set_tip_suspension('alice', true, 'review')`);
    const [entry] = await as<{ action: string; actor_username: string; target_username: string }>(
      OWNER,
      "SELECT * FROM public.owner_audit_log(1)",
    );
    expect(entry).toMatchObject({ action: "tipping.suspended", actor_username: "chris", target_username: "alice" });
  });
});
