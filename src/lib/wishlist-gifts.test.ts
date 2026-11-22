import { describe, expect, it } from "vitest";
import {
  applyWishlistGiftEvent,
  buildGiftCheckoutParams,
  GiftCheckoutError,
  isWishlistGiftEvent,
  planWishlistGiftCheckout,
  type GiftPatch,
  type GiftRow,
} from "./wishlist-gifts";

const gate = (over: Record<string, unknown> = {}) => ({
  ok: true,
  recipient_user_id: "u-parent",
  username: "mom",
  wishlist_id: "w1",
  wishlist_slug: "mias-christmas",
  item_id: "i1",
  item_name: "Bike",
  amount_min_cents: 500,
  amount_max_cents: 50000,
  rates: {
    yooits_percent_bps: 0,
    yooits_fixed_cents: 50,
    stripe_percent_bps: 290,
    stripe_fixed_cents: 30,
  },
  account: { stripe_account_id: "acct_1", livemode: false },
  ...over,
});

describe("planWishlistGiftCheckout", () => {
  it("passes on the gate's refusal", () => {
    expect(() =>
      planWishlistGiftCheckout({ ok: false, reason: "off" }, 1000, { livemode: false }),
    ).toThrow("Gift money isn't available.");
    expect(() => planWishlistGiftCheckout(null, 1000, { livemode: false })).toThrow(
      GiftCheckoutError,
    );
  });

  it("refuses amounts outside the range, and a mode mismatch", () => {
    expect(() => planWishlistGiftCheckout(gate(), 499, { livemode: false })).toThrow(/range/);
    expect(() => planWishlistGiftCheckout(gate(), 50001, { livemode: false })).toThrow(/range/);
    expect(() => planWishlistGiftCheckout(gate(), 10.5, { livemode: false })).toThrow(/range/);
    expect(() => planWishlistGiftCheckout(gate(), 1000, { livemode: true })).toThrow(
      /isn't taking/,
    );
  });

  it("refuses when the fee is unset", () => {
    expect(() =>
      planWishlistGiftCheckout(gate({ rates: { yooits_fixed_cents: 50 } }), 1000, {
        livemode: false,
      }),
    ).toThrow("Gift money isn't available.");
  });

  it("works the fee out on the server so the list owner gets the whole gift", () => {
    const plan = planWishlistGiftCheckout(gate(), 2000, { livemode: false });
    const b = plan.breakdown;
    expect(b.creatorPrice).toBe(2000);
    expect(b.total).toBe(b.creatorPrice + b.serviceFee);
    // Owner's account pays Stripe's fee on the total; after that and Yooits' fee they keep the gift.
    expect(b.total - b.estimatedProcessingFee - plan.applicationFeeCents).toBe(2000);
    expect(plan.applicationFeeCents).toBeGreaterThanOrEqual(50);
  });

  it("builds a direct-charge checkout with the gift id everywhere", () => {
    const plan = planWishlistGiftCheckout(gate(), 2000, { livemode: false });
    const p = buildGiftCheckoutParams({ giftId: "g1", plan, baseUrl: "https://yooits.me", now: 0 });
    expect(p.mode).toBe("payment");
    expect(p.payment_intent_data?.application_fee_amount).toBe(plan.applicationFeeCents);
    expect(p.metadata?.yooits_wishlist_gift_id).toBe("g1");
    expect(p.payment_intent_data?.metadata?.yooits_wishlist_gift_id).toBe("g1");
    const sum = p.line_items!.reduce((n, l) => n + (l.price_data!.unit_amount as number), 0);
    expect(sum).toBe(plan.breakdown.total);
    expect(p.success_url).toBe("https://yooits.me/mom/wishlist/mias-christmas?gift=success");
  });
});

describe("gift webhook", () => {
  const row: GiftRow = {
    id: "g1",
    stripe_account_id: "acct_1",
    total_cents: 2093,
    livemode: false,
    status: "pending",
  };
  const store = () => {
    const patches: GiftPatch[] = [];
    let current = { ...row };
    return {
      patches,
      store: {
        getById: async (id: string) => (id === current.id ? current : null),
        update: async (_id: string, p: GiftPatch) => {
          patches.push(p);
          current = { ...current, ...p } as GiftRow;
        },
      },
    };
  };
  const ev = (
    type: string,
    obj: Record<string, unknown> = {},
    over: Record<string, unknown> = {},
  ) => ({
    id: "evt_1",
    type,
    account: "acct_1",
    livemode: false,
    data: {
      object: {
        id: "cs_1",
        amount_total: 2093,
        currency: "usd",
        payment_status: "paid",
        payment_intent: "pi_1",
        metadata: { yooits_wishlist_gift_id: "g1" },
        ...obj,
      },
    },
    ...over,
  });

  it("only takes checkout events that carry a gift id", () => {
    expect(isWishlistGiftEvent(ev("checkout.session.completed"))).toBe(true);
    expect(
      isWishlistGiftEvent(ev("checkout.session.completed", { metadata: { yooits_tip_id: "t" } })),
    ).toBe(false);
    expect(isWishlistGiftEvent(ev("charge.refunded"))).toBe(false);
  });

  it("marks a paid gift succeeded once", async () => {
    const s = store();
    expect(
      await applyWishlistGiftEvent(ev("checkout.session.completed"), {
        store: s.store,
        liveModeAllowed: false,
      }),
    ).toBe("updated");
    expect(s.patches[0]).toMatchObject({ status: "succeeded", payment_intent_id: "pi_1" });
    expect(
      await applyWishlistGiftEvent(ev("checkout.session.expired"), {
        store: s.store,
        liveModeAllowed: false,
      }),
    ).toBe("ignored");
  });

  it("flags anything that doesn't match what the server created", async () => {
    for (const bad of [
      ev("checkout.session.completed", { amount_total: 1 }),
      ev("checkout.session.completed", {}, { account: "acct_other" }),
      ev("checkout.session.completed", {}, { livemode: true }),
    ]) {
      const s = store();
      expect(await applyWishlistGiftEvent(bad, { store: s.store, liveModeAllowed: false })).toBe(
        "needs_review",
      );
    }
  });

  it("waits for async payments and records failures and expiry", async () => {
    const s = store();
    expect(
      await applyWishlistGiftEvent(ev("checkout.session.completed", { payment_status: "unpaid" }), {
        store: s.store,
        liveModeAllowed: false,
      }),
    ).toBe("ignored");
    expect(
      await applyWishlistGiftEvent(ev("checkout.session.async_payment_failed"), {
        store: s.store,
        liveModeAllowed: false,
      }),
    ).toBe("updated");
    expect(s.patches.at(-1)).toEqual({ status: "failed" });
  });
});
