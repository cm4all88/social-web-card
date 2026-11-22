/**
 * Seasonal themes and rewards on in-memory Postgres with every real migration
 * applied: the flag keeps it all off, rewards are earned from the creator's
 * own rows (not from what the browser says), each reward unlocks one earned
 * theme, Plus includes them, seasonal themes need their season, Plus themes
 * still need Plus, and the rollback puts the schema back exactly.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";
import { SEASONAL_THEME_PRESETS, inSeasonWindow } from "@/lib/themes";

const OWNER = "00000000-0000-4000-8000-0000000001aa";
const FREE = "00000000-0000-4000-8000-0000000001f1";
const PLUS = "00000000-0000-4000-8000-0000000001f2";
const OTHER = "00000000-0000-4000-8000-0000000001f3";
const ROLLBACK = new URL(
  "../rollbacks/20261122125000_seasonal_themes_rewards.down.sql",
  import.meta.url,
);

let db: PGlite;
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
const claim = async (who: string) =>
  (
    await as<{ r: { enabled: boolean; unlocked: string[]; new: string[] } }>(
      who,
      `SELECT public.claim_theme_rewards() AS r`,
    )
  )[0].r;
const setTheme = (who: string, key: string) =>
  fails(as(who, `UPDATE public.profiles SET theme = $2 WHERE user_id = $1`, [who, key]));
const flag = (on: boolean) =>
  svc(`UPDATE public.app_flags SET enabled = $1 WHERE key = 'themes_rewards'`, [on]);

async function signUp(d: PGlite, id: string, username: string) {
  await d.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
}
async function freshDb(upTo?: (s: string) => boolean) {
  const d = new PGlite();
  await d.exec(SUPABASE_STUBS);
  await d.exec(
    `ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz, ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz`,
  );
  for (const sql of migrationSql()) {
    if (upTo?.(sql)) break;
    await d.exec(sql);
  }
  await d.exec(SUPABASE_GRANTS);
  return d;
}

const now = new Date();
const inSeason = SEASONAL_THEME_PRESETS.filter(
  (t) => !t.premium && inSeasonWindow(t.season!, now),
).map((t) => t.key);
const outOfSeason = SEASONAL_THEME_PRESETS.filter(
  (t) => !t.premium && !inSeasonWindow(t.season!, now),
).map((t) => t.key);

beforeAll(async () => {
  db = await freshDb();
  for (const [id, name] of [
    [OWNER, "theboss"],
    [FREE, "sam"],
    [PLUS, "jordan"],
    [OTHER, "maya"],
  ] as const)
    await signUp(db, id, name);
  await svc(
    `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`,
    [OWNER],
  );
  await svc(
    `INSERT INTO public.plan_entitlements (user_id, plan, source, ends_at) VALUES ($1, 'plus', 'founding_creator', now() + interval '3 months')`,
    [PLUS],
  );
}, 90_000);

afterAll(async () => {
  await db?.close();
});

describe("season windows", () => {
  it("match between TypeScript and the database, including across the new year", async () => {
    const dates = [
      "2026-01-01",
      "2026-01-06",
      "2026-01-07",
      "2026-02-14",
      "2026-02-28",
      "2026-03-01",
      "2026-04-10",
      "2026-07-04",
      "2026-09-30",
      "2026-11-19",
      "2026-11-20",
      "2026-12-25",
      "2026-12-31",
    ];
    for (const t of SEASONAL_THEME_PRESETS) {
      for (const day of dates) {
        const at = new Date(`${day}T12:00:00Z`);
        const r = await svc<{ v: boolean }>(`SELECT public.theme_in_season($1, $2) AS v`, [
          t.key,
          at.toISOString(),
        ]);
        expect(r[0].v, `${t.key} ${day}`).toBe(inSeasonWindow(t.season!, at));
      }
    }
    expect(inSeasonWindow({ from: "11-20", to: "02-28" }, new Date("2026-12-25T00:00:00Z"))).toBe(
      true,
    );
    expect(inSeasonWindow({ from: "11-20", to: "02-28" }, new Date("2026-03-01T00:00:00Z"))).toBe(
      false,
    );
  });
});

describe("with the flag off", () => {
  it("earns nothing and refuses seasonal and earned themes, while free and Plus themes work as before", async () => {
    const r = await claim(FREE);
    expect(r).toEqual({ enabled: false, unlocked: [], new: [] });
    expect((await as<{ v: boolean }>(FREE, `SELECT public.record_profile_share() AS v`))[0].v).toBe(
      false,
    );
    for (const k of [...inSeason, "starlight"]) expect(await setTheme(FREE, k)).not.toBeNull();
    expect(await setTheme(FREE, "sunset")).toBeNull();
    expect(await setTheme(FREE, "aurora")).toMatch(/part of Plus/);
    expect(await setTheme(PLUS, "aurora")).toBeNull();
    // Plus includes earned themes even before rewards launch.
    expect(await setTheme(PLUS, "prism")).toBeNull();
  });
});

describe("with the flag on", () => {
  beforeAll(async () => {
    await flag(true);
  });

  it("earns rewards from the creator's own rows, once each", async () => {
    expect((await claim(FREE)).new).toEqual([]);
    await svc(
      `UPDATE public.profiles SET display_name = 'Sam', bio = 'hi', avatar_url = 'https://abc.supabase.co/storage/v1/object/public/avatars/' || user_id || '/a.png' WHERE user_id = $1`,
      [FREE],
    );
    for (let i = 0; i < 5; i++)
      await svc(
        `INSERT INTO public.social_links (user_id, platform, url, display_order, enabled) VALUES ($1, 'website', $2, $3, true)`,
        [FREE, i === 4 ? "" : `https://sam${i}.test`, i],
      );
    // 4 live links (one has no address): not yet.
    let r = await claim(FREE);
    expect(r.new).toEqual(["profile_complete"]);
    await svc(
      `UPDATE public.social_links SET url = 'https://sam4.test' WHERE user_id = $1 AND url = ''`,
      [FREE],
    );
    r = await claim(FREE);
    expect(r.new).toEqual(["five_links"]);
    expect(r.unlocked.sort()).toEqual(["five_links", "profile_complete"]);
    expect((await claim(FREE)).new).toEqual([]);

    // A wishlist counts once it has an item.
    const w = await svc<{ id: string }>(
      `INSERT INTO public.wishlists (user_id, slug, title) VALUES ($1, 'bday', 'Birthday') RETURNING id`,
      [FREE],
    );
    expect((await claim(FREE)).new).toEqual([]);
    await svc(
      `INSERT INTO public.wishlist_items (wishlist_id, user_id, name) VALUES ($1, $2, 'Book')`,
      [w[0].id, FREE],
    );
    expect((await claim(FREE)).new).toEqual(["first_wishlist"]);

    // A week on Yooits with a live link.
    expect((await claim(FREE)).unlocked).not.toContain("one_week");
    await svc(
      `UPDATE public.profiles SET created_at = now() - interval '8 days' WHERE user_id = $1`,
      [FREE],
    );
    expect((await claim(FREE)).new).toEqual(["one_week"]);

    // First share, reported by the dashboard.
    expect((await as<{ v: boolean }>(FREE, `SELECT public.record_profile_share() AS v`))[0].v).toBe(
      true,
    );
    expect((await as<{ v: boolean }>(FREE, `SELECT public.record_profile_share() AS v`))[0].v).toBe(
      false,
    );
    expect((await claim(FREE)).unlocked).toHaveLength(5);
  });

  it("sends one dashboard notification per new reward once notifications exist", async () => {
    await svc(
      `CREATE TABLE IF NOT EXISTS public._notified (user_id uuid, kind text, title text, body text, link text, dedupe text)`,
    );
    await svc(`CREATE OR REPLACE FUNCTION public.notify_user(_user_id uuid, _kind text, _title text, _body text DEFAULT NULL,
                 _link text DEFAULT NULL, _dedupe_key text DEFAULT NULL) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
                 INSERT INTO public._notified VALUES (_user_id, _kind, _title, _body, _link, _dedupe_key); SELECT gen_random_uuid() $$`);
    await svc(
      `REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, text, text) FROM public, anon, authenticated`,
    );
    expect((await as<{ v: boolean }>(PLUS, `SELECT public.record_profile_share() AS v`))[0].v).toBe(
      true,
    );
    expect((await as<{ v: boolean }>(PLUS, `SELECT public.record_profile_share() AS v`))[0].v).toBe(
      false,
    );
    const n = await svc<Record<string, string>>(`SELECT * FROM public._notified`);
    expect(n).toEqual([
      {
        user_id: PLUS,
        kind: "reward_unlocked",
        title: "You unlocked the Confetti theme",
        body: "It's yours to use on your page. Pick it under Theme in your dashboard.",
        link: "/dashboard",
        dedupe: "reward:first_share",
      },
    ]);
    // A failing notifier never blocks the reward.
    await svc(`CREATE OR REPLACE FUNCTION public.notify_user(_user_id uuid, _kind text, _title text, _body text DEFAULT NULL,
                 _link text DEFAULT NULL, _dedupe_key text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
                 BEGIN RAISE EXCEPTION 'boom'; END $$`);
    await svc(
      `UPDATE public.profiles SET created_at = now() - interval '8 days' WHERE user_id = $1`,
      [PLUS],
    );
    await svc(
      `INSERT INTO public.social_links (user_id, platform, url, display_order, enabled) VALUES ($1, 'website', 'https://j.test', 0, true)`,
      [PLUS],
    );
    expect((await claim(PLUS)).new).toEqual(["one_week"]);
    await db.exec(
      `DROP FUNCTION public.notify_user(uuid, text, text, text, text, text); DROP TABLE public._notified`,
    );
  });

  it("can't be written or read by anyone else", async () => {
    for (const who of [OTHER, null]) {
      expect(
        await fails(
          as(
            who,
            `INSERT INTO public.user_rewards (user_id, reward_key) VALUES ($1, 'five_links')`,
            [OTHER],
          ),
        ),
      ).not.toBeNull();
    }
    expect(await fails(as(OTHER, `SELECT public.grant_reward($1, 'five_links')`, [OTHER]))).toMatch(
      /permission/,
    );
    expect(await fails(as(null, `SELECT public.claim_theme_rewards()`))).not.toBeNull();
    expect((await as(OTHER, `SELECT * FROM public.user_rewards`)).length).toBe(0);
    expect((await as(null, `SELECT * FROM public.user_rewards`)).length).toBe(0);
    expect((await as(FREE, `SELECT * FROM public.user_rewards`)).length).toBe(5);
    expect((await as(OWNER, `SELECT * FROM public.user_rewards`)).length).toBe(7);
    expect(await fails(as(FREE, `UPDATE public.app_flags SET enabled = false`))).toBeNull();
    expect(
      (
        await svc<{ e: boolean }>(
          `SELECT enabled AS e FROM public.app_flags WHERE key = 'themes_rewards'`,
        )
      )[0].e,
    ).toBe(true);
  });

  it("lets earned themes through without Plus, and only those earned", async () => {
    expect(await setTheme(FREE, "starlight")).toBeNull();
    expect(await setTheme(OTHER, "starlight")).toMatch(/Earn this theme/);
    expect(
      (
        await as<{ v: boolean }>(null, `SELECT public.public_profile_theme_unlocked($1) AS v`, [
          FREE,
        ])
      )[0].v,
    ).toBe(true);
    // Plus has every earned theme; the public check is only for earned ones.
    expect(await setTheme(PLUS, "lagoon")).toBeNull();
    expect(
      (
        await as<{ v: boolean }>(null, `SELECT public.public_profile_theme_unlocked($1) AS v`, [
          PLUS,
        ])
      )[0].v,
    ).toBe(false);
    // Plus themes still need Plus, even with every reward earned.
    expect(await setTheme(FREE, "gilded")).toMatch(/part of Plus/);
  });

  it("lets seasonal themes through only in season, and keeps a picked one afterwards", async () => {
    for (const k of inSeason) expect(await setTheme(OTHER, k), k).toBeNull();
    for (const k of outOfSeason) expect(await setTheme(OTHER, k), k).toMatch(/out of season/);
    if (inSeason.length) {
      await setTheme(OTHER, inSeason[0]);
      // Editing anything else keeps the theme, in or out of season.
      expect(
        await fails(
          as(OTHER, `UPDATE public.profiles SET bio = 'x', theme = $2 WHERE user_id = $1`, [
            OTHER,
            inSeason[0],
          ]),
        ),
      ).toBeNull();
    }
    // Holiday Lights is Plus-only as well as seasonal.
    expect(await setTheme(OTHER, "holiday_lights")).toMatch(/part of Plus/);
    const holiday = SEASONAL_THEME_PRESETS.find((t) => t.key === "holiday_lights")!;
    expect(await setTheme(PLUS, "holiday_lights")).toBe(
      inSeasonWindow(holiday.season!, now) ? null : expect.stringMatching(/out of season/),
    );
  });

  it("removes rewards with the account", async () => {
    expect(
      (await as<{ v: boolean }>(OTHER, `SELECT public.record_profile_share() AS v`))[0].v,
    ).toBe(true);
    expect(
      (await svc(`SELECT * FROM public.user_rewards WHERE user_id = $1`, [OTHER])).length,
    ).toBe(1);
    await svc(`DELETE FROM auth.users WHERE id = $1`, [OTHER]);
    expect(
      (await svc(`SELECT * FROM public.user_rewards WHERE user_id = $1`, [OTHER])).length,
    ).toBe(0);
  });
});

const one = async (d: PGlite, q: string) => (await d.query<{ v: string }>(q)).rows[0].v;
const snapshot = async (d: PGlite) => ({
  f: await one(
    d,
    `SELECT string_agg(p.proname || '=' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl, ' '), ''), ',' ORDER BY p.proname, p.oid) AS v
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`,
  ),
  c: await one(
    d,
    `SELECT string_agg(table_name || '.' || column_name || ':' || data_type, ',' ORDER BY table_name, ordinal_position) AS v
            FROM information_schema.columns WHERE table_schema = 'public'`,
  ),
  p: await one(
    d,
    `SELECT coalesce(string_agg(tablename || '.' || policyname || ':' || md5(coalesce(qual,'') || coalesce(with_check,'')), ',' ORDER BY tablename, policyname), '') AS v FROM pg_policies WHERE schemaname = 'public'`,
  ),
  t: await one(
    d,
    `SELECT coalesce(string_agg(tgname, ',' ORDER BY tgname), '') AS v FROM pg_trigger WHERE NOT tgisinternal`,
  ),
  prof: await one(
    d,
    `SELECT md5(string_agg(row(id, user_id, username, display_name, bio, theme, custom_theme, avatar_url, hide_branding, updated_at)::text, '|' ORDER BY id)) AS v FROM public.profiles`,
  ),
});

describe("seasonal themes and rewards migration", () => {
  it("only adds, keeps every row, and its rollback puts the schema back except the shared flags table", async () => {
    const d = await freshDb((s) => s.includes("CREATE TABLE public.user_rewards"));
    await signUp(d, FREE, "alice");
    await d.query(`UPDATE public.profiles SET theme = 'royal', bio = 'hello' WHERE user_id = $1`, [
      FREE,
    ]);
    const before = await snapshot(d);
    const mine = migrationSql().find((s) => s.includes("CREATE TABLE public.user_rewards"))!;
    await d.exec(mine);
    await d.exec(SUPABASE_GRANTS);
    const after = await snapshot(d);
    expect(after.prof).toBe(before.prof);
    const newCols = after.c.split(",").filter((x) => !before.c.split(",").includes(x));
    expect(newCols.every((c) => c.startsWith("user_rewards.") || c.startsWith("app_flags."))).toBe(
      true,
    );

    // Roll back: everything but the shared flags table goes.
    await d.exec(readFileSync(ROLLBACK, "utf8"));
    const rolled = await snapshot(d);
    const strip = (s: string) =>
      s
        .split(",")
        .filter((x) => !x.startsWith("app_flags.") && !x.startsWith("app_flag_on="))
        .join(",");
    expect(strip(rolled.f)).toBe(strip(before.f));
    expect(strip(rolled.c)).toBe(strip(before.c));
    expect(strip(rolled.p)).toBe(strip(before.p));
    expect(rolled.t).toBe(before.t);
    expect(rolled.prof).toBe(before.prof);
    // And it can be applied again after a rollback.
    await d.exec(mine);
    await d.close();
  }, 90_000);
});
