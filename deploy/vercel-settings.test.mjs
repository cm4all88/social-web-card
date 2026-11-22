// node --test deploy/vercel-settings.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { stripeTestTippingOn, vercelSettings, vercelTarget } from "./vercel-settings.mjs";

const base = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pk", SUPABASE_SECRET_KEY: "sk", SITE: "https://yooits.me" };
const TEST = "sk_test_" + "a".repeat(20);
const LIVE = "sk_live_" + "a".repeat(20);

test("a Stripe test key alone does not switch tipping on or store the key", () => {
  const s = vercelSettings({ ...base, STRIPE_SECRET_KEY: TEST });
  assert.equal(s.TIPPING_ENABLED, "false");
  assert.equal("STRIPE_SECRET_KEY" in s, false);
  assert.equal(stripeTestTippingOn({ ...base, STRIPE_SECRET_KEY: TEST }), false);
});

test("TIPPING_ENABLED must be exactly true", () => {
  for (const v of ["1", "yes", "TRUE", " true", ""]) {
    assert.equal(vercelSettings({ ...base, STRIPE_SECRET_KEY: TEST, TIPPING_ENABLED: v }).TIPPING_ENABLED, "false");
  }
});

test("explicit TIPPING_ENABLED=true with a test key stores the key and turns test tipping on", () => {
  const s = vercelSettings({ ...base, STRIPE_SECRET_KEY: TEST, TIPPING_ENABLED: "true" });
  assert.equal(s.TIPPING_ENABLED, "true");
  assert.equal(s.STRIPE_SECRET_KEY, TEST);
});

test("a live key never switches tipping on from a deploy, even with every flag", () => {
  for (const extra of [{}, { TIPPING_ENABLED: "true" }, { TIPPING_ENABLED: "true", STRIPE_LIVE_MODE_APPROVED: "true", ALLOW_STRIPE_LIVE: "yes" }]) {
    const s = vercelSettings({ ...base, STRIPE_SECRET_KEY: LIVE, ...extra });
    assert.equal(s.TIPPING_ENABLED, "false");
    assert.equal("STRIPE_SECRET_KEY" in s, false);
    assert.equal("STRIPE_LIVE_MODE_APPROVED" in s, false);
  }
  assert.equal(vercelSettings({ ...base, STRIPE_SECRET_KEY: "rk_live_x", TIPPING_ENABLED: "true" }).TIPPING_ENABLED, "false");
});

test("no key: tipping off", () => {
  assert.equal(vercelSettings({ ...base, TIPPING_ENABLED: "true" }).TIPPING_ENABLED, "false");
});

test("target defaults to production and accepts only production or preview", () => {
  assert.equal(vercelTarget({}), "production");
  assert.equal(vercelTarget({ VERCEL_ENV_TARGET: "preview" }), "preview");
  assert.throws(() => vercelTarget({ VERCEL_ENV_TARGET: "development" }));
});

test("a deploy never switches Plus billing or paid checkout on, whatever the environment holds", () => {
  const e = {
    ...base,
    STRIPE_SECRET_KEY: LIVE,
    TIPPING_ENABLED: "true",
    PLUS_BILLING_ENABLED: "true",
    PLUS_CHECKOUT_ENABLED: "true",
    PLUS_LIVE_MODE_APPROVED: "true",
  };
  for (const env of [e, { ...e, STRIPE_SECRET_KEY: TEST }]) {
    const s = vercelSettings(env);
    for (const k of Object.keys(s)) assert.equal(k.startsWith("PLUS_"), false, k);
  }
});
