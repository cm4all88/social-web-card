import { describe, expect, it } from "vitest";
import { getLegalDocument, LEGAL_DETAILS, LEGAL_DOCUMENTS } from "./documents";
import { PLATFORM_FEE_CENTS, MIN_TIP_CENTS, MAX_TIP_CENTS } from "@/lib/tipping/money";
import { RESERVED_USERNAMES } from "@/lib/username";

const text = (slug: string) =>
  getLegalDocument(slug)!.sections.flatMap((s) => [s.heading, ...s.paragraphs]).join("\n");

describe("legal drafts", () => {
  it("has the four pages the bible asks for first", () => {
    expect(LEGAL_DOCUMENTS.map((d) => d.slug)).toEqual([
      "terms",
      "privacy",
      "acceptable-use",
      "creator-payment-terms",
    ]);
  });

  it("doesn't call any page a draft (owner's decision, Nov 22)", () => {
    for (const d of LEGAL_DOCUMENTS) {
      expect(`${d.title}\n${d.summary}\n${text(d.slug)}`).not.toMatch(/draft/i);
    }
  });

  it("states the decided tip terms, matching the code", () => {
    const t = text("creator-payment-terms");
    expect(t).toContain(`$${(PLATFORM_FEE_CENTS / 100).toFixed(2)}`);
    expect(t).toContain(`$${MIN_TIP_CENTS / 100} to $${MAX_TIP_CENTS / 100}`);
    expect(t).toMatch(/no percentage/i);
    expect(t).toMatch(/owner's approval/i);
  });

  it("says Yooits is not a money-transfer service", () => {
    expect(text("terms")).toContain("not a bank, a money transmitter or a peer-to-peer payment service");
  });

  it("keeps wishlists free", () => {
    expect(text("terms")).toContain("Wishlists are free");
  });

  it("lives under reserved usernames, so no profile can take its address", () => {
    for (const name of ["legal", "terms", "privacy"]) expect(RESERVED_USERNAMES.has(name)).toBe(true);
  });

  it("has no placeholders left and names the operator, contact and state", () => {
    for (const d of LEGAL_DOCUMENTS) expect(text(d.slug)).not.toMatch(/\[[a-z][a-z ]*\]/);
    expect(text("terms")).toContain("Yooits (yooits.me) is owned and operated by Tahoma Industries LLC");
    expect(text("privacy")).toContain("owned and operated by Tahoma Industries LLC");
    for (const d of LEGAL_DOCUMENTS) expect(text(d.slug)).not.toMatch(/Tahoma Systems/);
    expect(text("terms")).toContain("laws of the State of Washington, United States");
    expect(LEGAL_DETAILS.minimumAge).toBe("13");
  });

  it("gives a working email for reports", () => {
    expect(text("acceptable-use")).toContain("To report a page or a wishlist, use the Report link at the bottom of it, or email admin@tahomaindustries.com");
  });
});
