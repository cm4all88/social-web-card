/**
 * Owner account controls (unpublish, suspend, tips off) on in-memory Postgres
 * with every real migration applied. Checks who can use them, what each one
 * hides or blocks, that nothing is deleted, that admins can't lock themselves
 * out, and that every change is in the audit log with reason and admin.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ADMIN2 = "00000000-0000-4000-8000-0000000000ab";
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

/** What an anonymous visitor can see of Alice. */
async function publicView() {
  return {
    profile: (await as(null, `SELECT username FROM profiles WHERE user_id = $1`, [ALICE])).length,
    links: (await as(null, `SELECT id FROM social_links WHERE user_id = $1`, [ALICE])).length,
    wishlists: (await as(null, `SELECT id FROM wishlists WHERE user_id = $1`, [ALICE])).length,
    items: (await as(null, `SELECT id FROM wishlist_items WHERE user_id = $1`, [ALICE])).length,
  };
}
const VISIBLE = { profile: 1, links: 1, wishlists: 1, items: 1 };
const HIDDEN = { profile: 0, links: 0, wishlists: 0, items: 0 };

async function rowCounts() {
  const [r] = await svc<Record<string, number>>(`
    SELECT (SELECT count(*)::int FROM profiles WHERE user_id = '${ALICE}') AS profiles,
           (SELECT count(*)::int FROM social_links WHERE user_id = '${ALICE}') AS links,
           (SELECT count(*)::int FROM wishlists WHERE user_id = '${ALICE}') AS wishlists,
           (SELECT count(*)::int FROM wishlist_items WHERE user_id = '${ALICE}') AS items,
           (SELECT count(*)::int FROM tip_settings WHERE user_id = '${ALICE}') AS tip_settings`);
  return r;
}

const audit = () =>
  svc<{ action: string; actor_user_id: string | null; target_id: string; reason: string | null }>(
    `SELECT action, actor_user_id, target_id, details->>'reason' AS reason FROM admin_audit_log
      WHERE action LIKE 'account.%' OR action LIKE 'tipping.%' ORDER BY id`,
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  await db.exec(
    `GRANT USAGE ON SCHEMA storage TO anon, authenticated; GRANT ALL ON storage.objects TO authenticated; GRANT SELECT ON storage.objects TO anon;`,
  );
  await signUp(OWNER, "boss");
  await signUp(ADMIN2, "deputy");
  await signUp(ALICE, "alice");
  await signUp(BOB, "bob");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin'), ($2, 'admin')`, [OWNER, ADMIN2]);
  await svc(`INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://alice.example', $1)`, [ALICE]);
  const [w] = await svc<{ id: string }>(
    `INSERT INTO wishlists (user_id, slug, title, visibility) VALUES ($1, 'birthday', 'Birthday', 'public') RETURNING id`,
    [ALICE],
  );
  await svc(`INSERT INTO wishlist_items (wishlist_id, user_id, name) VALUES ($1, $2, 'Book')`, [w.id, ALICE]);
  await svc(
    `INSERT INTO tip_settings (user_id, enabled, creator_type, offering, attested_at)
     VALUES ($1, true, 'artist', 'Original prints and comics', now())`,
    [ALICE],
  );
}, 60_000);

afterAll(() => db?.close());

describe("who can use the controls", () => {
  it("only admins; signed-out visitors can't call them at all", async () => {
    for (const q of [
      `SELECT public.owner_set_unpublished('${BOB}', true, 'spam')`,
      `SELECT public.owner_set_suspended('${BOB}', true, 'spam')`,
      `SELECT public.owner_set_tips_disabled('${BOB}', true, 'spam')`,
    ]) {
      expect(await fails(as(ALICE, q))).toMatch(/Not authorized/);
      expect(await fails(as(null, q))).toMatch(/permission denied/);
    }
  });

  it("nobody can write account_status directly, and people see only their own", async () => {
    expect(await fails(as(ALICE, `INSERT INTO account_status (user_id) VALUES ($1)`, [ALICE]))).toMatch(
      /row-level security/,
    );
    expect(await fails(as(OWNER, `INSERT INTO account_status (user_id) VALUES ($1)`, [BOB]))).toMatch(
      /row-level security/,
    );
  });

  it("need a reason when switching something off", async () => {
    expect(await fails(as(OWNER, `SELECT public.owner_set_unpublished($1, true, '  ')`, [ALICE]))).toMatch(
      /reason/,
    );
    expect(await fails(as(OWNER, `SELECT public.owner_set_suspended($1, true, NULL)`, [ALICE]))).toMatch(/reason/);
  });

  it("refuse unknown accounts", async () => {
    expect(
      await fails(as(OWNER, `SELECT public.owner_set_unpublished('00000000-0000-4000-8000-000000000000', true, 'x y z')`)),
    ).toMatch(/No account/);
  });
});

