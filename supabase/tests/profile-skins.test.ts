/**
 * Profile skins on in-memory Postgres with every real migration applied:
 * skins share their theme's rules (season, Plus, earned), the flag keeps
 * them off, unknown skins are refused, theme rules and messages are
 * unchanged, and the rollback puts the schema back exactly.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrationSql, SUPABASE_GRANTS, SUPABASE_STUBS } from "./supabase-stubs";
import { findThemePreset, inSeasonWindow } from "@/lib/themes";
import { SKINS } from "@/lib/skins";

const FREE = "00000000-0000-4000-8000-0000000002f1";
const PLUS = "00000000-0000-4000-8000-0000000002f2";
const OTHER = "00000000-0000-4000-8000-0000000002f3";
const ROLLBACK = new URL("../rollbacks/20261122183000_profile_skins.down.sql", import.meta.url);
const MINE = (s: string) => s.includes("public.skin_theme(_skin text)");

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
const setSkin = (who: string, key: string | null) =>
  fails(as(who, `UPDATE public.profiles SET skin = $2 WHERE user_id = $1`, [who, key]));
const setTheme = (who: string, key: string) =>
  fails(as(who, `UPDATE public.profiles SET theme = $2 WHERE user_id = $1`, [who, key]));
const flag = (key: string, on: boolean) =>
  svc(`UPDATE public.app_flags SET enabled = $1 WHERE key = $2`, [on, key]);
const state = async (who: string) =>
  (
    await as<{ v: { on: boolean; unlocked: boolean } }>(
      null,
      `SELECT public.public_profile_skin_state($1) AS v`,
      [who],
    )
  )[0].v;

async function signUp(d: PGlite, id: string, username: string) {
  await d.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    `${username}@example.test`,
    JSON.stringify({ username }),
  ]);
}
async function freshDb(stop?: (s: string) => boolean) {
  const d = new PGlite();
  await d.exec(SUPABASE_STUBS);
  await d.exec(
    `ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz, ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz`,
  );
  for (const sql of migrationSql()) {
    if (stop?.(sql)) break;
    await d.exec(sql);
  }
  await d.exec(SUPABASE_GRANTS);
  return d;
}

const now = new Date();
const seasonOf = (skin: string) => findThemePreset(SKINS.find((s) => s.key === skin)!.theme)!;
const seasonalSkins = SKINS.filter((s) => seasonOf(s.key).season).map((s) => s.key);
const inSeason = seasonalSkins.filter((k) => inSeasonWindow(seasonOf(k).season!, now));
const outOfSeason = seasonalSkins.filter((k) => !inSeason.includes(k));

beforeAll(async () => {
  db = await freshDb();
  for (const [id, name] of [
    [FREE, "sam"],
    [PLUS, "jordan"],
    [OTHER, "maya"],
  ] as const)
    await signUp(db, id, name);
  await svc(
    `INSERT INTO public.plan_entitlements (user_id, plan, source, ends_at) VALUES ($1, 'plus', 'founding_creator', now() + interval '3 months')`,
    [PLUS],
  );
  await flag("themes_rewards", true);
}, 90_000);

afterAll(async () => {
  await db?.close();
});

describe("skins", () => {
  it("map to the same themes in TypeScript and the database", async () => {
    for (const s of SKINS) {
      const r = await svc<{ v: string }>(`SELECT public.skin_theme($1) AS v`, [s.key]);
      expect(r[0].v, s.key).toBe(s.theme);
    }
    expect((await svc<{ v: string | null }>(`SELECT public.skin_theme('fire') AS v`))[0].v).toBe(
      null,
    );
  });

  it("stay off while the flag is off, but 'none' and the theme's own effect always save", async () => {
    expect(await setSkin(FREE, "snow")).toMatch(/aren't available yet/);
    expect(await setSkin(FREE, "none")).toBeNull();
    expect(await setSkin(FREE, null)).toBeNull();
    expect((await state(FREE)).on).toBe(false);
  });

  describe("with the flag on", () => {
    beforeAll(async () => {
      await flag("skins", true);
    });

    it("follow their theme's season, and stay picked afterwards", async () => {
      expect((await state(FREE)).on).toBe(true);
      for (const k of inSeason) expect(await setSkin(OTHER, k), k).toBeNull();
      for (const k of outOfSeason) expect(await setSkin(OTHER, k), k).toMatch(/out of season/);
      if (inSeason.length) {
        await setSkin(OTHER, inSeason[0]);
        expect(
          await fails(
            as(OTHER, `UPDATE public.profiles SET bio = 'x' WHERE user_id = $1`, [OTHER]),
          ),
        ).toBeNull();
      }
    });

    it("need their earned theme's reward, or Plus", async () => {
      expect(await setSkin(FREE, "stars")).toMatch(/Earn this effect/);
      expect(await setSkin(PLUS, "stars")).toBeNull();
      await svc(
        `INSERT INTO public.user_rewards (user_id, reward_key) VALUES ($1, 'profile_complete')`,
        [FREE],
      );
      expect(await setSkin(FREE, "stars")).toBeNull();
      expect((await state(FREE)).unlocked).toBe(true);
      expect((await state(PLUS)).unlocked).toBe(false);
    });

    it("go with any theme the creator may use, and leave theme rules as they were", async () => {
      expect(await setSkin(FREE, "stars")).toBeNull();
      expect(await setTheme(FREE, "ocean")).toBeNull();
      expect(await setTheme(FREE, "aurora")).toMatch(/This theme is part of Plus/);
      expect(await setTheme(FREE, "prism")).toMatch(/Earn this theme/);
      expect(await setTheme(FREE, "starlight")).toBeNull();
    });

    it("refuse unknown or malformed keys", async () => {
      expect(await setSkin(FREE, "fire")).toMatch(/Unknown effect/);
      expect(await setSkin(FREE, "Snow!")).toMatch(/Unknown effect|profiles_skin_format/);
    });

    it("can't be set on someone else's profile", async () => {
      await as(OTHER, `UPDATE public.profiles SET skin = 'none' WHERE user_id = $1`, [FREE]);
      expect(
        (await svc<{ skin: string }>(`SELECT skin FROM public.profiles WHERE user_id = $1`, [FREE]))[0]
          .skin,
      ).toBe("stars");
    });
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
  t: await one(
    d,
    `SELECT coalesce(string_agg(tgname || ':' || md5(pg_get_triggerdef(oid)), ',' ORDER BY tgname), '') AS v FROM pg_trigger WHERE NOT tgisinternal`,
  ),
  k: await one(
    d,
    `SELECT coalesce(string_agg(conname, ',' ORDER BY conname), '') AS v FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass`,
  ),
  flags: await one(
    d,
    `SELECT coalesce(string_agg(key, ',' ORDER BY key), '') AS v FROM public.app_flags`,
  ),
  prof: await one(
    d,
    `SELECT md5(string_agg(row(id, user_id, username, display_name, bio, theme, custom_theme, avatar_url, hide_branding, updated_at)::text, '|' ORDER BY id)) AS v FROM public.profiles`,
  ),
});

describe("profile skins migration", () => {
  it("only adds, keeps every row, and its rollback puts the schema back", async () => {
    const d = await freshDb(MINE);
    await signUp(d, FREE, "alice");
    await d.query(`UPDATE public.profiles SET theme = 'royal', bio = 'hello' WHERE user_id = $1`, [
      FREE,
    ]);
    const before = await snapshot(d);
    const mine = migrationSql().find(MINE)!;
    await d.exec(mine);
    await d.exec(SUPABASE_GRANTS);
    const after = await snapshot(d);
    expect(after.prof).toBe(before.prof);
    const newCols = after.c.split(",").filter((x) => !before.c.split(",").includes(x));
    expect(newCols).toEqual(["profiles.skin:text"]);

    await d.exec(readFileSync(ROLLBACK, "utf8"));
    const rolled = await snapshot(d);
    expect(rolled).toEqual(before);
    // And it can be applied again after a rollback.
    await d.exec(mine);
    await d.close();
  }, 90_000);
});
