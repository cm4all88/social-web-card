import { describe, expect, it } from "vitest";
import {
  classifySource,
  cleanUtm,
  deviceFromUserAgent,
  isBot,
  optedOut,
  referrerHost,
} from "./source";
import { visitorHash } from "./record.server";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("classifySource", () => {
  it.each([
    ["https://l.instagram.com/?u=x", "instagram"],
    ["https://www.tiktok.com/", "tiktok"],
    ["https://lm.facebook.com/", "facebook"],
    ["https://t.co/abc", "x"],
    ["https://x.com/someone", "x"],
    ["https://www.youtube.com/", "youtube"],
    ["https://www.google.co.uk/", "google"],
    ["https://mail.google.com/mail/u/0", "email"],
    ["https://duckduckgo.com/", "duckduckgo"],
    ["https://yooits.me/", "yooits"],
    ["https://someblog.example/post", "other"],
    ["android-app://com.instagram.android", "instagram"],
    ["android-app://com.zhiliaoapp.musically", "tiktok"],
  ])("referrer %s is %s", (referrer, source) => {
    expect(classifySource({ referrer, userAgent: CHROME })).toBe(source);
  });

  it("reads in-app browsers when there's no referrer", () => {
    expect(classifySource({ userAgent: `${IPHONE} Instagram 300.0.0` })).toBe("instagram");
    expect(classifySource({ userAgent: `${IPHONE} [FBAN/FBIOS;FBAV/400]` })).toBe("facebook");
    expect(classifySource({ userAgent: `${IPHONE} musical_ly_33.0` })).toBe("tiktok");
    expect(classifySource({ userAgent: IPHONE })).toBe("direct");
  });

  it("lets a known utm_source win and ignores unknown ones", () => {
    expect(classifySource({ referrer: "https://t.co/x", utmSource: "IG" })).toBe("instagram");
    expect(classifySource({ referrer: "https://t.co/x", utmSource: "spring-sale" })).toBe("x");
  });
});

describe("helpers", () => {
  it("referrerHost", () => {
    expect(referrerHost("https://www.Example.com/a?b")).toBe("example.com");
    expect(referrerHost("javascript:alert(1)")).toBeNull();
    expect(referrerHost("not a url")).toBeNull();
    expect(referrerHost(null)).toBeNull();
  });

  it("device", () => {
    expect(deviceFromUserAgent(IPHONE)).toBe("mobile");
    expect(deviceFromUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe(
      "mobile",
    );
    expect(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X710) Safari")).toBe("tablet");
    expect(deviceFromUserAgent(CHROME)).toBe("desktop");
  });

  it("bots", () => {
    for (const ua of [
      "facebookexternalhit/1.1",
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "Twitterbot/1.0",
      "Slackbot-LinkExpanding 1.0",
      "WhatsApp/2.23.20 A",
      "curl/8.0",
      "Mozilla/5.0 HeadlessChrome/120",
      "",
      null,
    ]) {
      expect(isBot(ua)).toBe(true);
    }
    expect(isBot(IPHONE)).toBe(false);
    expect(isBot(CHROME)).toBe(false);
    expect(isBot(`${IPHONE} Instagram 300.0`)).toBe(false);
  });

  it("opt-out headers", () => {
    expect(optedOut({ dnt: "1" })).toBe(true);
    expect(optedOut({ gpc: "1" })).toBe(true);
    expect(optedOut({ dnt: "0", gpc: null })).toBe(false);
  });

  it("cleanUtm", () => {
    expect(cleanUtm("  launch\n ")).toBe("launch");
    expect(cleanUtm("x".repeat(300))).toHaveLength(100);
    expect(cleanUtm("")).toBeNull();
  });

  it("visitor hash changes daily and never contains the IP", async () => {
    const a = await visitorHash("203.0.113.9", IPHONE, "s", new Date("2026-11-22T10:00:00Z"));
    const b = await visitorHash("203.0.113.9", IPHONE, "s", new Date("2026-11-22T23:00:00Z"));
    const c = await visitorHash("203.0.113.9", IPHONE, "s", new Date("2026-11-23T01:00:00Z"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("203");
  });
});
