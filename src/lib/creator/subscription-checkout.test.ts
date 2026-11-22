import { describe, expect, it } from "vitest";
import { creatorFeeBreakdown, type FeeRates } from "./fees";
import {
  buildCreatorSubscriptionCheckoutParams,
  subscriptionApplicationFee,
} from "./subscription-checkout";
import { planCreatorSubscriptionCheckout, SubscriptionCheckoutError } from "./subscription-plan";

// The owner's schedule (Nov 22): $0.50 for Yooits, Stripe's card fee on top,
// both paid by the subscriber.
const RATES: FeeRates = {
  yooits_percent_bps: 0,
  yooits_fixed_cents: 50,
  stripe_percent_bps: 290,
  stripe_fixed_cents: 30,
};

const gate = (over: Record<string, unknown> = {}) => ({
  ok: true,
  creator_user_id: "c-1",
  username: "alice",
  display_name: "Alice",
  offer_id: "o-1",
  offer_version: 2,
  price_cents: 500,
  currency: "usd",
  rates: RATES,
  account: {
    stripe_account_id: "acct_1",
    status: "connected",
    charges_enabled: true,
    livemode: false,
  },
  ...over,
});

describe("application fee", () => {
  it("takes Yooits' $0.50 on a $5 subscription and leaves the creator $5", () => {
    const b = creatorFeeBreakdown(500, RATES)!;
    expect(b.total).toBe(597);
    const fee = subscriptionApplicationFee(b)!;
    expect(fee.percent).toBe(8.37);
    expect(fee.cents).toBe(50);
    expect(b.total - b.estimatedProcessingFee - fee.cents).toBe(500);
  });

  it("never takes more than Yooits' share, at any price the owner allows", () => {
    for (let price = 100; price <= 50_000; price += 37) {
      const b = creatorFeeBreakdown(price, RATES)!;
      const fee = subscriptionApplicationFee(b)!;
      // At most two decimals, as Checkout requires.
      expect(Math.round(fee.percent * 100)).toBeCloseTo(fee.percent * 100, 6);
      expect(fee.cents).toBeLessThanOrEqual(b.yooitsNet);
      // So the creator's share is never below their price.
      expect(b.total - b.estimatedProcessingFee - fee.cents).toBeGreaterThanOrEqual(price);
      // And Yooits loses at most a few cents to the rounding.
      expect(b.yooitsNet - fee.cents).toBeLessThanOrEqual(b.total / 10_000 + 0.5);
    }
  });
});

describe("checkout plan", () => {
  it("prices from the database, not the browser", () => {
    const plan = planCreatorSubscriptionCheckout(gate(), { livemode: false });
    expect(plan.breakdown).toMatchObject({ creatorPrice: 500, serviceFee: 97, total: 597 });
    expect(plan.fee).toEqual({ percent: 8.37, cents: 50 });
    expect(plan.stripeAccountId).toBe("acct_1");
  });

  it.each([
    ["off", /aren't available/],
    ["self", /yourself/],
    ["already_subscribed", /already subscribed/],
    ["rate_limited", /Too many/],
    ["unavailable", /isn't taking/],
    ["something new", /isn't taking/],
  ])("refuses when the gate says %s", (reason, msg) => {
    expect(() =>
      planCreatorSubscriptionCheckout({ ok: false, reason }, { livemode: false }),
    ).toThrow(msg);
  });

  it("refuses an account that can't take payments or is in the other Stripe mode", () => {
    const bad = [
      gate({ account: null }),
      gate({
        account: {
          stripe_account_id: "acct_1",
          status: "pending",
          charges_enabled: true,
          livemode: false,
        },
      }),
      gate({
        account: {
          stripe_account_id: "acct_1",
          status: "connected",
          charges_enabled: false,
          livemode: false,
        },
      }),
      gate({
        account: {
          stripe_account_id: "acct_1",
          status: "disconnected",
          charges_enabled: true,
          livemode: false,
        },
      }),
    ];
    for (const g of bad)
      expect(() => planCreatorSubscriptionCheckout(g, { livemode: false })).toThrow(
        SubscriptionCheckoutError,
      );
    expect(() => planCreatorSubscriptionCheckout(gate(), { livemode: true })).toThrow(
      /isn't taking/,
    );
  });

  it("refuses with no fee rates, a bad price or another currency", () => {
    expect(() =>
      planCreatorSubscriptionCheckout(gate({ rates: null }), { livemode: false }),
    ).toThrow(/aren't available/);
    expect(() =>
      planCreatorSubscriptionCheckout(gate({ price_cents: 0 }), { livemode: false }),
    ).toThrow(SubscriptionCheckoutError);
    expect(() =>
      planCreatorSubscriptionCheckout(gate({ currency: "eur" }), { livemode: false }),
    ).toThrow(SubscriptionCheckoutError);
  });
});

describe("checkout session parameters", () => {
  const plan = planCreatorSubscriptionCheckout(gate(), { livemode: false });
  const params = buildCreatorSubscriptionCheckoutParams({
    rowId: "row-1",
    creatorUserId: plan.creatorUserId,
    subscriberUserId: "s-1",
    offerId: plan.offerId,
    handle: plan.username,
    displayName: plan.displayName,
    breakdown: plan.breakdown,
    fee: plan.fee,
    baseUrl: "https://yooits.me",
    email: "bob@example.test",
    now: Date.UTC(2026, 10, 22),
  });

  it("is a monthly subscription with the price and the fee shown as separate lines", () => {
    expect(params.mode).toBe("subscription");
    const lines = params.line_items!.map((l) => ({
      amount: l.price_data!.unit_amount,
      name: l.price_data!.product_data!.name,
      interval: l.price_data!.recurring!.interval,
    }));
    expect(lines).toEqual([
      { amount: 500, name: "Subscription to Alice (@alice)", interval: "month" },
      { amount: 97, name: "Yooits service and processing fee", interval: "month" },
    ]);
    expect(lines.reduce((t, l) => t + l.amount!, 0)).toBe(597);
  });

  it("takes Yooits' share as the application fee and tags everything with the row", () => {
    expect(params.subscription_data!.application_fee_percent).toBe(8.37);
    expect(params.metadata!.yooits_creator_subscription_id).toBe("row-1");
    expect(params.subscription_data!.metadata!.yooits_creator_subscription_id).toBe("row-1");
    expect(params.client_reference_id).toBe("row-1");
    expect(params.success_url).toBe(
      "https://yooits.me/alice/subscribe?status=success&session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("never says there are no fees", () => {
    expect(JSON.stringify(params).toLowerCase()).not.toMatch(/no fees?/);
  });
});
