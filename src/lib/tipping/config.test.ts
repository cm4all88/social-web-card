import { afterEach, describe, expect, it } from "vitest";
import { getTippingConfig, isTippingAvailable } from "./config.server";

const KEYS = ["TIPPING_ENABLED", "STRIPE_SECRET_KEY", "STRIPE_LIVE_MODE_APPROVED", "VERCEL_ENV", "STRIPE_TEST_MODE_ON_PRODUCTION"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const set = (v: Record<string, string>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, v);
};
afterEach(() => set(Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)) as Record<string, string>));

const TEST = "sk_test_" + "x".repeat(20);
const LIVE = "sk_live_" + "x".repeat(20);

describe("tipping switches on only deliberately", () => {
  it("a Stripe key alone leaves tipping off", () => {
    set({ STRIPE_SECRET_KEY: TEST });
    expect(isTippingAvailable()).toBe(false);
    set({ STRIPE_SECRET_KEY: LIVE });
    expect(isTippingAvailable()).toBe(false);
  });

  it("TIPPING_ENABLED must be exactly true", () => {
    for (const v of ["1", "yes", "TRUE", "on"]) {
      set({ STRIPE_SECRET_KEY: TEST, TIPPING_ENABLED: v });
      expect(isTippingAvailable()).toBe(false);
    }
  });

  it("explicit flag + test key works off production", () => {
    set({ STRIPE_SECRET_KEY: TEST, TIPPING_ENABLED: "true", VERCEL_ENV: "preview" });
    expect(isTippingAvailable()).toBe(true);
    expect(getTippingConfig().liveModeAllowed).toBe(false);
  });

  it("a live key stays off without the separate live approval flag", () => {
    set({ STRIPE_SECRET_KEY: LIVE, TIPPING_ENABLED: "true", VERCEL_ENV: "production" });
    expect(isTippingAvailable()).toBe(false);
    expect(() => getTippingConfig()).toThrow(/Live payments are not approved/);
    set({ STRIPE_SECRET_KEY: LIVE, TIPPING_ENABLED: "true", STRIPE_LIVE_MODE_APPROVED: "yes" });
    expect(isTippingAvailable()).toBe(false);
  });

  it("live key + both explicit flags is the only way to live tipping", () => {
    set({ STRIPE_SECRET_KEY: LIVE, TIPPING_ENABLED: "true", STRIPE_LIVE_MODE_APPROVED: "true", VERCEL_ENV: "production" });
    expect(isTippingAvailable()).toBe(true);
  });

  it("a test key on the production deployment (yooits.me) stays off unless explicitly allowed", () => {
    set({ STRIPE_SECRET_KEY: TEST, TIPPING_ENABLED: "true", VERCEL_ENV: "production" });
    expect(isTippingAvailable()).toBe(false);
    set({ STRIPE_SECRET_KEY: TEST, TIPPING_ENABLED: "true", VERCEL_ENV: "production", STRIPE_TEST_MODE_ON_PRODUCTION: "true" });
    expect(isTippingAvailable()).toBe(true);
  });
});
