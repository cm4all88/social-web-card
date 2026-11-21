/**
 * Lookalike usernames and blocked link domains (20261122100000 and
 * 20261122101000), on in-memory Postgres with every real migration applied.
 * Checks that existing usernames and links are kept, the rules hold, the
 * browser copy of the username rule agrees with the database, and each
 * rollback puts the schema back exactly.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IMPERSONATION_TERMS,
  usernameError,
  usernameIsImpersonation,
} from "../../src/lib/username";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b1";
const USERNAMES = "20261122100000_username_impersonation";
const DOMAINS = "20261122101000_link_domain_blocks";

let db: PGlite;
const svc = (sql: string, params: unknown[] = []) => db.query(sql, params);
async function as<T = Record<string, unknown>>(
  who: string | null,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec(
    who ? `SET request.jwt.claim.sub = '${who}'; SET ROLE authenticated;` : "SET ROLE anon;",
  );
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
const signUp = (id: string, username: string) =>
  svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${id}@example.test`,
    JSON.stringify({ username }),
  ]);
const migrationIndex = (all: string[], marker: string) => all.findIndex((s) => s.includes(marker));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(
    `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
  );
  const all = migrationSql();
  const first = migrationIndex(all, "CREATE TABLE public.impersonation_terms");
  for (const sql of all.slice(0, first)) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  // Rows that exist before the new rules: the owner's own brand name, and a link.
  await signUp(OWNER, "tahoma");
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
  await signUp(ALICE, "alice");
  await svc(
    `INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://shop.later-bad.example/x', $1)`,
    [ALICE],
  );
  for (const sql of all.slice(first)) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
}, 60_000);

afterAll(() => db?.close());

describe("lookalike usernames", () => {
  it("keep existing usernames, including the owner's", async () => {
    const rows = (await svc(`SELECT username FROM profiles ORDER BY username`)).rows as {
      username: string;
    }[];
    expect(rows.map((r) => r.username)).toEqual(["alice", "tahoma"]);
    await svc(`UPDATE profiles SET display_name = 'Tahoma' WHERE user_id = $1`, [OWNER]);
  });

  const blocked = [
    "paypa1",
    "pay-pal-help",
    "y00its",
    "yooits-admin",
    "adm1n",
    "supp0rt",
    "official-chris",
    "instagramsupport",
    "rnicrosoft",
    "c4shapp",
    "chase",
    "apple",
    "meta",
    "tahoma-team",
    "verify-account",
    "help",
    "h-e-l-p",
  ];
  const allowed = [
    "badminton",
    "chasesmith",
    "pineapple",
    "metallica",
    "jane_doe",
    "dj-kai",
    "applecrumble",
    "supper-club",
    "alice2",
    "mod-podge-art",
  ];

  it("refuse lookalikes of brands and staff at signup and on rename", async () => {
    let n = 0;
    for (const name of blocked) {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      expect(await fails(signUp(id, name)), name).toMatch(/reserved/);
    }
    expect(
      await fails(
        as(ALICE, `UPDATE profiles SET username = 'paypal-alice' WHERE user_id = '${ALICE}'`),
      ),
    ).toMatch(/reserved/);
  });

  it("allow ordinary names that only share letters", async () => {
    let n = 100;
    for (const name of allowed) {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      expect(await fails(signUp(id, name)), name).toBeNull();
    }
  });

  it("give the same answer in the browser as in the database", async () => {
    for (const name of [...blocked, ...allowed, "tahoma", "x1", "zz"]) {
      const [{ r }] = (await svc(`SELECT public.username_is_reserved($1) AS r`, [name])).rows as {
        r: boolean;
      }[];
      expect(usernameError(name) !== null && r, name).toBe(r);
      if (!r) expect(usernameIsImpersonation(name), name).toBe(false);
    }
    const terms = (await svc(`SELECT term, match FROM impersonation_terms ORDER BY term`)).rows as {
      term: string;
      match: "contains" | "exact" | "affix";
    }[];
    const ts = Object.entries(IMPERSONATION_TERMS)
      .flatMap(([match, list]) => list.map((term) => ({ term, match })))
      .sort((a, b) => (a.term < b.term ? -1 : 1));
    expect(ts).toEqual(terms);
  });
});

describe("blocked link domains", () => {
  it("only admins change the lists, and every change is logged", async () => {
    expect(
      await fails(as(ALICE, `SELECT public.owner_set_link_domain('block', 'evil.example', true)`)),
    ).toMatch(/Not authorized/);
    expect(
      await fails(as(null, `SELECT public.owner_set_link_domain('block', 'evil.example', true)`)),
    ).toMatch(/permission denied/);
    const [{ d }] = await as<{ d: string }>(
      OWNER,
      `SELECT public.owner_set_link_domain('block', 'https://www.Evil.Example/login', true, 'phishing kit') AS d`,
    );
    expect(d).toBe("evil.example");
    expect(
      await fails(as(OWNER, `SELECT public.owner_set_link_domain('block', 'not a site', true)`)),
    ).toMatch(/example\.com/);
    const log = (
      await svc(
        `SELECT action, target_id, details FROM admin_audit_log WHERE target_type = 'domain'`,
      )
    ).rows;
    expect(log).toEqual([
      {
        action: "link_domain.blocked",
        target_id: "evil.example",
        details: { reason: "phishing kit" },
      },
    ]);
    expect(
      await fails(as(ALICE, `INSERT INTO link_domain_blocks (domain) VALUES ('x.example')`)),
    ).not.toBeNull();
  });

  it("refuse new links to a blocked site and its subdomains, on profiles and wishlists", async () => {
    for (const url of [
      "https://evil.example",
      "http://login.EVIL.example./a?b",
      "evil.example/path",
      "https://a.b.evil.example:8443/",
    ]) {
      expect(
        await fails(
          as(
            ALICE,
            `INSERT INTO social_links (platform, url, user_id) VALUES ('website', $1, $2)`,
            [url, ALICE],
          ),
        ),
        url,
      ).toMatch(/blocked for safety/);
    }
    for (const url of [
      "https://notevil.example",
      "https://evil.example.com",
      "mailto:a@evil.example",
      "tel:+15551234567",
      "@evilhandle",
    ]) {
      expect(
        await fails(
          as(
            ALICE,
            `INSERT INTO social_links (platform, url, user_id) VALUES ('website', $1, $2)`,
            [url, ALICE],
          ),
        ),
        url,
      ).toBeNull();
    }
    const [{ id: wl }] = await as<{ id: string }>(
      ALICE,
      `INSERT INTO wishlists (user_id, title, slug, visibility) VALUES ($1, 'Mine', 'mine', 'public') RETURNING id`,
      [ALICE],
    );
    expect(
      await fails(
        as(
          ALICE,
          `INSERT INTO wishlist_items (wishlist_id, user_id, name, url) VALUES ($1, $2, 'x', 'https://evil.example/p')`,
          [wl, ALICE],
        ),
      ),
    ).toMatch(/blocked for safety/);
  });

  it("hide existing links to a newly blocked site from the public, without deleting them", async () => {
    await as(OWNER, `SELECT public.owner_set_link_domain('block', 'later-bad.example', true)`);
    const url = "https://shop.later-bad.example/x";
    const count = async (who: string | null) =>
      (
        await as<{ n: number }>(who, `SELECT count(*)::int AS n FROM social_links WHERE url = $1`, [
          url,
        ])
      )[0].n;
    expect(await count(null)).toBe(0);
    expect(await count(BOB)).toBe(0);
    expect(await count(ALICE)).toBe(1);
    expect(await count(OWNER)).toBe(1);
    // Editing another field of the hidden link still works.
    expect(
      await fails(as(ALICE, `UPDATE social_links SET display_order = 5 WHERE url = $1`, [url])),
    ).toBeNull();
    const [{ l }] = await as<{ l: { blocks: { domain: string; links_hidden: number }[] } }>(
      OWNER,
      `SELECT public.owner_link_domain_lists() AS l`,
    );
    expect(l.blocks.find((b) => b.domain === "later-bad.example")?.links_hidden).toBe(1);
  });

  it("let the allow list overrule a block (false positives)", async () => {
    await as(
      OWNER,
      `SELECT public.owner_set_link_domain('allow', 'shop.later-bad.example', true, 'checked, safe')`,
    );
    expect(
      (
        await as<{ n: number }>(
          null,
          `SELECT count(*)::int AS n FROM social_links WHERE url = 'https://shop.later-bad.example/x'`,
        )
      )[0].n,
    ).toBe(1);
    expect(
      await fails(
        as(
          ALICE,
          `INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://shop.later-bad.example/y', $1)`,
          [ALICE],
        ),
      ),
    ).toBeNull();
    expect(
      await fails(
        as(
          ALICE,
          `INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://other.later-bad.example', $1)`,
          [ALICE],
        ),
      ),
    ).toMatch(/blocked/);
    await as(OWNER, `SELECT public.owner_set_link_domain('block', 'evil.example', false)`);
    expect(
      await fails(
        as(
          ALICE,
          `INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://evil.example', $1)`,
          [ALICE],
        ),
      ),
    ).toBeNull();
  });
});

describe("rollbacks", () => {
  const schema = async (d: PGlite) =>
    (
      await d.query<{ s: string }>(
        `SELECT (SELECT string_agg(p.proname || '=' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl, ' '), ''), ',' ORDER BY p.proname)
                   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
             || '|' || (SELECT string_agg(table_name || '.' || column_name, ',' ORDER BY table_name, ordinal_position)
                   FROM information_schema.columns WHERE table_schema = 'public')
             || '|' || (SELECT string_agg(tablename || '.' || policyname, ',' ORDER BY tablename, policyname) FROM pg_policies WHERE schemaname = 'public')
             || '|' || (SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE NOT tgisinternal) AS s`,
      )
    ).rows[0].s;

  it("put the schema back exactly, newest first", async () => {
    const all = migrationSql();
    const a = migrationIndex(all, "CREATE TABLE public.impersonation_terms");
    const b = migrationIndex(all, "CREATE TABLE public.link_domain_blocks");
    expect(b).toBe(a + 1);
    const d = new PGlite();
    await d.exec(SUPABASE_STUBS);
    await d.exec(
      `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
    );
    for (const sql of all.slice(0, a)) await d.exec(sql);
    await d.exec(SUPABASE_GRANTS);
    const before = await schema(d);
    await d.exec(all[a]);
    const middle = await schema(d);
    await d.exec(all[b]);
    const down = (name: string) =>
      readFileSync(new URL(`../rollbacks/${name}.down.sql`, import.meta.url), "utf8");
    await d.exec(down(DOMAINS));
    expect(await schema(d)).toBe(middle);
    await d.exec(down(USERNAMES));
    expect(await schema(d)).toBe(before);
    await d.close();
  }, 60_000);
});
