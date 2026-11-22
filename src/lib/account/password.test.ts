import { describe, expect, it } from "vitest";
import { newPasswordError } from "./password";

describe("newPasswordError", () => {
  it("needs at least 8 characters", () => {
    expect(newPasswordError("short", "oldpassword")).toMatch(/at least 8/);
  });
  it("must differ from the current password", () => {
    expect(newPasswordError("samepassword", "samepassword")).toMatch(/different/);
  });
  it("accepts a new long password", () => {
    expect(newPasswordError("a-brand-new-one", "oldpassword")).toBeNull();
  });
});
