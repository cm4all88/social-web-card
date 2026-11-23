/**
 * Owner Settings and the owner Wishlists page on in-memory Postgres with every
 * real migration: owner-only access, validation, the audit trail, the public
 * read, app switches, wishlist moderation and an exact rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const MIG = "20261123030000_site_settings_wishlists";

let db: PGlite;
const svc = <T = Record<string, unknown>>(q: string, p: unknown[] = []) =>
  db.query<T>(q, p).then((r) => r.rows);
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
const save = (s: Record<string, unknown>) =>
  as<{ j: Record<string, unknown> }>(OWNER, `SELECT public.owner_save_site_settings($1) AS j`, [JSON.stringify(s)]).then(
    (r) => r[0].j,
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  for (const [id, u] of [
    [OWNER, "boss"],
    [ALICE, "alice"],
  ])
    await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
      id,
      `${u}@example.test`,
      JSON.stringify({ username: u }),
    ]);
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
}, 60_000);

afterAll(() => db?.close());

describe("site settings", () => {
  it("are owner-only to read in full and to change", async () => {
    for (const q of [
      `SELECT public.owner_site_settings()`,
      `SELECT public.owner_save_site_settings('{}')`,
      `SELECT public.owner_set_app_flag('skins', false)`,
      `SELECT public.owner_wishlists()`,
      `SELECT public.owner_wishlist_set_visibility(gen_random_uuid(), 'private', 'spam')`,
    ]) {
      expect(await fails(as(ALICE, q))).toMatch(/Not authorized/);
      expect(await fails(as(null, q))).toMatch(/permission denied/);
    }
  });

  it("start as what the site shows today and are readable by anyone", async () => {
    const [{ j }] = await as<{ j: Record<string, unknown> }>(null, `SELECT public.public_site_settings() AS j`);
    expect(j).toEqual({
      site_name: "Yooits",
      tagline: "One link. All your socials.",
      support_email: "admin@tahomaindustries.com",
      theme_color: null,
      socials: {},
    });
    const [{ o }] = await as<{ o: Record<string, unknown> }>(OWNER, `SELECT public.owner_site_settings() AS o`);
    expect(Object.keys(o).sort()).toEqual(["app_flags", "email", "feature_flags", "site", "wishlist_claims"]);
    expect(o.email).not.toHaveProperty("dispatch_url");
  });

  it("validate, save and log what changed", async () => {
    expect(await fails(save({ site_name: "" }))).toMatch(/1 to 40/);
    expect(await fails(save({ support_email: "nope" }))).toMatch(/contact email/);
    expect(await fails(save({ theme_color: "purple" }))).toMatch(/hex/);
    expect(await fails(save({ socials: { myspace: "https://myspace.com/x" } }))).toMatch(/Unknown social/);
    expect(await fails(save({ socials: { instagram: "http://instagram.com/yooits" } }))).toMatch(/https/);
    expect(await fails(save({ socials: { instagram: "https://evil.example/instagram.com" } }))).toMatch(/instagram\.com/);
    expect(await fails(save({ socials: { x: "https://x.com.evil.example/yooits" } }))).toMatch(/x\.com/);

    const j = await save({
      tagline: "  Your socials, one link  ",
      theme_color: "#A855F7",
      support_email: "Hello@Yooits.me",
      socials: { instagram: "https://www.instagram.com/yooits", tiktok: "", x: "https://twitter.com/yooits" },
    });
    expect(j).toEqual({
      site_name: "Yooits",
      tagline: "Your socials, one link",
      support_email: "hello@yooits.me",
      theme_color: "#a855f7",
      socials: { instagram: "https://www.instagram.com/yooits", x: "https://twitter.com/yooits" },
    });
    // Saving one field leaves the others alone.
    expect((await save({ site_name: "Yooits" })).socials).toHaveProperty("x");
    const [log] = await svc<{ action: string; details: { before: { tagline: string }; after: { tagline: string } } }>(
      `SELECT action, details FROM admin_audit_log WHERE action = 'site_settings.updated' ORDER BY created_at LIMIT 1`,
    );
    expect(log.details.before.tagline).toBe("One link. All your socials.");
    expect(log.details.after.tagline).toBe("Your socials, one link");
    // The table itself is closed to everyone but the functions.
    await as(ALICE, `UPDATE site_settings SET site_name = 'x'`).catch(() => null);
    expect((await svc<{ n: string }>(`SELECT site_name AS n FROM site_settings`))[0].n).toBe("Yooits");
  });
});

describe("app switches", () => {
  it("turn an existing switch off and on, logged once per change", async () => {
    const keys = (await svc<{ key: string }>(`SELECT key FROM app_flags ORDER BY key`)).map((r) => r.key);
    if (!keys.length) await svc(`INSERT INTO app_flags (key, enabled) VALUES ('skins', true)`);
    const key = keys[0] ?? "skins";
    await svc(`UPDATE app_flags SET enabled = true WHERE key = $1`, [key]);
    await as(OWNER, `SELECT public.owner_set_app_flag($1, false)`, [key]);
    await as(OWNER, `SELECT public.owner_set_app_flag($1, false)`, [key]);
    expect((await svc<{ e: boolean }>(`SELECT enabled AS e FROM app_flags WHERE key = $1`, [key]))[0].e).toBe(false);
    await as(OWNER, `SELECT public.owner_set_app_flag($1, true)`, [key]);
    const logs = await svc(`SELECT action FROM admin_audit_log WHERE target_type = 'app_flag' AND target_id = $1 ORDER BY created_at`, [key]);
    expect(logs.map((l) => l.action)).toEqual(["app_flag.disabled", "app_flag.enabled"]);
    expect(await fails(as(OWNER, `SELECT public.owner_set_app_flag('no_such_switch', true)`))).toMatch(/No app switch/);
  });
});

describe("owner wishlists", () => {
  it("lists every list with counts and can make one private with a reason", async () => {
    const [w] = await svc<{ id: string }>(
      `INSERT INTO wishlists (user_id, slug, title, visibility) VALUES ($1, 'xmas', 'Christmas', 'public') RETURNING id`,
      [ALICE],
    );
    await svc(`INSERT INTO wishlist_items (wishlist_id, user_id, name) VALUES ($1, $2, 'Bike')`, [w.id, ALICE]);
    const [{ j }] = await as<{ j: { totals: Record<string, number>; lists: Record<string, unknown>[] } }>(
      OWNER,
      `SELECT public.owner_wishlists('alice') AS j`,
    );
    expect(j.totals.lists).toBe(1);
    expect(j.lists[0]).toMatchObject({ title: "Christmas", username: "alice", items: 1, claims: 0, visibility: "public" });
    expect(await fails(as(OWNER, `SELECT public.owner_wishlist_set_visibility($1, 'private', '')`, [w.id]))).toMatch(/reason/);
    await as(OWNER, `SELECT public.owner_wishlist_set_visibility($1, 'private', 'Reported as spam')`, [w.id]);
    expect((await svc<{ v: string }>(`SELECT visibility AS v FROM wishlists WHERE id = $1`, [w.id]))[0].v).toBe("private");
    // Items and claims are untouched.
    expect((await svc(`SELECT 1 FROM wishlist_items WHERE wishlist_id = $1`, [w.id])).length).toBe(1);
    const [log] = await svc<{ details: Record<string, string> }>(
      `SELECT details FROM admin_audit_log WHERE action = 'wishlist.visibility_changed'`,
    );
    expect(log.details).toEqual({ from: "public", to: "private", reason: "Reported as spam" });
  });
});

describe("rollback", () => {
  it("restores the schema exactly", async () => {
    const files = migrationSql();
    const all = readdirSync(join(__dirname, "..", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const idx = all.indexOf(`${MIG}.sql`);
    expect(idx).toBeGreaterThan(-1);
    const fresh = new PGlite();
    try {
      await fresh.exec(SUPABASE_STUBS);
      await fresh.exec(`ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`);
      for (const sql of files.slice(0, idx)) await fresh.exec(sql);
      await fresh.exec(SUPABASE_GRANTS);
      const snap = async () => {
        const f = await fresh.query<{ f: string }>(
          `SELECT string_agg(p.proname || '=' || md5(p.prosrc), ',' ORDER BY p.proname, p.oid) AS f
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`,
        );
        const c = await fresh.query<{ c: string }>(
          `SELECT string_agg(table_name || '.' || column_name, ',' ORDER BY table_name, ordinal_position) AS c
             FROM information_schema.columns WHERE table_schema = 'public'`,
        );
        return [f.rows[0].f, c.rows[0].c];
      };
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
