import { describe, expect, it } from "vitest";
import { legacyAdminTarget } from "./legacy-admin";
import { OWNER_GROUPS, OWNER_SECTIONS, sectionsIn } from "./nav";
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

  it("put every section in exactly one menu group", () => {
    const grouped = OWNER_GROUPS.flatMap((g) => sectionsIn(g).map((s) => s.id));
    expect(grouped.sort()).toEqual(OWNER_SECTIONS.map((s) => s.id).sort());
    expect(OWNER_GROUPS.every((g) => sectionsIn(g).length > 0)).toBe(true);
  });

  it("label audit actions in plain words", () => {
    expect(auditLabel("tipping.suspended")).toBe("Tips stopped");
    expect(auditLabel("something.new")).toBe("something.new");
  });
});
