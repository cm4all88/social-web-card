import { describe, expect, it } from "vitest";
import { normalizeProfileAddress } from "./profile-address";

describe("profile addresses", () => {
  it.each([
    ["instagram", " @jules.hope ", "https://www.instagram.com/jules.hope"],
    ["instagram", "juleshope96", "https://www.instagram.com/juleshope96"],
    ["tiktok", "juleshope96", "https://www.tiktok.com/@juleshope96"],
    ["youtube", "@julie-hope", "https://www.youtube.com/@julie-hope"],
    ["snapchat", "juleshope96", "https://www.snapchat.com/add/juleshope96"],
    ["twitter", "https://x.com/example/status/123", "https://x.com/example/status/123"],
    ["instagram", "instagram.com/juleshope96", "https://instagram.com/juleshope96"],
    ["website", "example.com", "https://example.com"],
    ["discord", "julie#0010", "julie#0010"],
    ["spotify", "https://open.spotify.com/track/abc", "https://open.spotify.com/track/abc"],
    ["instagram", "@bad name", null],
    ["instagram", "https://", null],
    ["instagram", "https://instagram.com@elsewhere.example", null],
    ["instagram", "javascript:alert(1)", null],
  ])("%s accepts %s as %s", (platform, input, expected) => {
    expect(normalizeProfileAddress(platform, input)).toBe(expected);
  });
});
