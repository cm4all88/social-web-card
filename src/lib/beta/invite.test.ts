import { describe, expect, it } from "vitest";
import {
  betaInviteLink,
  betaPlanLine,
  betaStateMessage,
  isBetaCodeState,
  normalizeBetaCode,
} from "./invite";

describe("normalizeBetaCode", () => {
  it("accepts codes as people paste them", () => {
    expect(normalizeBetaCode("fc-abcd234xyz")).toBe("fc-abcd234xyz");
    expect(normalizeBetaCode("  FC-ABCD234XYZ ")).toBe("fc-abcd234xyz");
    expect(normalizeBetaCode("https://yooits.me/auth?invite=fc-abcd234xyz")).toBe("fc-abcd234xyz");
  });
  it("rejects anything else", () => {
    for (const bad of [
      null,
      "",
      "abcd234xyz",
      "fc-short",
      "fc-abcd234xyz!",
      "<script>",
      "fc-abcd234xyzz",
    ]) {
      expect(normalizeBetaCode(bad)).toBeNull();
    }
  });
});

describe("betaInviteLink", () => {
  it("points at sign-up with the code", () => {
    expect(betaInviteLink("fc-abcd234xyz", "https://yooits.me/")).toBe(
      "https://yooits.me/auth?invite=fc-abcd234xyz",
    );
  });
});

describe("messages", () => {
  it("every state has a message, and the offer says no card and no charge", () => {
    for (const s of [
      "ok",
      "used",
      "expired",
      "revoked",
      "full",
      "closed",
      "invalid",
      "already",
    ] as const) {
      expect(isBetaCodeState(s)).toBe(true);
      expect(betaStateMessage(s).length).toBeGreaterThan(10);
    }
    expect(betaStateMessage("ok")).toMatch(/No card/);
    expect(betaStateMessage("ok")).toMatch(/nothing renews or charges/);
    expect(isBetaCodeState("nope")).toBe(false);
  });
  it("plan line covers active, ended and revoked", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(betaPlanLine("2027-03-01T12:00:00Z", null, now)).toMatch(/free until March 1, 2027/);
    expect(betaPlanLine("2026-11-01T12:00:00Z", null, now)).toMatch(
      /ended on November 1, 2026.*nothing was charged/,
    );
    expect(betaPlanLine("2027-03-01T12:00:00Z", "2026-11-20T00:00:00Z", now)).toMatch(/free plan/);
  });
});
