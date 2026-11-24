/**
 * Phase 0 security hardening: applies the real migration files to an
 * in-memory Postgres (PGlite) with minimal Supabase stand-ins and checks that
 *   - existing admin access survives and can't be locked out,
 *   - no signup ever becomes admin automatically,
 *   - the new input rules hold, while existing rows stay readable.
 * No network and no real Supabase project.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = join(__dirname, "..", "migrations");
const PHASE0 = "20261118200000_phase0_security_hardening.sql";
const PROJECT = "https://abcdefghijklmnop.supabase.co";

const STUBS = `
  DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, created_at timestamptz DEFAULT now());
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;
`;

const GRANTS = `
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
`;

function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}
const sqlOf = (f: string) => readFileSync(join(MIGRATIONS, f), "utf8");
const before = () => migrationFiles().filter((f) => f < PHASE0);
const fromPhase0 = () => migrationFiles().filter((f) => f >= PHASE0);

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const LEGACY = "00000000-0000-4000-8000-0000000000c1";
const NEWBIE = "00000000-0000-4000-8000-0000000000d1";

async function freshDb(files: string[]) {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(`INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)`);
  for (const f of files) await db.exec(sqlOf(f));
  await db.exec(GRANTS);
  return db;
}

async function signUp(db: PGlite, id: string, username: string) {
  await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
}

async function rolesOf(db: PGlite, id: string) {
  const { rows } = await db.query<{ role: string }>(
    `SELECT role::text AS role FROM public.user_roles WHERE user_id = $1 ORDER BY role`,
    [id],
  );
  return rows.map((r) => r.role);
}

/** Run SQL as a signed-in user (RLS applies). */
async function asUser(db: PGlite, who: string, sql: string, params: unknown[] = []) {
  await db.exec(`SET request.jwt.claim.sub = '${who}'; SET ROLE authenticated;`);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("RESET ROLE; RESET request.jwt.claim.sub;");
  }
}

const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => String(e.message),
  );