describe("unpublishing a page", () => {
  it("hides the page, links and wishlists from visitors and direct links, without deleting anything", async () => {
    expect(await publicView()).toEqual(VISIBLE);
    const before = await rowCounts();
    await as(OWNER, `SELECT public.owner_set_unpublished($1, true, 'Reported spam links')`, [ALICE]);
    expect(await publicView()).toEqual(HIDDEN);
    // Other signed-in users can't see it either.
    expect(await as(BOB, `SELECT id FROM profiles WHERE user_id = $1`, [ALICE])).toHaveLength(0);
    expect(await rowCounts()).toEqual(before);
  });

  it("still lets the owner see and edit it, and admins see it", async () => {
    expect(await as(ALICE, `SELECT id FROM wishlists WHERE user_id = $1`, [ALICE])).toHaveLength(1);
    await as(ALICE, `UPDATE profiles SET bio = 'Fixed my links' WHERE user_id = $1`, [ALICE]);
    expect(await as(OWNER, `SELECT bio FROM profiles WHERE user_id = $1`, [ALICE])).toEqual([{ bio: "Fixed my links" }]);
  });

  it("stops tips (checked by the server's tips_allowed)", async () => {
    expect(await svc(`SELECT public.tips_allowed($1) AS ok`, [ALICE])).toEqual([{ ok: false }]);
    expect(await fails(as(ALICE, `SELECT public.tips_allowed($1)`, [ALICE]))).toMatch(/permission denied/);
  });

  it("republishing brings everything back", async () => {
    await as(OWNER, `SELECT public.owner_set_unpublished($1, false)`, [ALICE]);
    expect(await publicView()).toEqual(VISIBLE);
    expect(await svc(`SELECT public.tips_allowed($1) AS ok`, [ALICE])).toEqual([{ ok: true }]);
  });
});

describe("avatar files", () => {
  const listed = (who: string | null) =>
    as<{ name: string }>(who, `SELECT name FROM storage.objects WHERE bucket_id = 'avatars' AND name LIKE $1`, [`${ALICE}/%`]);

  it("can't be listed while the page is hidden, except by the owner and admins", async () => {
    await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', $1)`, [`${ALICE}/avatar-1.png`]);
    expect(await listed(null)).toHaveLength(1);
    await as(OWNER, `SELECT public.owner_set_unpublished($1, true, 'Hide avatar test')`, [ALICE]);
    expect(await listed(null)).toHaveLength(0);
    expect(await listed(BOB)).toHaveLength(0);
    expect(await listed(ALICE)).toHaveLength(1);
    expect(await listed(OWNER)).toHaveLength(1);
    await as(OWNER, `SELECT public.owner_set_unpublished($1, false)`, [ALICE]);
    expect(await listed(null)).toHaveLength(1);
    // Nothing is deleted.
    expect(await svc(`SELECT name FROM storage.objects WHERE name = $1`, [`${ALICE}/avatar-1.png`])).toHaveLength(1);
  });

  it("files outside a user's own folder are never listed", async () => {
    await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'stray.png')`);
    expect(await as(null, `SELECT name FROM storage.objects WHERE name = 'stray.png'`)).toHaveLength(0);
  });
});

describe("suspending an account", () => {
  it("hides the page and blocks changes, without deleting anything", async () => {
    const before = await rowCounts();
    await as(OWNER, `SELECT public.owner_set_suspended($1, true, 'Impersonating a brand')`, [ALICE]);
    expect(await publicView()).toEqual(HIDDEN);
    expect(await rowCounts()).toEqual(before);

    // Writes are refused (no rows change), reads of their own data still work.
    await as(ALICE, `UPDATE profiles SET bio = 'changed' WHERE user_id = $1`, [ALICE]);
    expect(await svc(`SELECT bio FROM profiles WHERE user_id = $1`, [ALICE])).toEqual([{ bio: "Fixed my links" }]);
    expect(
      await fails(as(ALICE, `INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://x.example', $1)`, [ALICE])),
    ).toMatch(/row-level security/);
    expect(
      await fails(as(ALICE, `INSERT INTO wishlists (user_id, slug, title) VALUES ($1, 'new', 'New')`, [ALICE])),
    ).toMatch(/row-level security/);
    await as(ALICE, `DELETE FROM wishlists WHERE user_id = $1`, [ALICE]);
    await as(ALICE, `UPDATE tip_settings SET enabled = true WHERE user_id = $1`, [ALICE]);
    expect(
      await fails(as(ALICE, `INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', $1)`, [`${ALICE}/a.png`])),
    ).toMatch(/row-level security/);
    expect(await rowCounts()).toEqual(before);
    expect(await as(ALICE, `SELECT username FROM profiles WHERE user_id = $1`, [ALICE])).toEqual([{ username: "alice" }]);
    expect(await as(ALICE, `SELECT suspended_reason FROM account_status WHERE user_id = $1`, [ALICE])).toHaveLength(1);
  });

  it("switches tips off on the profile and blocks tips", async () => {
    expect(await svc(`SELECT enabled FROM tip_settings WHERE user_id = $1`, [ALICE])).toEqual([{ enabled: false }]);
    expect(await svc(`SELECT public.tips_allowed($1) AS ok`, [ALICE])).toEqual([{ ok: false }]);
  });

  it("doesn't affect anyone else", async () => {
    await as(BOB, `INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', $1)`, [`${BOB}/a.png`]);
    await as(BOB, `UPDATE profiles SET bio = 'hi' WHERE user_id = $1`, [BOB]);
    expect(await svc(`SELECT bio FROM profiles WHERE user_id = $1`, [BOB])).toEqual([{ bio: "hi" }]);
    expect(await as(null, `SELECT username FROM profiles WHERE user_id = $1`, [BOB])).toHaveLength(1);
  });

  it("reactivating restores editing and the page", async () => {
    await as(OWNER, `SELECT public.owner_set_suspended($1, false)`, [ALICE]);
    await as(ALICE, `UPDATE profiles SET bio = 'back' WHERE user_id = $1`, [ALICE]);
    expect(await svc(`SELECT bio FROM profiles WHERE user_id = $1`, [ALICE])).toEqual([{ bio: "back" }]);
    expect(await publicView()).toEqual(VISIBLE);
  });
});

