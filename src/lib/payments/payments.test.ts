import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "./secret-box";
import {
  CONNECT_WEBHOOK_EVENTS,
  keyMode,
  missingEvents,
  portalConfigurationParams,
  WEBHOOK_PLANS,
  webhookBase,
} from "./stripe-setup";
import { featureReadiness, type FeatureInputs } from "./readiness";
import { HANDLED_EVENT_TYPES } from "@/lib/tipping/webhook-handler";
import { SUBSCRIPTION_EVENTS } from "@/lib/billing/sync";

describe("stripe setup plan", () => {
  it("points webhooks only at Yooits.me's own https sites", () => {
    expect(webhookBase("https://yooits.me")).toBe("https://yooits.me");
    expect(webhookBase("https://test.yooits.me/dashboard")).toBe("https://test.yooits.me");
    expect(webhookBase("http://yooits.me")).toBeNull();
    expect(webhookBase("https://yooits-preview-git-test-stripe-lit-sense.vercel.app")).toBeNull();
    expect(webhookBase("https://yooits.me.evil.test")).toBeNull();
    expect(webhookBase(null)).toBeNull();
  });

  it("asks Stripe for every event the handlers act on", () => {
    const platform = WEBHOOK_PLANS.filter((p) => !p.connect).flatMap((p) => p.events);
    const connect = WEBHOOK_PLANS.filter((p) => p.connect).flatMap((p) => p.events);
    for (const e of SUBSCRIPTION_EVENTS) expect(platform).toContain(e);
    for (const e of HANDLED_EVENT_TYPES) expect([...platform, ...connect]).toContain(e);
    expect(CONNECT_WEBHOOK_EVENTS).toContain("customer.subscription.deleted");
    expect(CONNECT_WEBHOOK_EVENTS).toContain("charge.refunded");
  });

  it("finds missing events", () => {
    expect(missingEvents(["a", "b"], ["a", "c"])).toEqual(["c"]);
    expect(missingEvents(["*"], ["a"])).toEqual([]);
  });

  it("lets Plus subscribers cancel at the end of the month, never switch plans", () => {
    const p = portalConfigurationParams("https://yooits.me");
    expect(p.features.subscription_cancel).toMatchObject({ enabled: true, mode: "at_period_end" });
    expect(p.features.subscription_update.enabled).toBe(false);
    expect(p.business_profile.terms_of_service_url).toBe("https://yooits.me/terms");
  });

  it("tells live and test keys apart", () => {
    expect(keyMode("sk_live_x")).toBe("live");
    expect(keyMode("rk_test_x")).toBe("test");
    expect(keyMode("pk_live_x")).toBeNull();
    expect(keyMode(undefined)).toBeNull();
  });
});

describe("sealed webhook secrets", () => {
  it("open only with the same Stripe key", async () => {
    const sealed = await sealSecret("whsec_example", "sk_test_one");
    expect(sealed.ciphertext).not.toContain("whsec");
    expect(await openSecret(sealed.ciphertext, sealed.iv, "sk_test_one")).toBe("whsec_example");
    expect(await openSecret(sealed.ciphertext, sealed.iv, "sk_test_two")).toBeNull();
    expect(await openSecret("bad", sealed.iv, "sk_test_one")).toBeNull();
  });
});

const ready: FeatureInputs = {
  keyMode: "live",
  accountReady: true,
  connectOk: true,
  plusPriceOk: true,
  portalOk: true,
  webhookOk: { billing_webhook: true, payments_webhook: true, connect_webhook: true },
  env: {
    PLUS_BILLING_ENABLED: false,
    PLUS_CHECKOUT_ENABLED: false,
    PLUS_LIVE_MODE_APPROVED: false,
    TIPPING_ENABLED: false,
    STRIPE_LIVE_MODE_APPROVED: false,
  },
  settings: {
    creatorSubs: { enabled: false, checkout: false },
    gifts: { enabled: false, checkout: false },
    offerings: { enabled: false, checkout: false },
  },
};
const byId = (i: FeatureInputs) => Object.fromEntries(featureReadiness(i).map((f) => [f.id, f]));

