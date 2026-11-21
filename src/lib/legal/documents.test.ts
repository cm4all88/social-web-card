import { describe, expect, it } from "vitest";
import { getLegalDocument, LEGAL_DOCUMENTS, LEGAL_DRAFT_NOTICE } from "./documents";
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

  it("says plainly that each page is a draft not reviewed by an attorney", () => {
    expect(LEGAL_DRAFT_NOTICE).toMatch(/draft/i);
    expect(LEGAL_DRAFT_NOTICE).toMatch(/not been reviewed by an attorney/i);
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
});
