import { describe, expect, it } from "vitest";
import { asCodeInfo, codeLink, codeStateMessage, normalizeCode, promotionOffer, usesLine } from "./codes";
import { asSiteSettings, DEFAULT_SITE_SETTINGS, socialLinks } from "../site/settings";

describe("invite codes", () => {
  it("accept what people paste", () => {
    expect(normalizeCode("  LAUNCH-Week ")).toBe("launch-week");
    expect(normalizeCode("https://yooits.me/auth?invite=abcd2345&x=1")).toBe("abcd2345");
    expect(normalizeCode("fc-abc123")).toBe("fc-abc123");
    expect(normalizeCode("ab")).toBeNull();
    expect(normalizeCode("-abcd")).toBeNull();
    expect(normalizeCode("<script>")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
  });

  it("build links and plain messages", () => {
    expect(codeLink("abcd2345", "https://yooits.me/")).toBe("https://yooits.me/auth?invite=abcd2345");
    expect(codeStateMessage({ kind: "promotion", state: "ok", plus_months: 2 })).toMatch(/2 months of Yooits.me Plus, free/);
    expect(codeStateMessage({ kind: "invite", state: "ok", plus_months: 0 })).toMatch(/applied when you create/);
    expect(codeStateMessage(asCodeInfo({ state: "weird" }))).toMatch(/isn't valid/);
    expect(usesLine({ use_count: 0, max_uses: 1 })).toBe("Unused");
    expect(usesLine({ use_count: 3, max_uses: 1000 })).toBe("3 of 1,000 used");
    expect(promotionOffer({ plus_months: 1 })).toBe("1 month of Plus free");
    expect(promotionOffer({ plus_months: 0 })).toMatch(/no reward/);
  });
});

describe("site settings", () => {
  it("fall back to today's site and keep only https social links", () => {
    expect(asSiteSettings(null)).toEqual(DEFAULT_SITE_SETTINGS);
    const s = asSiteSettings({
      site_name: "Yooits.me",
      theme_color: "red",
      socials: { tiktok: "https://tiktok.com/@yooits", instagram: "javascript:alert(1)", x: "https://x.com/yooits" },
    });
    expect(s.theme_color).toBeNull();
    expect(socialLinks(s).map((l) => l.id)).toEqual(["tiktok", "x"]);
  });
});