// ---------------------------------------------------------------------------
describe("upgrading a live database (owner already admin)", () => {
  let db: PGlite;

  beforeAll(async () => {
    // State before Phase 0: the owner signed up first and was auto-made admin.
    db = await freshDb(before());
    await signUp(db, OWNER, "chris");
    await signUp(db, ALICE, "alice");
    await signUp(db, LEGACY, "help"); // now a reserved name; must keep working
    // A pre-existing link that the new rules would reject must stay readable.
    await db.query(
      `INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'javascript:alert(1)', $1)`,
      [ALICE],
    );
    for (const f of fromPhase0()) await db.exec(sqlOf(f));
    await db.exec(GRANTS);
  }, 60_000);

  afterAll(() => db?.close());

  it("keeps the owner's admin role and changes no other roles", async () => {
    expect(await rolesOf(db, OWNER)).toEqual(["admin"]);
    expect(await rolesOf(db, ALICE)).toEqual(["user"]);
  });

  it("gives existing profiles the presentation defaults", async () => {
    const { rows } = await db.query(
      `SELECT avatar_size, avatar_gallery, bio_alignment, skin_intensity FROM public.profiles WHERE user_id = $1`, [ALICE],
    );
    expect(rows).toEqual([{ avatar_size: 144, avatar_gallery: [], bio_alignment: "center", skin_intensity: "standard" }]);
  });

  it("stores demo profiles outside the public directory and limits access to admins", async () => {
    await asUser(db, OWNER, `INSERT INTO public.marketing_demo_profiles (profile) VALUES ('{"name":"Julie Hope"}')`);
    expect(await asUser(db, OWNER, `SELECT profile FROM public.marketing_demo_profiles`))
      .toEqual([{ profile: { name: "Julie Hope" } }]);
    expect(await asUser(db, ALICE, `SELECT profile FROM public.marketing_demo_profiles`)).toEqual([]);
    expect(await fails(asUser(db, ALICE, `INSERT INTO public.marketing_demo_profiles (profile) VALUES ('{}')`)))
      .toMatch(/row-level security/);
    const publicDemo = await db.query(`SELECT username FROM public.profiles WHERE display_name = 'Julie Hope'`);
    expect(publicDemo.rows).toEqual([]);
  });

  it("removes both automatic admin triggers", async () => {
    const { rows } = await db.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal`,
    );
    // auth_users_email_security (security emails) is not an admin trigger.
    expect(rows.map((r) => r.tgname).filter((n) => n !== "auth_users_email_security")).toEqual(["on_auth_user_created"]);
    const fn = await db.query(`SELECT 1 FROM pg_proc WHERE proname = 'grant_first_admin'`);
    expect(fn.rows).toHaveLength(0);
  });

  it("a new signup is an ordinary user", async () => {
    await signUp(db, NEWBIE, "newbie");
    expect(await rolesOf(db, NEWBIE)).toEqual(["user"]);
  });

  it("a user can't grant themselves admin", async () => {
    const err = await fails(
      asUser(db, ALICE, `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [ALICE]),
    );
    expect(err).toMatch(/row-level security/);
    expect(await rolesOf(db, ALICE)).toEqual(["user"]);
  });

  it("the last admin row can't be deleted, demoted, moved or truncated", async () => {
    expect(await fails(db.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'admin'`, [OWNER]))).toMatch(
      /last Yooits admin/,
    );
    expect(
      await fails(db.query(`UPDATE user_roles SET role = 'user' WHERE user_id = $1 AND role = 'admin'`, [OWNER])),
    ).toMatch(/last Yooits admin/);
    expect(
      await fails(db.query(`UPDATE user_roles SET user_id = $2 WHERE user_id = $1 AND role = 'admin'`, [OWNER, ALICE])),
    ).toMatch(/last Yooits admin/);
    expect(await fails(db.query(`TRUNCATE user_roles`))).toMatch(/cannot be truncated/);
    expect(await rolesOf(db, OWNER)).toEqual(["admin"]);
  });

  it("deleting the last admin's account is blocked", async () => {
    expect(await fails(db.query(`DELETE FROM auth.users WHERE id = $1`, [OWNER]))).toMatch(/last Yooits admin/);
    expect(await rolesOf(db, OWNER)).toEqual(["admin"]);
  });

  it("with a second admin, one can be removed", async () => {
    await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [ALICE]);
    await db.query(`DELETE FROM user_roles WHERE user_id = $1 AND role = 'admin'`, [ALICE]);
    expect(await rolesOf(db, ALICE)).toEqual(["user"]);
    expect(await rolesOf(db, OWNER)).toEqual(["admin"]);
  });

  it("existing holders of a reserved name keep it and can still edit their profile", async () => {
    await asUser(db, LEGACY, `UPDATE profiles SET bio = 'still here' WHERE user_id = $1`, [LEGACY]);
    const { rows } = await db.query<{ bio: string }>(`SELECT bio FROM profiles WHERE user_id = $1`, [LEGACY]);
    expect(rows[0].bio).toBe("still here");
  });

  it("existing rows that break the new rules stay readable", async () => {
    const { rows } = await db.query(`SELECT 1 FROM social_links WHERE user_id = $1`, [ALICE]);
    expect(rows).toHaveLength(1);
  });

  it("sets image-only, 5 MB limits on the avatars bucket", async () => {
    const { rows } = await db.query<{ file_size_limit: number; allowed_mime_types: string[] }>(
      `SELECT file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'avatars'`,
    );
    expect(Number(rows[0].file_size_limit)).toBe(5 * 1024 * 1024);
    expect(rows[0].allowed_mime_types).not.toContain("image/svg+xml");
    expect(rows[0].allowed_mime_types).toContain("image/png");
  });
});

// ---------------------------------------------------------------------------
describe("safety checks around the migration itself", () => {
  it("refuses to run when users exist but no admin does, and changes nothing", async () => {
    const db = await freshDb(before());
    await signUp(db, OWNER, "chris");
    await db.query(`DELETE FROM user_roles WHERE role = 'admin'`); // simulate a lost admin row
    const err = await fails(db.exec(sqlOf(PHASE0)));
    expect(err).toMatch(/Phase 0 stopped/);
    // Rolled back: the old trigger is still there, nothing half-applied.
    const { rows } = await db.query(`SELECT 1 FROM pg_proc WHERE proname = 'protect_last_admin'`);
    expect(rows).toHaveLength(0);
    await db.close();
  }, 60_000);

  it("on a brand-new database, the first signup is NOT made admin", async () => {
    const db = await freshDb(migrationFiles());
    await signUp(db, OWNER, "firstperson");
    expect(await rolesOf(db, OWNER)).toEqual(["user"]);
    await db.close();
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe("input rules for signed-in users", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await freshDb(migrationFiles());
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'o@x.test', '{"username":"chris"}')`, [OWNER]);
    await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
    await signUp(db, ALICE, "alice");
  }, 60_000);

  afterAll(() => db?.close());

  it.each(["support", "admin", "Yooits", "reset-password"])("can't sign up as %s", async (name) => {
    const err = await fails(signUp(db, "00000000-0000-4000-8000-0000000000e1", name));
    expect(err).toMatch(/reserved|valid username/);
  });

  it("can't rename to a reserved username", async () => {
    const err = await fails(asUser(db, ALICE, `UPDATE profiles SET username = 'owner' WHERE user_id = $1`, [ALICE]));
    expect(err).toMatch(/reserved/);
  });

  const insertLink = (url: string) =>
    asUser(db, ALICE, `INSERT INTO social_links (platform, url, user_id) VALUES ('website', $1, $2)`, [url, ALICE]);

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox",
    "file:///etc/passwd",
  ])("rejects link %j", async (url) => {
    expect(await fails(insertLink(url))).toMatch(/social_links_url_allowed/);
  });

  it.each(["", "https://instagram.com/me", "http://example.com", "mailto:me@example.com", "tel:+15555555555", "sms:+15555555555", "me@example.com", "yourhandle#0001"])(
    "accepts link %j",
    async (url) => {
      expect(await fails(insertLink(url))).toBeNull();
    },
  );

  const updateProfile = (patch: string, params: unknown[] = []) =>
    asUser(db, ALICE, `UPDATE profiles SET ${patch} WHERE user_id = '${ALICE}'`, params);

  it("limits bio and display name length", async () => {
    expect(await fails(updateProfile(`bio = $1`, ["x".repeat(1001)]))).toMatch(/profiles_bio_length/);
    expect(await fails(updateProfile(`display_name = $1`, ["x".repeat(51)]))).toMatch(/profiles_display_name_length/);
    expect(await fails(updateProfile(`bio = $1`, ["📚".repeat(1000)]))).toBeNull();
  });

  it("validates avatar sizes, bio alignment and animation intensity", async () => {
    expect(await fails(updateProfile(`avatar_size = 176, bio_alignment = 'left', skin_intensity = 'subtle'`))).toBeNull();
    expect(await fails(updateProfile(`avatar_size = 1000`))).toMatch(/avatar_size_check/);
    expect(await fails(updateProfile(`bio_alignment = 'right'`))).toMatch(/bio_alignment_check/);
    expect(await fails(updateProfile(`skin_intensity = 'fast'`))).toMatch(/skin_intensity_check/);
  });

  it("accepts up to three additional photos from the profile owner's avatar folder", async () => {
    const own = (file: string) => `${PROJECT}/storage/v1/object/public/avatars/${ALICE}/${file}`;
    const update = (photos: (string | null)[]) => updateProfile("avatar_gallery = $1", [photos]);
    expect(await fails(update([own("one.jpg"), own("two.png"), own("three.webp")]))).toBeNull();
    for (const photos of [
      [own("one.jpg"), own("two.png"), own("three.webp"), own("four.gif")],
      [`${PROJECT}/storage/v1/object/public/avatars/${OWNER}/portrait.png`],
      ["https://outside.example/avatar.webp"], [null],
    ]) expect(await fails(update(photos))).toMatch(/avatar_gallery_check/);
  });

  it("only accepts hex colors and listed styles in a custom theme", async () => {
    expect(
      await fails(updateProfile(`theme = 'custom', custom_theme = $1`, [JSON.stringify({ background: "url(https://evil.test/p.png)" })])),
    ).toMatch(/profiles_custom_theme_valid/);
    expect(
      await fails(updateProfile(`custom_theme = $1`, [JSON.stringify({ font: "comic" })])),
    ).toMatch(/profiles_custom_theme_valid/);
    expect(
      await fails(
        updateProfile(`theme = 'custom', custom_theme = $1`, [
          JSON.stringify({ background: "#1a1a2e", accent: "#a855f7", buttonStyle: "pill", font: "serif" }),
        ]),
      ),
    ).toBeNull();
  });

  it("only accepts an avatar from this project's bucket, in the user's own folder", async () => {
    expect(await fails(updateProfile(`avatar_url = $1`, ["https://tracker.test/pixel.png"]))).toMatch(
      /profiles_avatar_url_own_bucket/,
    );
    expect(
      await fails(updateProfile(`avatar_url = $1`, [`${PROJECT}/storage/v1/object/public/avatars/${OWNER}/a.png`])),
    ).toMatch(/profiles_avatar_url_own_bucket/);
    expect(
      await fails(updateProfile(`avatar_url = $1`, [`${PROJECT}/storage/v1/object/public/avatars/${ALICE}/avatar-1.png`])),
    ).toBeNull();
  });
});
