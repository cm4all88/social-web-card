import { describe, expect, it } from "vitest";
import { DEMO_PROFILES, demoProfileSchema, studioGraphic } from "./studio";
import { launchPosts } from "./launch-plan";

describe("marketing studio profiles", () => {
  it("uses fictional destinations for all ten presets", () => {
    expect(DEMO_PROFILES).toHaveLength(10);
    expect(new Set(DEMO_PROFILES.map(({ profile }) => profile.theme)).size).toBe(10);
    expect(
      new Set(DEMO_PROFILES.map(({ profile }) => profile.links.length)).size,
    ).toBeGreaterThanOrEqual(6);
    for (const { profile } of DEMO_PROFILES) {
      expect(demoProfileSchema.safeParse(profile).success).toBe(true);
      expect(profile.links.every(({ url }) => new URL(url).hostname.endsWith(".example"))).toBe(
        true,
      );
    }
  });

  it("uses public profile presentations for newly generated profile ads", () => {
    const ads = launchPosts().filter((post) => post.graphic.studio);
    expect(ads.length).toBeGreaterThan(10);
    for (const post of ads) expect(studioGraphic(post.graphic.studio), post.title).toBeDefined();
    expect(ads.some((post) => post.graphic.studio?.video)).toBe(true);
    expect(
      ads.some(
        (post) => post.format === "carousel" && (post.graphic.studio?.profiles.length ?? 0) > 1,
      ),
    ).toBe(true);
  });

  it("rejects external and malformed destinations", () => {
    const { profile } = DEMO_PROFILES[0];
    for (const url of [
      "https://instagram.com/real",
      "https://x@yooits.example/",
      "invalid",
      "ftp://studio.example/",
    ]) {
      expect(
        demoProfileSchema.safeParse({ ...profile, links: [{ ...profile.links[0], url }] }).success,
      ).toBe(false);
    }
  });
});
