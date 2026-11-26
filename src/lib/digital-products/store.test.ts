import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyProductEvent } from "./store.server";

const db = vi.hoisted(() => {
  const query = {
    then: (resolve: (result: object) => unknown) => Promise.resolve(resolve({ error: null })),
    eq: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  return { query, update: vi.fn(() => query) };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ update: db.update }) },
}));

function event(type: string, object: object, account = "acct_pilot") {
  return { type, account, livemode: false, data: { object } } as Stripe.Event;
}

describe("digital-product payment events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grants only a matching pending order after a confirmed USD payment", async () => {
    expect(
      await applyProductEvent(
        event("checkout.session.completed", {
          metadata: { digital_order_id: "order-1" },
          currency: "usd",
          payment_status: "paid",
          amount_total: 1200,
        }),
      ),
    ).toBe(true);
    expect(db.update).toHaveBeenCalledWith({ status: "paid" });
    expect(db.query.eq.mock.calls).toEqual([
      ["id", "order-1"],
      ["status", "pending"],
      ["stripe_account_id", "acct_pilot"],
      ["livemode", false],
      ["amount_cents", 1200],
    ]);
  });

  it("never grants access for an unpaid checkout", async () => {
    expect(
      await applyProductEvent(
        event("checkout.session.completed", {
          metadata: { digital_order_id: "order-1" },
          currency: "usd",
          payment_status: "unpaid",
        }),
      ),
    ).toBe(true);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("revokes access even if the refund arrives before checkout completion", async () => {
    expect(
      await applyProductEvent(
        event("charge.refunded", {
          metadata: { digital_order_id: "order-1" },
        }),
      ),
    ).toBe(true);
    expect(db.update).toHaveBeenCalledWith({ status: "revoked" });
    expect(db.query.eq.mock.calls).toEqual([
      ["id", "order-1"],
      ["stripe_account_id", "acct_pilot"],
      ["livemode", false],
    ]);
  });

  it("leaves unrelated payments to the existing handlers", async () => {
    expect(await applyProductEvent(event("charge.refunded", { metadata: {} }))).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });
});