describe("admins can't lock themselves out", () => {
  it("you can't suspend yourself", async () => {
    expect(await fails(as(OWNER, `SELECT public.owner_set_suspended($1, true, 'oops')`, [OWNER]))).toMatch(
      /your own account/,
    );
  });

  it("another admin can't be suspended until their admin access is removed", async () => {
    expect(await fails(as(OWNER, `SELECT public.owner_set_suspended($1, true, 'oops')`, [ADMIN2]))).toMatch(
      /Remove their admin access first/,
    );
  });

  it("the last admin still can't be removed", async () => {
    await svc(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'admin'`, [ADMIN2]);
    expect(await fails(svc(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'admin'`, [OWNER]))).toMatch(
      /last Yooits admin/,
    );
    await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [ADMIN2]);
  });

  it("nothing an admin does here takes away their own access", async () => {
    await as(OWNER, `SELECT public.owner_set_unpublished($1, true, 'testing my own page')`, [OWNER]);
    const [{ o }] = await as<{ o: { admins: number } }>(OWNER, `SELECT public.owner_overview() AS o`);
    expect(o.admins).toBe(2);
    await as(OWNER, `SELECT public.owner_set_unpublished($1, false)`, [OWNER]);
  });
});

describe("turning tips off", () => {
  beforeEach(async () => {
    await svc(`DELETE FROM creator_payment_accounts`);
  });

  it("works for a creator who hasn't connected Stripe yet", async () => {
    await as(OWNER, `SELECT public.owner_set_tips_disabled($1, true, 'Personal transfers')`, [BOB]);
    expect(await svc(`SELECT public.tips_allowed($1) AS ok`, [BOB])).toEqual([{ ok: false }]);
    // The page itself stays up.
    expect(await as(null, `SELECT username FROM profiles WHERE user_id = $1`, [BOB])).toHaveLength(1);
    await as(OWNER, `SELECT public.owner_set_tips_disabled($1, false)`, [BOB]);
    expect(await svc(`SELECT public.tips_allowed($1) AS ok`, [BOB])).toEqual([{ ok: true }]);
  });

  it("keeps the payment account's own flag in step, both ways", async () => {
    await svc(`INSERT INTO creator_payment_accounts (user_id, stripe_account_id, status) VALUES ($1, 'acct_a', 'connected')`, [
      ALICE,
    ]);
    await as(OWNER, `SELECT public.owner_set_tips_disabled($1, true, 'Chargebacks')`, [ALICE]);
    expect(await svc(`SELECT tipping_suspended_reason FROM creator_payment_accounts WHERE user_id = $1`, [ALICE])).toEqual([
      { tipping_suspended_reason: "Chargebacks" },
    ]);
    await as(OWNER, `SELECT public.owner_set_tips_disabled($1, false)`, [ALICE]);
    expect(await svc(`SELECT tipping_suspended_at FROM creator_payment_accounts WHERE user_id = $1`, [ALICE])).toEqual([
      { tipping_suspended_at: null },
    ]);
  });

  it("the Money page's control uses the same switch", async () => {
    expect(await as(OWNER, `SELECT public.admin_set_tip_suspension('bob', true, 'From Money') AS ok`)).toEqual([{ ok: true }]);
    expect(await svc(`SELECT tips_disabled_reason FROM account_status WHERE user_id = $1`, [BOB])).toEqual([
      { tips_disabled_reason: "From Money" },
    ]);
    await as(OWNER, `SELECT public.admin_set_tip_suspension('bob', false)`);
    expect(await svc(`SELECT public.tips_allowed($1) AS ok`, [BOB])).toEqual([{ ok: true }]);
    expect(await as(OWNER, `SELECT public.admin_set_tip_suspension('nobody', true) AS ok`)).toEqual([{ ok: false }]);
  });
});

