import { afterEach, describe, expect, it } from "vitest";
import { founderTrialEnd, priceIsPlus, statusBlocksNewCheckout, statusKeepsPlus } from "./plus";
import { getBillingConfig } from "./config.server";
import {
  handleBillingEvent,
  isPlusSubscription,
  subscriptionIdFromEvent,
  subscriptionToRow,
  type BillingStore,
  type PlusSubscriptionRow,
  type StripeSubscriptionLike,
} from "./sync";
import { getTheme, isPremiumTheme, PREMIUM_THEME_KEYS, THEME_PRESETS } from "@/lib/themes";
import { readFileSync } from "node:fs";

const USER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b1";

const plusSub = (over: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike => ({
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  livemode: false,
  metadata: { user_id: USER, yooits_product: "plus" },
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  ended_at: null,
  trial_end: null,
  items: { data: [{ price: { id: "price_plus", unit_amount: 499, currency: "usd", lookup_key: "yooits_plus_monthly" }, current_period_end: 1800000000 }] },
  ...over,
});

function memStore(customers: Record<string, string> = {}, users = new Set([USER, OTHER])) {
  const events = new Map<string, "claimed" | "processed">();
  const subs = new Map<string, PlusSubscriptionRow>();
  const links: string[] = [];
  const store: BillingStore = {
    async claimEvent(e) {
      const s = events.get(e.id);
      if (s === "processed") return "duplicate";
      if (s === "claimed") return "in_progress";
      events.set(e.id, "claimed");
      return "claimed";
    },
    async markEventProcessed(id) {
      events.set(id, "processed");
    },
    async releaseEvent(id) {
      events.delete(id);
    },
    async userForCustomer(c) {
      return customers[c] ?? null;
    },
    async userExists(u) {
      return users.has(u);
    },
    async linkCustomer(c, u) {
      customers[c] = u;
      links.push(`${c}=${u}`);
    },
    async upsertSubscription(row) {
      subs.set(row.stripe_subscription_id, row);
    },
  };
  return { store, events, subs, links, customers };
}

const ev = (type: string, object: Record<string, unknown>, id = "evt_1", livemode = false) => ({ id, type, livemode, data: { object } });

describe("Plus price and plan rules", () => {
  it("accepts only an active $4.99 USD monthly recurring price", () => {
    const ok = { active: true, type: "recurring", unit_amount: 499, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
    expect(priceIsPlus(ok)).toBe(true);
    expect(priceIsPlus({ ...ok, unit_amount: 500 })).toBe(false);
    expect(priceIsPlus({ ...ok, currency: "eur" })).toBe(false);
    expect(priceIsPlus({ ...ok, recurring: { interval: "year" } })).toBe(false);
    expect(priceIsPlus({ ...ok, recurring: { interval: "month", interval_count: 3 } })).toBe(false);
    expect(priceIsPlus({ ...ok, active: false })).toBe(false);
    expect(priceIsPlus({ ...ok, type: "one_time" })).toBe(false);
  });

  it("matches the database on which statuses keep Plus", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261122120000_plus_billing.sql", import.meta.url), "utf8");
    expect(sql).toContain("_status IN ('active', 'trialing', 'past_due')");
    for (const s of ["active", "trialing", "past_due"] as const) expect(statusKeepsPlus(s)).toBe(true);
    for (const s of ["incomplete", "incomplete_expired", "canceled", "unpaid", "paused"] as const) expect(statusKeepsPlus(s)).toBe(false);
    expect(statusBlocksNewCheckout("canceled")).toBe(false);
    expect(statusBlocksNewCheckout("incomplete_expired")).toBe(false);
    expect(statusBlocksNewCheckout("unpaid")).toBe(true);
  });

  it("premium theme keys match the database and fall back when not on Plus", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261122125000_seasonal_themes_rewards.sql", import.meta.url), "utf8");
    const m = sql.match(/_key IN \(([^)]*)\)/);
    expect(m![1].match(/'([a-z_]+)'/g)!.map((x) => x.slice(1, -1))).toEqual([...PREMIUM_THEME_KEYS]);
    // No premium key reuses a free theme's key.
    for (const k of PREMIUM_THEME_KEYS) expect(THEME_PRESETS.some((p) => p.key === k)).toBe(false);
    expect(isPremiumTheme("aurora")).toBe(true);
    expect(isPremiumTheme("sunset")).toBe(false);
    expect(getTheme("aurora", null, { plus: false })).toEqual(THEME_PRESETS[0].tokens);
    expect(getTheme("aurora", null, { plus: true })).not.toEqual(THEME_PRESETS[0].tokens);
    expect(getTheme("sunset", null)).toEqual(THEME_PRESETS.find((p) => p.key === "sunset")!.tokens);
  });

  it("charges a Founding Member who keeps Plus only when the free months end", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(founderTrialEnd("2027-03-01T00:00:00Z", now)).toBe(Date.parse("2027-03-01T00:00:00Z") / 1000);
    expect(founderTrialEnd("2026-12-02T00:00:00Z", now)).toBeNull(); // under 48h: Stripe needs more
    expect(founderTrialEnd(null, now)).toBeNull();
    expect(founderTrialEnd("not a date", now)).toBeNull();
  });
});

