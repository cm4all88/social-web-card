import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRewardClaim, REWARD_KEYS, rewardHint, themeForReward } from "@/lib/rewards";
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
      rewardHint("profile_complete", { displayName: "Sam", bio: " ", avatarUrl: null, links: [] }),
    ).toBe("Add a display name, a bio and a photo to your profile (1 of 3 done).");
    const links = [
      { url: "https://a", enabled: true },
      { url: "", enabled: true },
      { url: "https://b", enabled: false },
    ];
    expect(rewardHint("five_links", { links })).toBe(
      "Add 5 links to your page and keep them Visible (1 of 5 so far).",
    );
    expect(rewardHint("first_share", { links })).toBe(
      "Tap Copy link at the top of your dashboard.",
    );
    expect(rewardHint("first_wishlist", { links })).toBe("Make a wishlist and add one item to it.");
    const now = new Date("2026-11-25T12:00:00Z");
    expect(rewardHint("one_week", { links, createdAt: "2026-11-22T10:00:00Z" }, now)).toBe(
      "Keep at least one Visible link on your page until it's a week old (day 3 of 7).",
    );
    expect(rewardHint("one_week", { links: [], createdAt: "2026-11-01T00:00:00Z" }, now)).toBe(
      "Add a Visible link and keep your page for a week (day 7 of 7).",
    );
    expect(parseRewardClaim(null)).toMatchObject({ unlocked: [], newlyUnlocked: [], enabled: false });
    expect(
      parseRewardClaim({ enabled: true, unlocked: ["five_links", "bogus"], new: ["five_links"] }),
    ).toMatchObject({
      unlocked: ["five_links"],
      newlyUnlocked: ["five_links"],
      enabled: true,
    });
    expect(themeForReward("one_week").key).toBe("golden_hour");
  });
});
