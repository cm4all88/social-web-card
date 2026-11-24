import { describe, expect, it } from "vitest";
import { isSafeNextPath } from "./safe-path";

describe("isSafeNextPath", () => {
  it("accepts Yooits.me page paths", () => {
    expect(isSafeNextPath("/mom/wishlist/mias-christmas")).toBe(true);
    expect(isSafeNextPath("/dashboard")).toBe(true);
  });
  it("refuses other sites and odd schemes", () => {
    for (const bad of [
      "//evil.com",
      "https://evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "/a?x=1",
      "",
      "/a b",
      "/%2F%2Fevil",
    ]) {
      expect(isSafeNextPath(bad)).toBe(false);
    }
  });
});