describe("payment feature readiness", () => {
  it("with everything set up, Plus, tips and subscriptions are ready but off", () => {
    const f = byId(ready);
    for (const id of ["plus", "tips", "creator_subscriptions"]) {
      expect(f[id]).toMatchObject({ on: false, ready: true, missing: [] });
    }
    expect(f.plus.toTurnOn[0]).toContain("PLUS_LIVE_MODE_APPROVED");
    expect(f.creator_subscriptions.toTurnOn.join(" ")).toContain("Owner > Creators");
  });

  it("gift money and Support Offerings are never ready from here", () => {
    const f = byId(ready);
    expect(f.gift_money.ready).toBe(false);
    expect(f.support_offerings.ready).toBe(false);
  });

  it("names what's missing", () => {
    const f = byId({ ...ready, keyMode: null });
    expect(f.plus.ready).toBe(false);
    expect(f.plus.missing[0]).toContain("secret key");
    const g = byId({ ...ready, connectOk: false, webhookOk: { billing_webhook: true } });
    expect(g.plus.ready).toBe(true);
    expect(g.tips.missing.join(" ")).toContain("Connect");
  });

  it("a live key isn't on without the live approval switch", () => {
    const env = {
      ...ready.env,
      PLUS_BILLING_ENABLED: true,
      PLUS_CHECKOUT_ENABLED: true,
      TIPPING_ENABLED: true,
    };
    const f = byId({ ...ready, env });
    expect(f.plus.on).toBe(false);
    expect(f.tips.on).toBe(false);
    expect(byId({ ...ready, keyMode: "test", env }).plus.on).toBe(true);
  });

  it("owner-only Plus shows as on for the owner, not on for everyone", () => {
    const env = {
      ...ready.env,
      PLUS_BILLING_ENABLED: true,
      PLUS_LIVE_MODE_APPROVED: true,
      PLUS_CHECKOUT_OWNER_ONLY: true,
    };
    const f = byId({ ...ready, env });
    expect(f.plus).toMatchObject({ on: false, ownerOnly: true });
    expect(byId({ ...ready, env: { ...env, PLUS_LIVE_MODE_APPROVED: false } }).plus.ownerOnly).toBe(
      false,
    );
  });
});

describe("reusing what Stripe already has", () => {
  it("picks the Plus price that is ours, else one on a product named Plus, oldest first", async () => {
    const { choosePlusPrice } = await import("./stripe-setup");
    const p = (id: string, created: number, product: unknown, metadata = {}) =>
      ({ id, created, metadata, product: product as never });
    expect(choosePlusPrice([])).toBeNull();
    expect(choosePlusPrice([p("a", 1, { id: "x", name: "Coffee" })])).toBeNull();
    expect(
      choosePlusPrice([
        p("new", 9, { id: "x", name: "Yooits.me Plus", active: true }),
        p("old", 2, { id: "y", name: "Plus monthly", active: true }),
      ])?.id,
    ).toBe("old");
    expect(
      choosePlusPrice([
        p("named", 1, { id: "x", name: "Yooits.me Plus" }),
        p("ours", 5, { id: "y", name: "Something", metadata: { yooits_product: "plus" } }),
      ])?.id,
    ).toBe("ours");
    expect(choosePlusPrice([p("gone", 1, { id: "x", name: "Plus", active: false })])).toBeNull();
  });

  it("finds an existing webhook at the Plus address on a Yooits.me host only", async () => {
    const { endpointsForPlan, WEBHOOK_PLANS } = await import("./stripe-setup");
    const plan = WEBHOOK_PLANS.find((x) => x.item === "billing_webhook")!;
    const e = (url: string) => ({ id: url, url, status: "enabled" });
    expect(
      endpointsForPlan(
        [
          e("https://yooits.me/api/stripe/billing-webhook"),
          e("https://test.yooits.me/api/stripe/billing-webhook"),
          e("https://evil.example/api/stripe/billing-webhook"),
          e("https://yooits.me/api/stripe/webhook"),
          e("not a url"),
        ],
        plan,
      ).map((x) => x.url),
    ).toEqual([
      "https://yooits.me/api/stripe/billing-webhook",
      "https://test.yooits.me/api/stripe/billing-webhook",
    ]);
  });

  it("reads the Plus checkout switch", async () => {
    const { plusCheckoutMode, SETUP_WEBHOOKS } = await import("./stripe-setup");
    expect(plusCheckoutMode("true")).toBe("everyone");
    expect(plusCheckoutMode(" Owner ")).toBe("owner");
    expect(plusCheckoutMode(undefined)).toBe("off");
    expect(plusCheckoutMode("yes")).toBe("off");
    expect(SETUP_WEBHOOKS).toEqual(["billing_webhook"]);
  });
});
