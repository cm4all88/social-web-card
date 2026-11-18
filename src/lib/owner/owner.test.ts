import { describe, expect, it } from "vitest";
import { legacyAdminTarget } from "./legacy-admin";
import { OWNER_SECTIONS, plannedSection } from "./nav";
import { auditLabel } from "./api";

describe("old /admin links", () => {
  it("send each old page to its new home", () => {
    expect(legacyAdminTarget(undefined)).toBe("/dashboard");
    expect(legacyAdminTarget("")).toBe("/dashboard");
    expect(legacyAdminTarget("wishlists")).toBe("/dashboard/wishlists");
    expect(legacyAdminTarget("wishlists/")).toBe("/dashboard/wishlists");
    expect(legacyAdminTarget("Revenue")).toBe("/owner/revenue");
    expect(legacyAdminTarget("anything/else")).toBe("/dashboard");
    expect(legacyAdminTarget("//evil.example")).toBe("/dashboard");
  });
});

describe("owner console sections", () => {
  it("list every area the console is meant to run", () => {
    expect(OWNER_SECTIONS.map((s) => s.id)).toEqual(
      expect.arrayContaining(["users", "money", "wishlists", "promotions", "settings", "analytics", "audit"]),
    );
    expect(new Set(OWNER_SECTIONS.map((s) => s.to)).size).toBe(OWNER_SECTIONS.length);
  });

  it("show placeholders only for planned sections", () => {
    expect(plannedSection("promotions")?.label).toBe("Promotions");
    expect(plannedSection("users")).toBeUndefined();
    expect(plannedSection("nope")).toBeUndefined();
  });

  it("label audit actions in plain words", () => {
    expect(auditLabel("tipping.suspended")).toBe("Tips stopped");
    expect(auditLabel("something.new")).toBe("something.new");
  });
});
