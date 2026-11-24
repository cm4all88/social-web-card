import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  APP_ONLY_TARGETS,
  INTENT_TARGETS,
  SHARE_CHANNELS,
  displayUrl,
  intentUrl,
  isShareChannel,
  profileUrl,
  suggestedCaptions,
  trackedProfileUrl,
} from "./links";
import { ProfileShareGraphic, mockLinks } from "./graphic";
import { classifySource } from "@/lib/analytics/source";
import { getTheme } from "@/lib/themes";

const O = "https://yooits.me";

describe("share links", () => {
  it("keeps the copied link clean and marks share links", () => {
    expect(profileUrl(O, "maya")).toBe("https://yooits.me/maya");
    expect(profileUrl(`${O}/`, "maya")).toBe("https://yooits.me/maya");
    expect(trackedProfileUrl(O, "maya", "facebook")).toBe(
      "https://yooits.me/maya?utm_source=facebook&utm_medium=share",
    );
    expect(displayUrl(O, "maya")).toBe("yooits.me/maya");
  });

  it("builds each app's real share address with the tracked link", () => {
    for (const t of INTENT_TARGETS) {
      const u = intentUrl(t.channel, O, "maya", "Find all my links in one place");
      expect(u).toContain(encodeURIComponent("https://yooits.me/maya?utm_source="));
      expect(u).toContain(encodeURIComponent(`utm_source=${t.channel}`));
    }
    expect(intentUrl("facebook", O, "maya", "x")).toMatch(
      /^https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=/,
    );
    expect(intentUrl("x", O, "maya", "hi")).toMatch(
      /^https:\/\/x\.com\/intent\/tweet\?text=hi&url=/,
    );
    expect(intentUrl("whatsapp", O, "maya", "hi")).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(intentUrl("email", O, "maya", "hi")).toMatch(/^mailto:\?subject=/);
  });

  it("offers no fake web share for Instagram, TikTok or Snapchat", () => {
    const intentChannels = INTENT_TARGETS.map((t) => t.channel as string);
    for (const t of APP_ONLY_TARGETS) expect(intentChannels).not.toContain(t.channel);
  });

  it("only knows the channels the database accepts", () => {
    for (const c of SHARE_CHANNELS) expect(c).toMatch(/^[a-z0-9_]{1,24}$/);
    expect(isShareChannel("instagram")).toBe(true);
    expect(isShareChannel("<script>")).toBe(false);
  });

  it("puts the page's own address in every caption", () => {
    const caps = suggestedCaptions({ origin: O, username: "maya", hasWishlist: true });
    expect(caps.length).toBeGreaterThanOrEqual(4);
    for (const c of caps) expect(c).toContain("yooits.me/maya");
    expect(suggestedCaptions({ origin: O, username: "maya" }).length).toBe(caps.length - 1);
  });

  it("credits share-link visits to the app they were shared to", () => {
    expect(classifySource({ utmSource: "facebook" })).toBe("facebook");
    expect(classifySource({ utmSource: "whatsapp" })).toBe("whatsapp");
  });
});

describe("share graphic", () => {
  const theme = getTheme("default", null, { plus: false, unlocked: false });
  const links = mockLinks([
    { platform: "instagram", url: "https://instagram.com/maya" },
    { platform: "website", url: "https://maya.shop", title: "My shop", featured: true },
  ]);

  it("draws the real page: name, handle, links and address", () => {
    for (const format of ["story", "post"] as const) {
      const svg = renderToStaticMarkup(
        createElement(ProfileShareGraphic, {
          format,
          theme,
          links,
          address: "yooits.me/maya",
          profile: {
            username: "maya",
            name: "Maya Lin",
            bio: "Ceramics",
            avatar: null,
            showBranding: true,
          },
        }),
      );
      expect(svg).toContain("@maya");
      expect(svg).toContain("Maya");
      expect(svg).toContain("My shop");
      expect(svg).toContain("yooits.me/maya");
      expect(svg).toContain(
        format === "story" ? 'viewBox="0 0 1080 1920"' : 'viewBox="0 0 1080 1350"',
      );
    }
  });

  it("leaves the Yooits.me footer off when branding is hidden", () => {
    const svg = renderToStaticMarkup(
      createElement(ProfileShareGraphic, {
        format: "story",
        theme,
        links,
        address: "yooits.me/maya",
        profile: { username: "maya", name: "Maya", bio: null, avatar: null, showBranding: false },
      }),
    );
    expect(svg).not.toContain("Create your free profile on Yooits.me");
  });
});