describe("billing config", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const set = (v: Record<string, string | undefined>) => {
    for (const k of ["PLUS_BILLING_ENABLED", "PLUS_CHECKOUT_ENABLED", "PLUS_LIVE_MODE_APPROVED", "STRIPE_SECRET_KEY", "VERCEL_ENV", "STRIPE_TEST_MODE_ON_PRODUCTION", "STRIPE_LIVE_MODE_APPROVED", "TIPPING_ENABLED"]) delete process.env[k];
    Object.assign(process.env, v);
  };

  it("is off unless switched on, and checkout is a second switch", () => {
    set({ STRIPE_SECRET_KEY: "sk_test_x" });
    expect(() => getBillingConfig()).toThrow();
    set({ STRIPE_SECRET_KEY: "sk_test_x", PLUS_BILLING_ENABLED: "true" });
    expect(getBillingConfig().checkoutOpen).toBe(false);
    set({ STRIPE_SECRET_KEY: "sk_test_x", PLUS_BILLING_ENABLED: "true", PLUS_CHECKOUT_ENABLED: "true" });
    expect(getBillingConfig().checkoutOpen).toBe(true);
    set({ STRIPE_SECRET_KEY: "sk_test_x", PLUS_CHECKOUT_ENABLED: "true" });
    expect(() => getBillingConfig()).toThrow();
  });

  it("refuses a live key without its own approval; the tipping approval doesn't count", () => {
    set({ STRIPE_SECRET_KEY: "sk_live_x", PLUS_BILLING_ENABLED: "true", PLUS_CHECKOUT_ENABLED: "true", STRIPE_LIVE_MODE_APPROVED: "true", TIPPING_ENABLED: "true" });
    expect(() => getBillingConfig()).toThrow();
    set({ STRIPE_SECRET_KEY: "sk_live_x", PLUS_BILLING_ENABLED: "true", PLUS_LIVE_MODE_APPROVED: "true" });
    expect(getBillingConfig().liveModeAllowed).toBe(true);
  });

  it("keeps a test key off the production site unless explicitly allowed", () => {
    set({ STRIPE_SECRET_KEY: "sk_test_x", PLUS_BILLING_ENABLED: "true", VERCEL_ENV: "production" });
    expect(() => getBillingConfig()).toThrow();
    set({ STRIPE_SECRET_KEY: "sk_test_x", PLUS_BILLING_ENABLED: "true", VERCEL_ENV: "preview" });
    expect(() => getBillingConfig()).not.toThrow();
    set({ STRIPE_SECRET_KEY: "pk_test_x", PLUS_BILLING_ENABLED: "true" });
    expect(() => getBillingConfig()).toThrow();
  });
});

