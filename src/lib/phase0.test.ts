import { describe, expect, it } from "vitest";
import { isAllowedLinkValue, normalizeLinkValue, safeLinkHref } from "./safe-url";
import { usernameError } from "./username";
import { sanitizeCustomTheme } from "./themes";

describe("link values", () => {
  it.each(["javascript:alert(1)", " javascript:alert(1)", "java\tscript:x", "data:text/html,x"])(
    "never renders %j as a link",
    (v) => {
      expect(safeLinkHref(v)).toBeUndefined();
      expect(isAllowedLinkValue(v)).toBe(false);
    },
  );

  it("renders allowed schemes, emails and bare domains as links", () => {
    expect(safeLinkHref("https://x.com/me")).toBe("https://x.com/me");
    expect(safeLinkHref("tel:+15555555555")).toBe("tel:+15555555555");
    expect(safeLinkHref("me@example.com")).toBe("mailto:me@example.com");
    expect(safeLinkHref("instagram.com/me")).toBe("https://instagram.com/me");
    expect(safeLinkHref("yourhandle#0001")).toBeUndefined();
  });

  it("normalizes what creators type", () => {
    expect(normalizeLinkValue("  instagram.com/me ")).toBe("https://instagram.com/me");
    expect(normalizeLinkValue("me@example.com")).toBe("me@example.com");
    expect(normalizeLinkValue("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkValue("")).toBe("");
    for (const v of ["https://a.co", "me@example.com", "yourhandle#0001", ""]) {
      expect(isAllowedLinkValue(normalizeLinkValue(v) as string)).toBe(true);
    }
  });
});

describe("usernames", () => {
  it("uses one rule: a-z, 0-9, _ and -", () => {
    expect(usernameError("john-doe")).toBeNull(); // used to fail in the profile editor
    expect(usernameError("john.doe")).not.toBeNull(); // the database never allowed dots
    expect(usernameError("a")).not.toBeNull();
  });

  it("blocks reserved names", () => {
    expect(usernameError("Support")).toMatch(/reserved/);
    expect(usernameError("owner")).toMatch(/reserved/);
  });
});

describe("custom theme", () => {
  it("drops anything that isn't a hex color or listed style", () => {
    expect(
      sanitizeCustomTheme({ background: "url(https://evil.test/x)", accent: "#a855f7", font: "comic", buttonStyle: "pill" }),
    ).toEqual({ accent: "#a855f7", buttonStyle: "pill" });
    expect(sanitizeCustomTheme("nope")).toEqual({});
  });
});