describe("audit log", () => {
  it("records every change once, with the admin and the reason", async () => {
    const log = await audit();
    expect(log.map((e) => [e.action, e.target_id === ALICE ? "alice" : e.target_id === BOB ? "bob" : "boss"])).toEqual([
      ["account.unpublished", "alice"],
      ["account.republished", "alice"],
      ["account.unpublished", "alice"],
      ["account.republished", "alice"],
      ["account.suspended", "alice"],
      ["account.reactivated", "alice"],
      ["account.unpublished", "boss"],
      ["account.republished", "boss"],
      ["tipping.suspended", "bob"],
      ["tipping.restored", "bob"],
      ["tipping.suspended", "alice"],
      ["tipping.restored", "alice"],
      ["tipping.suspended", "bob"],
      ["tipping.restored", "bob"],
    ]);
    expect(log.every((e) => e.actor_user_id === OWNER)).toBe(true);
    expect(log[0].reason).toBe("Reported spam links");
    expect(log[2].reason).toBe("Hide avatar test");
    expect(log[4].reason).toBe("Impersonating a brand");
  });

  it("shows up in the owner console with names", async () => {
    const [latest] = await as<{ action: string; actor_username: string; target_username: string }>(
      OWNER,
      `SELECT * FROM public.owner_audit_log(1)`,
    );
    expect(latest).toMatchObject({ action: "tipping.restored", actor_username: "boss", target_username: "bob" });
  });
});

describe("owner console reads", () => {
  it("show each account's switches", async () => {
    await as(OWNER, `SELECT public.owner_set_unpublished($1, true, 'Checking')`, [BOB]);
    const rows = await as<{ username: string; unpublished: boolean; suspended: boolean; tips_disabled: boolean }>(
      OWNER,
      `SELECT username, unpublished, suspended, tips_disabled FROM public.owner_list_users('bob')`,
    );
    expect(rows).toEqual([{ username: "bob", unpublished: true, suspended: false, tips_disabled: false }]);
    const [{ u }] = await as<{ u: { is_self: boolean; status: Record<string, unknown> } }>(
      OWNER,
      `SELECT public.owner_get_user($1) AS u`,
      [BOB],
    );
    expect(u.is_self).toBe(false);
    expect(u.status).toMatchObject({ unpublished_reason: "Checking", unpublished_by: "boss", suspended_at: null });
    const [{ o }] = await as<{ o: { unpublished: number; suspended: number } }>(OWNER, `SELECT public.owner_overview() AS o`);
    expect(o).toMatchObject({ unpublished: 1, suspended: 0 });
    await as(OWNER, `SELECT public.owner_set_unpublished($1, false)`, [BOB]);
  });
});

describe("upgrading with tips already stopped", () => {
  it("carries the existing stop over without logging it again", async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(SUPABASE_STUBS);
      await fresh.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
      const dir = join(__dirname, "..", "migrations");
      const all = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
      const target = "20261118220000_account_controls.sql";
      for (const f of all.filter((f) => f < target)) await fresh.exec(readFileSync(join(dir, f), "utf8"));
      await fresh.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'a@example.test', '{"username":"alice"}')`, [ALICE]);
      await fresh.query(
        `INSERT INTO creator_payment_accounts (user_id, stripe_account_id, tipping_suspended_at, tipping_suspended_reason)
         VALUES ($1, 'acct_a', now(), 'Earlier stop')`,
        [ALICE],
      );
      const logged = (await fresh.query(`SELECT count(*)::int AS n FROM admin_audit_log`)).rows[0];
      for (const f of all.filter((f) => f >= target)) await fresh.exec(readFileSync(join(dir, f), "utf8"));
      expect((await fresh.query(`SELECT tips_disabled_reason FROM account_status`)).rows).toEqual([
        { tips_disabled_reason: "Earlier stop" },
      ]);
      expect((await fresh.query(`SELECT public.tips_allowed($1) AS ok`, [ALICE])).rows).toEqual([{ ok: false }]);
      expect((await fresh.query(`SELECT count(*)::int AS n FROM admin_audit_log`)).rows[0]).toEqual(logged);
    } finally {
      await fresh.close();
    }
  });
});
