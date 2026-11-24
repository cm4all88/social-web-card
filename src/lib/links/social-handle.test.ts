import { describe, expect, it } from "vitest";
import { socialHandle } from "./social-handle";

describe("social handle display", () => {
  it.each([
    ["https://www.instagram.com/julie.hope/?igsh=example", "@julie.hope"],
    ["https://www.tiktok.com/@juliehope", "@juliehope"],
    ["https://youtube.com/@julie-hope", "@julie-hope"],
    ["https://snapchat.com/add/julie.hope", "@julie.hope"],
    ["https://www.instagram.com/p/abc/", null],
    ["https://instagram.com.evil.example/yooits", null],
    ["https://instagram.com@evil.example/yooits", null],
    ["https://[bad", null],
    ["mailto:demo@example.test", null],
  ])("displays a handle for %s only when the URL is a profile", (href, expected) => {
    expect(socialHandle(href)).toBe(expected);
  });
});
