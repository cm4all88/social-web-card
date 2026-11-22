/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Links first (migration 20261122180000_links_first.sql) on in-memory
 * Postgres with every real migration applied: existing links keep working,
 * titles/icons/featured/sections are owner-only, sections show on public
 * pages only, per-link click counts, and an exact rollback.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b1";

let db: PGlite;
let aliceLink: string;
let bobLink: string;
const svc = <T = Record<string, any>>(q: string, p: unknown[] = []) =>
  db.query<T>(q, p).then((r) => r.rows);
async function as<T = Record<string, any>>(who: string | null, q: string, p: unknown[] = []) {
  await db.exec(
    who ? `SET request.jwt.claim.sub = '${who}'; SET ROLE authenticated;` : "SET ROLE anon;",
  );
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

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(
    `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
  );
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  await db.exec(
    `REVOKE ALL ON public.analytics_events, public.analytics_settings FROM anon, authenticated`,
  );
  for (const [id, u] of [
    [OWNER, "boss"],
    [ALICE, "alice"],
    [BOB, "bob"],
  ]) {
    await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
      id,
      `${u}@example.test`,
      JSON.stringify({ username: u }),
    ]);
  }
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
  [{ id: aliceLink }] = await svc<{ id: string }>(
    `INSERT INTO social_links (platform, url, user_id, display_order) VALUES ('instagram', 'https://instagram.com/alice', $1, 1) RETURNING id`,
    [ALICE],
  );
  [{ id: bobLink }] = await svc<{ id: string }>(
    `INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://bob.example', $1) RETURNING id`,
    [BOB],
  );
}, 60_000);

afterAll(() => db?.close());

describe("existing links", () => {
  it("get no title, no icon, not featured and no section", async () => {
    const [l] = await svc(
      `SELECT title, icon, featured, section_id FROM social_links WHERE id = $1`,
      [aliceLink],
    );
    expect(l).toEqual({ title: null, icon: null, featured: false, section_id: null });
  });
});

describe("titles, icons and featured", () => {
  it("the owner can set them", async () => {
    await as(
      ALICE,
      `UPDATE social_links SET title = 'My photos', icon = 'camera', featured = true WHERE id = $1`,
      [aliceLink],
    );
    const [l] = await svc(`SELECT title, icon, featured FROM social_links WHERE id = $1`, [
      aliceLink,
    ]);
    expect(l).toEqual({ title: "My photos", icon: "camera", featured: true });
  });

  it("nobody else can", async () => {
    await as(BOB, `UPDATE social_links SET title = 'hacked' WHERE id = $1`, [aliceLink]);
    const [l] = await svc(`SELECT title FROM social_links WHERE id = $1`, [aliceLink]);
    expect(l.title).toBe("My photos");
  });

  it("rejects long titles, control characters and odd icon names", async () => {
    expect(
      await fails(
        as(ALICE, `UPDATE social_links SET title = repeat('x', 81) WHERE id = $1`, [aliceLink]),
      ),
    ).toMatch(/check/i);
    expect(
      await fails(as(ALICE, `UPDATE social_links SET title = E'a\\nb' WHERE id = $1`, [aliceLink])),
    ).toMatch(/check/i);
    expect(
      await fails(
        as(ALICE, `UPDATE social_links SET icon = 'Bad Icon' WHERE id = $1`, [aliceLink]),
      ),
    ).toMatch(/check/i);
  });
});

