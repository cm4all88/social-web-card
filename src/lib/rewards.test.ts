import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRewardClaim, REWARD_KEYS, rewardProgress, themeForReward } from "@/lib/rewards";
import {
  findThemePreset,
  getTheme,
  PREMIUM_THEME_PRESETS,
  REWARD_THEME_PRESETS,
  SEASONAL_THEME_PRESETS,
  seasonalThemesInSeason,
  THEME_PRESETS,
} from "@/lib/themes";

const sql = readFileSync(
  new URL("../../supabase/migrations/20261122125000_seasonal_themes_rewards.sql", import.meta.url),
  "utf8",
);

describe("rewards and earned themes", () => {
  it("every reward has one earned theme, matching the database", () => {
    expect(REWARD_THEME_PRESETS.map((t) => t.reward).sort()).toEqual([...REWARD_KEYS].sort());
    for (const t of REWARD_THEME_PRESETS)
      expect(sql).toContain(`WHEN '${t.key}' THEN '${t.reward}'`);
    for (const k of REWARD_KEYS) expect(sql).toContain(`'${k}'`);
  });

  it("seasonal windows match the database", () => {
    for (const t of SEASONAL_THEME_PRESETS)
      expect(sql).toContain(`WHEN '${t.key}' THEN '${t.season!.from}..${t.season!.to}'`);
  });

  it("theme keys are unique across every kind", () => {
    const all = [
      ...THEME_PRESETS,
      ...PREMIUM_THEME_PRESETS,
      ...SEASONAL_THEME_PRESETS,
      ...REWARD_THEME_PRESETS,
    ].map((t) => t.key);
    expect(new Set(all).size).toBe(all.length);
  });

  it("earned themes show only when earned or on Plus; free seasonal themes always show", () => {
    const def = THEME_PRESETS[0].tokens;
    expect(getTheme("starlight", null)).toEqual(def);
    expect(getTheme("starlight", null, { unlocked: true })).toEqual(
      findThemePreset("starlight")!.tokens,
    );
    expect(getTheme("starlight", null, { plus: true })).toEqual(
      findThemePreset("starlight")!.tokens,
    );
    expect(getTheme("snowfall", null)).toEqual(findThemePreset("snowfall")!.tokens);
    expect(getTheme("holiday_lights", null)).toEqual(def);
    expect(getTheme("holiday_lights", null, { plus: true })).toEqual(
      findThemePreset("holiday_lights")!.tokens,
    );
    // An earned unlock never opens a Plus theme.
    expect(getTheme("aurora", null, { unlocked: true })).toEqual(def);
  });

  it("winter themes are in season at launch", () => {
    const keys = seasonalThemesInSeason(new Date("2026-11-25T12:00:00Z")).map((t) => t.key);
    expect(keys).toEqual(["snowfall", "holiday_lights"]);
  });

  it("shows progress and reads the database answer safely", () => {
    expect(
      rewardProgress("profile_complete", {
        displayName: "Sam",
        bio: " ",
        avatarUrl: null,
        links: [],
      }),
    ).toBe("1 of 3");
    expect(
      rewardProgress("five_links", {
        links: [
          { url: "https://a", enabled: true },
          { url: "", enabled: true },
          { url: "https://b", enabled: false },
        ],
      }),
    ).toBe("1 of 5");
    expect(parseRewardClaim(null)).toEqual({ unlocked: [], newlyUnlocked: [], enabled: false });
    expect(
      parseRewardClaim({ enabled: true, unlocked: ["five_links", "bogus"], new: ["five_links"] }),
    ).toEqual({
      unlocked: ["five_links"],
      newlyUnlocked: ["five_links"],
      enabled: true,
    });
    expect(themeForReward("one_week").key).toBe("golden_hour");
  });
});
