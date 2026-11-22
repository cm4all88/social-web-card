import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findThemePreset } from "@/lib/themes";
import {
  findSkin,
  parseSkinState,
  resolveSkin,
  SKINS,
  skinBlock,
  THEME_DEFAULT_SKIN,
} from "@/lib/skins";
import {
  EFFECTS,
  makeParticles,
  particleCount,
  stepParticles,
  windAt,
  type Rand,
} from "@/lib/skin-effects";

const SQL = readFileSync(
  new URL("../../supabase/migrations/20261122183000_profile_skins.sql", import.meta.url),
  "utf8",
);

/** A seeded random, so the motion tests are repeatable. */
function seeded(seed = 7): Rand {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("skins", () => {
  it("each share a real theme's rules, as the database maps them", () => {
    for (const s of SKINS) {
      expect(findThemePreset(s.theme), s.key).toBeTruthy();
      expect(SQL).toContain(`WHEN '${s.key}' THEN '${s.theme}'`);
    }
    for (const [theme, skin] of Object.entries(THEME_DEFAULT_SKIN)) {
      expect(findThemePreset(theme), theme).toBeTruthy();
      expect(findSkin(skin), skin).toBeTruthy();
    }
  });

  it("are pickable by the same rules as their theme", () => {
    const nov = new Date("2026-11-25T12:00:00Z");
    const oct = new Date("2026-10-10T12:00:00Z");
    expect(skinBlock("snow", { at: nov })).toBeNull();
    expect(skinBlock("snow", { at: oct })).toBe("season");
    expect(skinBlock("leaves", { at: oct })).toBeNull();
    expect(skinBlock("leaves", { at: nov })).toBe("season");
    expect(skinBlock("hearts", { at: new Date("2027-02-10T12:00:00Z") })).toBeNull();
    expect(skinBlock("stars", { at: nov })).toBe("earn");
    expect(skinBlock("stars", { at: nov, unlocked: true })).toBeNull();
    expect(skinBlock("stars", { at: nov, plus: true })).toBeNull();
  });

  it("show on the page as picked, or as the shown theme's own effect", () => {
    const base = { enabled: true, plus: false, themeUnlocked: false, skinUnlocked: false };
    // Snowfall brings snow; holiday lights too, but only with Plus.
    expect(resolveSkin({ ...base, skin: null, theme: "snowfall" })?.key).toBe("snow");
    expect(resolveSkin({ ...base, skin: null, theme: "holiday_lights" })).toBeNull();
    expect(resolveSkin({ ...base, plus: true, skin: null, theme: "holiday_lights" })?.key).toBe(
      "snow",
    );
    // A theme with no effect, and turning effects off.
    expect(resolveSkin({ ...base, skin: null, theme: "ocean" })).toBeNull();
    expect(resolveSkin({ ...base, skin: "none", theme: "snowfall" })).toBeNull();
    // Any skin with any theme.
    expect(resolveSkin({ ...base, skin: "leaves", theme: "ocean" })?.key).toBe("leaves");
    // An earned skin needs its reward (or Plus) to keep showing.
    expect(resolveSkin({ ...base, skin: "stars", theme: "ocean" })).toBeNull();
    expect(resolveSkin({ ...base, skinUnlocked: true, skin: "stars", theme: "ocean" })?.key).toBe(
      "stars",
    );
    // Off until the flag is on.
    expect(resolveSkin({ ...base, enabled: false, skin: "snow", theme: "snowfall" })).toBeNull();
  });

  it("read the database's answer safely", () => {
    expect(parseSkinState(null)).toEqual({ enabled: false, unlocked: false });
    expect(parseSkinState({ on: true, unlocked: true })).toEqual({ enabled: true, unlocked: true });
    expect(parseSkinState({ on: "yes" })).toEqual({ enabled: false, unlocked: false });
  });
});

describe("effects", () => {
  it("scale with the screen and stay light on phones", () => {
    const phone = particleCount("snow", 390, 844);
    const desktop = particleCount("snow", 1440, 900);
    expect(phone).toBeGreaterThanOrEqual(60);
    expect(phone).toBeLessThanOrEqual(90);
    expect(desktop).toBe(EFFECTS.snow.max);
    expect(particleCount("snow", 390, 844, 0.7)).toBeLessThan(phone);
    for (const k of ["snow", "leaves", "hearts", "stars"] as const)
      expect(particleCount(k, 390, 844), k).toBeLessThanOrEqual(100);
  });

  it("share a wind that rises and falls in gusts", () => {
    const samples = Array.from({ length: 600 }, (_, i) => windAt(i * 0.5));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1.4);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
  });

  it("give snow depth: far flakes small and slow, near ones big and quick", () => {
    const ps = makeParticles("snow", 400, 390, 844, seeded());
    const far = ps.filter((p) => p.depth < 0.35);
    const near = ps.filter((p) => p.depth > 0.8);
    expect(far.length).toBeGreaterThan(near.length);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(near.map((p) => p.size))).toBeGreaterThan(avg(far.map((p) => p.size)) * 2);
    expect(avg(near.map((p) => p.speed))).toBeGreaterThan(avg(far.map((p) => p.speed)) * 1.8);
    // Some near flakes are drawn as crystals.
    expect(near.some((p) => p.sprite === 1)).toBe(true);
  });

  it("move naturally: snow and leaves fall and drift, hearts rise, and all keep falling forever", () => {
    for (const kind of ["snow", "leaves", "hearts", "stars"] as const) {
      const rand = seeded(3);
      const ps = makeParticles(kind, 50, 390, 844, rand);
      const start = ps.map((p) => ({ x: p.x, y: p.y }));
      for (let i = 0; i < 60; i++) stepParticles(kind, ps, 1 / 60, i / 60, 390, 844, rand);
      // Median, so the few that wrapped round to the start don't count.
      const dys = ps.map((p, i) => p.y - start[i].y).sort((a, b) => a - b);
      const dy = dys[Math.floor(dys.length / 2)];
      const dx = ps.reduce((a, p, i) => a + Math.abs(p.x - start[i].x), 0) / ps.length;
      if (kind === "hearts") expect(dy, kind).toBeLessThan(0);
      else if (kind === "stars") expect(Math.abs(dy), kind).toBeLessThan(0.001);
      else expect(dy, kind).toBeGreaterThan(5);
      if (kind !== "stars") expect(dx, kind).toBeGreaterThan(0.5);
      // Ten simulated minutes: particles recycle and stay near the screen.
      for (let i = 0; i < 6000; i++) stepParticles(kind, ps, 0.1, i * 0.1, 390, 844, rand);
      for (const p of ps) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y), kind).toBe(true);
        expect(p.y, kind).toBeGreaterThan(-200);
        expect(p.y, kind).toBeLessThan(844 + 200);
      }
    }
  });

  it("never jump after a stalled frame", () => {
    const rand = seeded(5);
    const ps = makeParticles("snow", 20, 390, 844, rand);
    const before = ps.map((p) => p.y);
    stepParticles("snow", ps, 5, 1, 390, 844, rand);
    ps.forEach((p, i) => {
      if (p.y > before[i]) expect(p.y - before[i]).toBeLessThan(6);
    });
  });
});