describe("billing webhook", () => {
  const deps = (store: BillingStore, sub = plusSub(), extra: Partial<Parameters<typeof handleBillingEvent>[1]> = {}) => ({
    store,
    liveModeAllowed: false,
    plusPriceId: null,
    retrieveSubscription: async () => sub,
    ...extra,
  });

  it("finds the subscription in each event type", () => {
    expect(subscriptionIdFromEvent(ev("checkout.session.completed", { mode: "subscription", subscription: "sub_1", metadata: { yooits_product: "plus" } }))).toBe("sub_1");
    expect(subscriptionIdFromEvent(ev("checkout.session.completed", { mode: "payment", metadata: {} }))).toBeNull(); // a tip
    expect(subscriptionIdFromEvent(ev("checkout.session.completed", { mode: "subscription", subscription: "sub_1", metadata: {} }))).toBeNull();
    expect(subscriptionIdFromEvent(ev("customer.subscription.deleted", { id: "sub_9" }))).toBe("sub_9");
    expect(subscriptionIdFromEvent(ev("invoice.payment_failed", { parent: { subscription_details: { subscription: "sub_7" } } }))).toBe("sub_7");
    expect(subscriptionIdFromEvent(ev("invoice.paid", { subscription: "sub_8" }))).toBe("sub_8");
    expect(subscriptionIdFromEvent(ev("charge.refunded", { id: "ch_1" }))).toBeNull();
  });

  it("stores the subscription for the checkout's account and links the customer", async () => {
    const m = memStore();
    const r = await handleBillingEvent(ev("checkout.session.completed", { mode: "subscription", subscription: "sub_1", metadata: { yooits_product: "plus" } }), deps(m.store));
    expect(r.outcome).toBe("synced");
    expect(m.subs.get("sub_1")).toMatchObject({ user_id: USER, status: "active", unit_amount_cents: 499, livemode: false, current_period_end: new Date(1800000000 * 1000).toISOString() });
    expect(m.links).toEqual([`cus_1=${USER}`]);
    expect(m.events.get("plus:evt_1")).toBe("processed");
  });

  it("is idempotent and order-independent: every event stores what Stripe says now", async () => {
    const m = memStore({ cus_1: USER });
    await handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1" }, "evt_a"), deps(m.store, plusSub({ status: "canceled", ended_at: 1800000001 })));
    // An older "created" event delivered late still reads the current state from Stripe.
    await handleBillingEvent(ev("customer.subscription.created", { id: "sub_1" }, "evt_b"), deps(m.store, plusSub({ status: "canceled", ended_at: 1800000001 })));
    expect(m.subs.get("sub_1")!.status).toBe("canceled");
    const again = await handleBillingEvent(ev("customer.subscription.created", { id: "sub_1" }, "evt_b"), deps(m.store));
    expect(again.outcome).toBe("duplicate");
    expect(m.subs.get("sub_1")!.status).toBe("canceled");
  });

  it("records cancellation at period end and payment failure", async () => {
    const m = memStore({ cus_1: USER });
    await handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1" }, "e1"), deps(m.store, plusSub({ cancel_at_period_end: true })));
    expect(m.subs.get("sub_1")!.cancel_at_period_end).toBe(true);
    await handleBillingEvent(ev("invoice.payment_failed", { subscription: "sub_1" }, "e2"), deps(m.store, plusSub({ status: "past_due" })));
    expect(m.subs.get("sub_1")!.status).toBe("past_due");
  });

  it("never moves Plus to another account on metadata alone", async () => {
    const m = memStore({ cus_1: OTHER });
    const r = await handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1" }), deps(m.store));
    expect(r.outcome).toBe("customer_mismatch");
    expect(m.subs.size).toBe(0);
  });

  it("ignores subscriptions that aren't Plus, unknown customers, and live events until live billing is approved", async () => {
    const m = memStore();
    const other = plusSub({ metadata: {}, items: { data: [{ price: { id: "price_x", lookup_key: "something_else" } }] } });
    expect((await handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1" }, "e1"), deps(m.store, other))).outcome).toBe("not_plus");
    const noUser = plusSub({ metadata: { yooits_product: "plus" } });
    expect((await handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1" }, "e2"), deps(m.store, noUser))).outcome).toBe("unknown_customer");
    expect((await handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1" }, "e3", true), deps(m.store))).outcome).toBe("live_not_approved");
    expect(m.subs.size).toBe(0);
    const live = await handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1" }, "e4", true), deps(m.store, plusSub({ livemode: true }), { liveModeAllowed: true }));
    expect(live.outcome).toBe("synced");
  });

  it("keeps the record with no account when the account was deleted", async () => {
    const m = memStore({ cus_1: USER }, new Set());
    await handleBillingEvent(ev("customer.subscription.deleted", { id: "sub_1" }), deps(m.store, plusSub({ status: "canceled" })));
    expect(m.subs.get("sub_1")!.user_id).toBeNull();
  });

  it("releases the claim when Stripe can't be reached, so the retry runs", async () => {
    const m = memStore({ cus_1: USER });
    await expect(
      handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1" }), deps(m.store, plusSub(), { retrieveSubscription: async () => { throw new Error("network"); } })),
    ).rejects.toThrow("network");
    expect(m.events.has("plus:evt_1")).toBe(false);
    expect((await handleBillingEvent(ev("customer.subscription.updated", { id: "sub_1" }), deps(m.store))).outcome).toBe("synced");
  });

  it("maps the price by configured id too", () => {
    const s = plusSub({ metadata: {}, items: { data: [{ price: { id: "price_cfg", lookup_key: null } }] } });
    expect(isPlusSubscription(s, null)).toBe(false);
    expect(isPlusSubscription(s, "price_cfg")).toBe(true);
    expect(() => subscriptionToRow(plusSub({ status: "weird" }), USER)).toThrow();
  });
});
