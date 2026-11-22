/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON from the database in assertions */
/**
 * Analytics on in-memory Postgres with every real migration applied:
 * recording, the on/off switch, limits, privacy of the events table, a
 * person's own numbers and the owner's site-wide numbers.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";
import { pgliteAdmin } from "./pglite-admin";
import { recordEvent } from "../../src/lib/analytics/record.server";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b1";
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0";

let db: PGlite;
let linkId: string;
let bobLinkId: string;
const svc = <T = Record<string, unknown>>(q: string, p: unknown[] = []) =>
  db.query<T>(q, p).then((r) => r.rows);

async function as<T = Record<string, unknown>>(who: string | null, q: string, p: unknown[] = []) {
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

const rec = (
  kind: string,
  opts: {
    username?: string | null;
    link?: string | null;
    slug?: string | null;
    visitor?: string | null;
    source?: string;
  } = {},
) =>
  svc<{ r: string }>(
    `SELECT public.record_analytics_event($1, $2, $3, $4, $5, NULL, 'ig', 'social', 'launch', 'mobile', 'us', $6) AS r`,
    [
      kind,
      opts.username ?? null,
      opts.link ?? null,
      opts.slug ?? null,
      opts.source ?? "instagram",
      opts.visitor === undefined ? "v1" : opts.visitor,
    ],
  ).then((rows) => rows[0].r);

async function signUp(id: string, username: string) {
  await svc(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(
    `ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN email_confirmed_at timestamptz`,
  );
  for (const sql of migrationSql()) await db.exec(sql);
  await db.exec(SUPABASE_GRANTS);
  // As in Supabase: new tables get default grants, then the migration's REVOKE applies.
  await db.exec(
    `REVOKE ALL ON public.analytics_events, public.analytics_settings FROM anon, authenticated`,
  );
  await signUp(OWNER, "boss");
  await signUp(ALICE, "alice");
  await signUp(BOB, "bob");
  await svc(`UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1`, [ALICE]);
  await svc(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')`, [OWNER]);
  [{ id: linkId }] = await svc<{ id: string }>(
    `INSERT INTO social_links (platform, url, user_id) VALUES ('instagram', 'https://www.Instagram.com/alice?x=1', $1) RETURNING id`,
    [ALICE],
  );
  [{ id: bobLinkId }] = await svc<{ id: string }>(
    `INSERT INTO social_links (platform, url, user_id) VALUES ('website', 'https://bob.example', $1) RETURNING id`,
    [BOB],
  );
  await svc(
    `INSERT INTO wishlists (user_id, slug, title, visibility) VALUES ($1, 'birthday', 'Birthday', 'public')`,
    [ALICE],
  );
}, 60_000);

afterAll(() => db?.close());

describe("analytics switch", () => {
  it("records nothing while off, which is the default", async () => {
    expect(await rec("profile_view", { username: "alice" })).toBe("off");
    expect((await svc(`SELECT count(*)::int AS n FROM analytics_events`))[0].n).toBe(0);
  });

  it("only an admin can turn it on, and it is logged", async () => {
    expect(await fails(as(ALICE, `SELECT public.owner_set_analytics_enabled(true)`))).toMatch(
      /not authorized/i,
    );
    expect(await fails(as(null, `SELECT public.owner_set_analytics_enabled(true)`))).toMatch(
      /permission denied/i,
    );
    await as(OWNER, `SELECT public.owner_set_analytics_enabled(true)`);
    expect((await as<{ e: boolean }>(null, `SELECT public.analytics_is_enabled() AS e`))[0].e).toBe(
      true,
    );
    const log = await svc<{ action: string }>(
      `SELECT action FROM admin_audit_log WHERE action LIKE 'analytics.%'`,
    );
    expect(log.map((l) => l.action)).toEqual(["analytics.enabled"]);
  });
});

describe("recording", () => {
  it("records views, clicks and wishlist views with the link's platform and host", async () => {
    expect(await rec("profile_view", { username: "Alice" })).toBe("ok");
    expect(await rec("link_click", { username: "alice", link: linkId })).toBe("ok");
    expect(await rec("wishlist_view", { username: "alice", slug: "birthday" })).toBe("ok");
    expect(await rec("home_view", { visitor: "v9" })).toBe("ok");
    expect(await rec("signup_cta", { username: "alice", visitor: "v9" })).toBe("ok");
    const [click] = await svc<{
      link_platform: string;
      link_host: string;
      country: string;
      utm_source: string;
    }>(
      `SELECT link_platform, link_host, country, utm_source FROM analytics_events WHERE kind = 'link_click'`,
    );
    expect(click).toEqual({
      link_platform: "instagram",
      link_host: "instagram.com",
      country: "US",
      utm_source: "ig",
    });
  });

  it("refuses unknown pages, other people's links and unknown kinds", async () => {
    expect(await rec("profile_view", { username: "nobody" })).toBe("not_found");
    expect(await rec("link_click", { username: "alice", link: bobLinkId })).toBe("not_found");
    expect(await rec("wishlist_view", { username: "alice", slug: "nope" })).toBe("not_found");
    expect(await fails(rec("made_up", { username: "alice" }))).toMatch(/unknown analytics event/i);
  });

  it("counts a reload once in 30 minutes, but every click", async () => {
    expect(await rec("profile_view", { username: "alice" })).toBe("duplicate");
    expect(await rec("profile_view", { username: "alice", visitor: "v2" })).toBe("ok");
    expect(await rec("link_click", { username: "alice", link: linkId })).toBe("ok");
  });

  it("stops one visitor after 300 events an hour", async () => {
    await svc(
      `INSERT INTO analytics_events (kind, profile_user_id, visitor_hash, occurred_at)
       SELECT 'link_click', $1, 'flood', now() - interval '5 minutes' FROM generate_series(1, 300)`,
      [BOB],
    );
    expect(await rec("link_click", { username: "bob", link: bobLinkId, visitor: "flood" })).toBe(
      "rate_limited",
    );
    await svc(`DELETE FROM analytics_events WHERE visitor_hash = 'flood'`);
  });

  it("browsers can't call the recorder or read or write events", async () => {
    expect(
      await fails(
        as(
          null,
          `SELECT public.record_analytics_event('profile_view','alice',NULL,NULL,'x',NULL,NULL,NULL,NULL,NULL,NULL,'z')`,
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(
      await fails(
        as(
          ALICE,
          `SELECT public.record_analytics_event('profile_view','alice',NULL,NULL,'x',NULL,NULL,NULL,NULL,NULL,NULL,'z')`,
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(await fails(as(ALICE, `SELECT * FROM analytics_events`))).toMatch(/permission denied/i);
    expect(await fails(as(null, `SELECT * FROM analytics_events`))).toMatch(/permission denied/i);
    expect(
      await fails(as(ALICE, `INSERT INTO analytics_events (kind) VALUES ('home_view')`)),
    ).toMatch(/permission denied/i);
    expect(await fails(as(ALICE, `UPDATE analytics_settings SET enabled = false`))).toMatch(
      /permission denied/i,
    );
  });

  it("stores no IP address column", async () => {
    const cols = await svc<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'analytics_events'`,
    );
    expect(cols.map((c) => c.column_name).some((c) => /ip/.test(c) && c !== "visitor_hash")).toBe(
      false,
    );
  });
});

describe("server recorder", () => {
  const admin = () => pgliteAdmin(db);
  const facts = { ip: "203.0.113.9", userAgent: UA, dnt: null, gpc: null, country: "ca" };

  it("hashes the visitor, classifies the source and records", async () => {
    const r = await recordEvent(
      admin(),
      { kind: "profile_view", username: "bob", referrer: "https://l.instagram.com/" },
      facts,
      "salt",
    );
    expect(r).toBe("ok");
    const [row] = await svc<{
      source: string;
      referrer_host: string;
      device: string;
      visitor_hash: string;
      country: string;
    }>(
      `SELECT source, referrer_host, device, visitor_hash, country FROM analytics_events WHERE profile_user_id = $1 AND kind = 'profile_view'`,
      [BOB],
    );
    expect(row.source).toBe("instagram");
    expect(row.referrer_host).toBe("l.instagram.com");
    expect(row.device).toBe("mobile");
    expect(row.country).toBe("CA");
    expect(row.visitor_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.visitor_hash).not.toContain("203.0.113.9");
  });

  it("skips Do Not Track, Global Privacy Control and bots without touching the database", async () => {
    const before = (await svc<{ n: number }>(`SELECT count(*)::int AS n FROM analytics_events`))[0]
      .n;
    expect(
      await recordEvent(
        admin(),
        { kind: "profile_view", username: "bob" },
        { ...facts, dnt: "1" },
        "salt",
      ),
    ).toBe("skipped");
    expect(
      await recordEvent(
        admin(),
        { kind: "profile_view", username: "bob" },
        { ...facts, gpc: "1" },
        "salt",
      ),
    ).toBe("skipped");
    expect(
      await recordEvent(
        admin(),
        { kind: "profile_view", username: "bob" },
        { ...facts, userAgent: "facebookexternalhit/1.1" },
        "salt",
      ),
    ).toBe("skipped");
    expect((await svc<{ n: number }>(`SELECT count(*)::int AS n FROM analytics_events`))[0].n).toBe(
      before,
    );
  });
});

describe("a person's own analytics", () => {
  it("shows totals, daily numbers, links and sources for their page only", async () => {
    const [{ a }] = await as<{ a: Record<string, any> }>(
      ALICE,
      `SELECT public.my_analytics(7) AS a`,
    );
    expect(a.enabled).toBe(true);
    expect(a.days).toBe(7);
    expect(a.totals.views).toBe(2);
    expect(a.totals.clicks).toBe(2);
    expect(a.totals.wishlist_views).toBe(1);
    expect(a.totals.visitors).toBe(2);
    expect(a.daily).toHaveLength(7);
    expect(a.daily.at(-1)).toMatchObject({ views: 2, clicks: 2 });
    expect(a.links).toEqual([
      { link_id: linkId, platform: "instagram", host: "instagram.com", clicks: 2, current: true },
    ]);
    expect(a.sources).toEqual([{ source: "instagram", views: 2 }]);
    expect(a.campaigns[0]).toMatchObject({ utm_source: "ig", utm_campaign: "launch" });
    const [{ b }] = await as<{ b: Record<string, any> }>(
      BOB,
      `SELECT public.my_analytics(30) AS b`,
    );
    expect(b.totals.views).toBe(1);
    expect(b.links).toEqual([]);
  });

  it("needs a signed-in person", async () => {
    expect(await fails(as(null, `SELECT public.my_analytics(30)`))).toMatch(/permission denied/i);
  });

  it("a deleted account takes its events with it", async () => {
    await signUp("00000000-0000-4000-8000-0000000000c1", "carol");
    await svc(
      `SELECT public.record_analytics_event('profile_view','carol',NULL,NULL,'direct',NULL,NULL,NULL,NULL,NULL,NULL,'vc')`,
    );
    await svc(`DELETE FROM profiles WHERE user_id = '00000000-0000-4000-8000-0000000000c1'`);
    await svc(`DELETE FROM user_roles WHERE user_id = '00000000-0000-4000-8000-0000000000c1'`);
    await svc(`DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-0000000000c1'`);
    expect(
      (
        await svc<{ n: number }>(
          `SELECT count(*)::int AS n FROM analytics_events WHERE visitor_hash = 'vc'`,
        )
      )[0].n,
    ).toBe(0);
  });
});

describe("owner analytics", () => {
  it("only admins can read it", async () => {
    expect(await fails(as(ALICE, `SELECT public.owner_analytics(30)`))).toMatch(/not authorized/i);
    expect(await fails(as(null, `SELECT public.owner_analytics(30)`))).toMatch(
      /permission denied/i,
    );
  });

  it("shows users, traffic, destinations, platforms, conversions and growth", async () => {
    const [{ o }] = await as<{ o: Record<string, any> }>(
      OWNER,
      `SELECT public.owner_analytics(30) AS o`,
    );
    expect(o.users.total).toBe(3);
    expect(o.users.signups).toBe(3);
    expect(o.users.active_7d).toBe(1);
    expect(o.users.pages_with_traffic).toBe(2);
    expect(o.traffic).toMatchObject({
      profile_views: 3,
      link_clicks: 2,
      wishlist_views: 1,
      home_views: 1,
      signup_clicks: 1,
    });
    expect(o.destinations).toEqual([{ host: "instagram.com", clicks: 2 }]);
    expect(o.platforms).toEqual(
      expect.arrayContaining([
        { platform: "instagram", links: 1, clicks: 2 },
        { platform: "website", links: 1, clicks: 0 },
      ]),
    );
    expect(o.conversions).toMatchObject({ home_visitors: 1, signups: 3, founding_active: 0 });
    expect(o.daily).toHaveLength(30);
    expect(o.growth).toHaveLength(12);
    expect(o.growth.at(-1).total).toBe(3);
    expect(o.top_pages[0]).toMatchObject({ username: "alice", views: 2, clicks: 2 });
  });
});

describe("rollback", () => {
  it("removes only what the migration added", async () => {
    const down = readFileSync(
      join(__dirname, "..", "rollbacks", "20261122130000_analytics.down.sql"),
      "utf8",
    );
    await db.exec(down);
    const left = await svc(
      `SELECT to_regclass('public.analytics_events') AS e, to_regclass('public.analytics_settings') AS s`,
    );
    expect(left[0]).toEqual({ e: null, s: null });
    expect((await svc<{ n: number }>(`SELECT count(*)::int AS n FROM social_links`))[0].n).toBe(2);
    expect((await svc<{ n: number }>(`SELECT count(*)::int AS n FROM profiles`))[0].n).toBe(3);
    const fns = await svc(`SELECT proname FROM pg_proc WHERE proname LIKE '%analytics%'`);
    expect(fns).toEqual([]);
    // And it can be applied again.
    await db.exec(
      readFileSync(join(__dirname, "..", "migrations", "20261122130000_analytics.sql"), "utf8"),
    );
    expect((await svc(`SELECT to_regclass('public.analytics_events') AS e`))[0].e).not.toBeNull();
  });
});
