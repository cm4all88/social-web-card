import { describe, expect, it } from "vitest";
import {
  getPlatform,
  PICKABLE_PLATFORM_KEYS,
  PLATFORM_CATEGORIES,
  PLATFORMS,
  RETIRED_PLATFORM_KEYS,
  GENERIC_ICONS,
  ICON_CHOICES,
  linkDisplay,
  cleanLinkTitle,
} from "./platforms";

describe("link presets (product decision, 21 Nov 2026)", () => {
  it("has no Payments category", () => {
    const labels = PLATFORM_CATEGORIES.map((c) => c.label.toLowerCase());
    expect(labels.some((l) => l.includes("pay") || l.includes("money"))).toBe(false);
  });

  it("offers no payment-app or OnlyFans preset", () => {
    for (const key of RETIRED_PLATFORM_KEYS) {
      expect(PICKABLE_PLATFORM_KEYS).not.toContain(key);
    }
  });

  it("still offers Amazon, creator platforms and a plain website link", () => {
    for (const key of ["amazon", "patreon", "buymeacoffee", "website"]) {
      expect(PICKABLE_PLATFORM_KEYS).toContain(key);
    }
    expect(PLATFORMS.amazon.hint).toContain("amazon.com");
  });

  it("only offers presets that exist", () => {
    for (const key of PICKABLE_PLATFORM_KEYS) expect(PLATFORMS[key]).toBeDefined();
    expect(new Set(PICKABLE_PLATFORM_KEYS).size).toBe(PICKABLE_PLATFORM_KEYS.length);
  });

  it("still shows a link saved under a retired key", () => {
    expect(getPlatform("venmo").label).toBe("Venmo");
    expect(getPlatform("onlyfans").label).toBe("OnlyFans");
  });
});

describe("link titles and icons", () => {
  it("shows the platform's name and icon when nothing is chosen", () => {
    const d = linkDisplay({ platform: "instagram" });
    expect(d.label).toBe("Instagram");
    expect(d.icon).toBe(PLATFORMS.instagram.icon);
  });

  it("uses the creator's own title and icon", () => {
    const d = linkDisplay({ platform: "website", title: "  My shop ", icon: "shop" });
    expect(d.label).toBe("My shop");
    expect(d.icon).toBe(GENERIC_ICONS.shop.icon);
    expect(linkDisplay({ platform: "website", icon: "youtube" }).icon).toBe(PLATFORMS.youtube.icon);
  });

  it("falls back to the platform's icon for an unknown icon key", () => {
    expect(linkDisplay({ platform: "github", icon: "nope" }).icon).toBe(PLATFORMS.github.icon);
  });

  it("cleans titles the way the database expects", () => {
    expect(cleanLinkTitle("   ")).toBeNull();
    expect(cleanLinkTitle("a\nb\u0007c")).toBe("a b c");
    expect(cleanLinkTitle("x".repeat(100))).toHaveLength(80);
  });

  it("never offers a retired payment preset as an icon", () => {
    const keys = ICON_CHOICES.map((c) => c.key);
    for (const k of RETIRED_PLATFORM_KEYS) expect(keys).not.toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