describe("sections", () => {
  let aliceSection: string;
  let bobSection: string;

  it("owners create their own", async () => {
    [{ id: aliceSection }] = await as<{ id: string }>(
      ALICE,
      `INSERT INTO link_sections (user_id, title, display_order) VALUES ($1, 'Shop', 1) RETURNING id`,
      [ALICE],
    );
    [{ id: bobSection }] = await as<{ id: string }>(
      BOB,
      `INSERT INTO link_sections (user_id, title) VALUES ($1, 'Contact') RETURNING id`,
      [BOB],
    );
    expect(aliceSection).toBeTruthy();
  });

  it("can't be made for someone else, or blank", async () => {
    expect(
      await fails(as(BOB, `INSERT INTO link_sections (user_id, title) VALUES ($1, 'x')`, [ALICE])),
    ).toMatch(/row-level security/i);
    expect(
      await fails(
        as(ALICE, `INSERT INTO link_sections (user_id, title) VALUES ($1, '  ')`, [ALICE]),
      ),
    ).toMatch(/check/i);
  });

  it("a link goes only in its owner's own section", async () => {
    await as(ALICE, `UPDATE social_links SET section_id = $1 WHERE id = $2`, [
      aliceSection,
      aliceLink,
    ]);
    expect(
      await fails(
        as(BOB, `UPDATE social_links SET section_id = $1 WHERE id = $2`, [aliceSection, bobLink]),
      ),
    ).toMatch(/belongs to someone else/i);
  });

  it("visitors see sections of public pages only", async () => {
    expect(
      (await as(null, `SELECT title FROM link_sections WHERE user_id = $1`, [ALICE])).map(
        (r) => r.title,
      ),
    ).toEqual(["Shop"]);
    await svc(`INSERT INTO account_status (user_id, unpublished_at) VALUES ($1, now())`, [ALICE]);
    expect(await as(null, `SELECT title FROM link_sections WHERE user_id = $1`, [ALICE])).toEqual(
      [],
    );
    expect(
      await as(ALICE, `SELECT title FROM link_sections WHERE user_id = $1`, [ALICE]),
    ).toHaveLength(1);
    expect(
      await as(OWNER, `SELECT title FROM link_sections WHERE user_id = $1`, [ALICE]),
    ).toHaveLength(1);
    await svc(`DELETE FROM account_status WHERE user_id = $1`, [ALICE]);
  });

  it("nobody else can rename or delete them", async () => {
    await as(BOB, `UPDATE link_sections SET title = 'x' WHERE id = $1`, [aliceSection]);
    await as(BOB, `DELETE FROM link_sections WHERE id = $1`, [aliceSection]);
    expect(await svc(`SELECT title FROM link_sections WHERE id = $1`, [aliceSection])).toEqual([
      { title: "Shop" },
    ]);
  });

  it("deleting a section keeps its links, now unsectioned", async () => {
    await as(ALICE, `DELETE FROM link_sections WHERE id = $1`, [aliceSection]);
    const [l] = await svc(`SELECT section_id, url FROM social_links WHERE id = $1`, [aliceLink]);
    expect(l).toEqual({ section_id: null, url: "https://instagram.com/alice" });
    expect(bobSection).toBeTruthy();
  });

  it("stops at 20 per person", async () => {
    await svc(
      `INSERT INTO link_sections (user_id, title) SELECT $1, 'S' || g FROM generate_series(1, 20) g`,
      [ALICE],
    );
    expect(
      await fails(
        as(ALICE, `INSERT INTO link_sections (user_id, title) VALUES ($1, 'one more')`, [ALICE]),
      ),
    ).toMatch(/up to 20/i);
    await svc(`DELETE FROM link_sections WHERE user_id = $1`, [ALICE]);
  });
});

describe("my_link_clicks", () => {
  it("counts clicks on my own current links only", async () => {
    await svc(`UPDATE analytics_settings SET enabled = true`);
    await svc(
      `INSERT INTO analytics_events (kind, profile_user_id, link_id, occurred_at) VALUES
        ('link_click', $1, $2, now()),
        ('link_click', $1, $2, now() - interval '40 days'),
        ('profile_view', $1, NULL, now()),
        ('link_click', $3, $4, now())`,
      [ALICE, aliceLink, BOB, bobLink],
    );
    const [{ r }] = await as<{ r: any }>(ALICE, `SELECT public.my_link_clicks() AS r`);
    expect(r.enabled).toBe(true);
    expect(r.links).toEqual([{ link_id: aliceLink, total: 2, last_30: 1 }]);
  });

  it("needs a signed-in person", async () => {
    expect(await fails(as(null, `SELECT public.my_link_clicks()`))).toMatch(/permission denied/i);
  });
});

describe("rollback", () => {
  it("puts the schema back and keeps every link", async () => {
    const all = migrationSql();
    const idx = all.findIndex((s) => s.includes("CREATE TABLE public.link_sections"));
    const fresh = new PGlite();
    await fresh.exec(SUPABASE_STUBS);
    await fresh.exec(
      `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
    );
    for (const sql of all.slice(0, idx)) await fresh.exec(sql);
    await fresh.exec(SUPABASE_GRANTS);
    await fresh.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'a@x.test', '{"username":"alice"}')`,
      [ALICE],
    );
    await fresh.query(
      `INSERT INTO social_links (platform, url, user_id, display_order) VALUES ('website', 'https://a.example', $1, 3)`,
      [ALICE],
    );
    const snap = async () =>
      (
        await fresh.query<{ v: string }>(
          `SELECT (SELECT string_agg(table_name || '.' || column_name, ',' ORDER BY table_name, column_name) FROM information_schema.columns WHERE table_schema = 'public')
            || '|' || (SELECT string_agg(proname, ',' ORDER BY proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace)
            || '|' || (SELECT string_agg(tablename || '.' || policyname, ',' ORDER BY 1) FROM pg_policies WHERE schemaname = 'public')
            || '|' || (SELECT string_agg(platform || url || display_order || enabled, ',') FROM social_links) AS v`,
        )
      ).rows[0].v;
    const before = await snap();
    await fresh.exec(all[idx]);
    await fresh.exec(
      readFileSync(
        new URL("../rollbacks/20261122180000_links_first.down.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(await snap()).toBe(before);
    await fresh.close();
  }, 90_000);
});
