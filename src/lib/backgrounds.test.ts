import { describe, expect, it } from "vitest";
import {
  backgroundPath,
  backgroundScrim,
  fitWithin,
  safeBackgroundUrl,
  ownBackgroundPath,
  popularHint,
} from "@/lib/backgrounds";
import { parseRewardClaim } from "@/lib/rewards";

const ME = "11111111-2222-4333-8444-555555555555";
const YOU = "99999999-2222-4333-8444-555555555555";
const pub = (path: string) =>
  `https://zlunoczkptknsxviddiw.supabase.co/storage/v1/object/public/avatars/${path}`;

describe("custom backgrounds", () => {
  it("shrink big photos to fit, never enlarge small ones", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1440, height: 1920 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(0, 600)).toEqual({ width: 0, height: 0 });
  });

  it("go in the creator's own folder, and only their own background files are ever removed", () => {
    expect(backgroundPath(ME, "webp", 42)).toBe(`${ME}/background-42.webp`);
    expect(ownBackgroundPath(pub(`${ME}/background-42.webp`), ME)).toBe(`${ME}/background-42.webp`);
    expect(ownBackgroundPath(pub(`${ME}/background-42.webp`), YOU)).toBeNull();
    expect(ownBackgroundPath(pub(`${ME}/avatar-42.webp`), ME)).toBeNull();
    expect(ownBackgroundPath(pub(`${ME}/../${YOU}/background-1.webp`), ME)).toBeNull();
    expect(ownBackgroundPath(null, ME)).toBeNull();
  });

  it("only ever draw a photo from the avatars bucket", () => {
    expect(safeBackgroundUrl(pub(`${ME}/background-1.webp`))).toBe(pub(`${ME}/background-1.webp`));
    expect(safeBackgroundUrl("https://example.com/x.jpg")).toBeNull();
    expect(safeBackgroundUrl(pub(`${ME}/x.webp") ; color:red`))).toBeNull();
    expect(safeBackgroundUrl(null)).toBeNull();
  });

  it("keep text readable: dark under light text, light under dark text", () => {
    expect(backgroundScrim("#ffffff")).toContain("rgba(0,0,0,");
    expect(backgroundScrim("#111111")).toContain("rgba(255,255,255,");
  });

  it("say what's left to unlock, with the number from the database", () => {
    expect(popularHint(312, 1000)).toBe(
      "Get 1,000 visitors to your page to unlock it (312 of 1,000 so far). Included with Plus.",
    );
    expect(popularHint(5000, 1000)).toContain("1,000 of 1,000");
  });

  it("read the unlock from the rewards answer", () => {
    const r = parseRewardClaim({
      enabled: true,
      unlocked: ["five_links", "popular"],
      new: ["popular"],
      profile_views: 1002,
      popular_at: 1000,
    });
    expect(r.unlocked).toEqual(["five_links"]);
    expect(r).toMatchObject({
      popular: true,
      newlyPopular: true,
      profileViews: 1002,
      popularAt: 1000,
    });
    expect(parseRewardClaim(null)).toMatchObject({
      popular: false,
      profileViews: 0,
      popularAt: null,
    });
  });
});
