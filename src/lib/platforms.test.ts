import { describe, expect, it } from "vitest";
import {
  getPlatform,
  PICKABLE_PLATFORM_KEYS,
  PLATFORM_CATEGORIES,
  PLATFORMS,
  RETIRED_PLATFORM_KEYS,
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
