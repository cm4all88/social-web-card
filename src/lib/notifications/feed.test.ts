import { describe, expect, it } from "vitest";
import { announcementHref } from "./feed";

describe("announcement links", () => {
  it("allow Yooits paths and https addresses only", () => {
    expect(announcementHref("/dashboard/wishlists")).toBe("/dashboard/wishlists");
    expect(announcementHref("/")).toBe("/");
    expect(announcementHref("https://yooits.me/help")).toBe("https://yooits.me/help");
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "http://x.example",
      "https://a@evil.example",
      "/a b",
      null,
      "",
    ]) {
      expect(announcementHref(bad), String(bad)).toBeUndefined();
    }
  });
});
