import { beforeEach, describe, expect, it } from "vitest";
import {
  handleStripeEvent,
  RetryLaterError,
  type HandlerDeps,
  type StripeEventLike,
  type TipPatch,
  type TipRow,
  type TippingStore,
} from "./webhook-handler";

const ACCT = "acct_creator";
const TIP_ID = "11111111-1111-4111-8111-111111111111";

class MemoryStore implements TippingStore {
  events = new Map<string, { processed: boolean }>();
  tips = new Map<string, TipRow & { paid_at?: string; dispute_amount_cents?: number | null }>();
  accounts = new Map<string, Record<string, unknown>>();

  async claimEvent(e: { id: string }) {
    const existing = this.events.get(e.id);
    if (existing?.processed) return "duplicate" as const;
    if (!existing) this.events.set(e.id, { processed: false });
    return "new" as const;
  }
  async markEventProcessed(id: string) {
    this.events.set(id, { processed: true });
  }
  async getTipById(id: string) {
    return this.tips.get(id) ?? null;
  }
  async getTipByPaymentIntent(pi: string) {
    return [...this.tips.values()].find((t) => t.payment_intent_id === pi) ?? null;
  }
  async getTipByChargeId(ch: string) {
    return [...this.tips.values()].find((t) => t.charge_id === ch) ?? null;
  }
  async updateTip(id: string, patch: TipPatch) {
    const t = this.tips.get(id);
    if (t) this.tips.set(id, { ...t, ...patch } as TipRow);
  }
  async updateAccount(id: string, patch: Record<string, unknown>) {
    const a = this.accounts.get(id);
    if (a) this.accounts.set(id, { ...a, ...patch });
  }
  async getAccountStatus(id: string) {
    return (this.accounts.get(id)?.status as string) ?? null;
  }
}

let store: MemoryStore;
let deps: HandlerDeps;
let seq = 0;

const ev = (
  type: string,
  object: Record<string, unknown>,
  extra: Partial<StripeEventLike> = {},
): StripeEventLike => ({
  id: `evt_${++seq}`,
  type,
  account: ACCT,
  livemode: false,
  data: { object },
  ...extra,
});

const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_1",
  object: "checkout.session",
  amount_total: 1050,
  currency: "usd",
  payment_status: "paid",
  status: "complete",
  payment_intent: "pi_1",
  metadata: { yooits_tip_id: TIP_ID },
  ...over,
});

beforeEach(() => {
  store = new MemoryStore();
  store.accounts.set(ACCT, { status: "connected" });
  store.tips.set(TIP_ID, {
    id: TIP_ID,
    creator_user_id: "creator",
    stripe_account_id: ACCT,
    checkout_session_id: "cs_test_1",
    payment_intent_id: null,
    charge_id: null,
    tip_amount_cents: 1000,
    platform_fee_cents: 50,
    total_cents: 1050,
    status: "pending",
    amount_refunded_cents: 0,
    platform_fee_refunded_cents: 0,
    dispute_status: null,
    livemode: false,
  });
  deps = { store, liveModeAllowed: false, fetchLatestChargeId: async () => "ch_1" };
});

const tip = () => store.tips.get(TIP_ID)!;

describe("checkout completion", () => {
  it("marks a paid session's tip succeeded and links the payment and charge", async () => {
    const r = await handleStripeEvent(ev("checkout.session.completed", session()), deps);
    expect(r.outcome).toBe("processed");
    expect(tip().status).toBe("succeeded");
    expect(tip().payment_intent_id).toBe("pi_1");
    expect(tip().charge_id).toBe("ch_1");
  });

  it("ignores duplicate deliveries of the same event", async () => {
    const e = ev("checkout.session.completed", session());
    await handleStripeEvent(e, deps);
    const again = await handleStripeEvent(e, deps);
    expect(again.outcome).toBe("duplicate");
    expect(tip().status).toBe("succeeded");
  });

  it("is safe when Stripe sends completed and async_payment_succeeded for the same payment", async () => {
    await handleStripeEvent(ev("checkout.session.completed", session()), deps);
    await handleStripeEvent(ev("checkout.session.async_payment_succeeded", session()), deps);
    expect(tip().status).toBe("succeeded");
  });

  it("waits for delayed payment methods instead of marking them paid", async () => {
    await handleStripeEvent(
      ev("checkout.session.completed", session({ payment_status: "unpaid" })),
      deps,
    );
    expect(tip().status).toBe("pending");
    await handleStripeEvent(ev("checkout.session.async_payment_failed", session()), deps);
    expect(tip().status).toBe("failed");
  });

  it("flags the tip for review if the charged amount differs from what we created", async () => {
    await handleStripeEvent(ev("checkout.session.completed", session({ amount_total: 1 })), deps);
    expect(tip().status).toBe("needs_review");
  });

  it("flags the tip for review if the event comes from a different connected account", async () => {
    await handleStripeEvent(
      ev("checkout.session.completed", session(), { account: "acct_attacker" }),
      deps,
    );
    expect(tip().status).toBe("needs_review");
  });

  it("flags currency or session-id mismatches", async () => {
    await handleStripeEvent(ev("checkout.session.completed", session({ currency: "eur" })), deps);
    expect(tip().status).toBe("needs_review");
    tip().status = "pending";
    await handleStripeEvent(ev("checkout.session.completed", session({ id: "cs_other" })), deps);
    expect(tip().status).toBe("needs_review");
  });

  it("marks abandoned checkouts expired, but never un-pays a paid tip", async () => {
    await handleStripeEvent(
      ev("checkout.session.expired", session({ payment_status: "unpaid" })),
      deps,
    );
    expect(tip().status).toBe("expired");

    tip().status = "succeeded";
    await handleStripeEvent(ev("checkout.session.expired", session()), deps);
    expect(tip().status).toBe("succeeded");
  });

  it("ignores sessions that aren't Yooits tips", async () => {
    const r = await handleStripeEvent(
      ev("checkout.session.completed", session({ metadata: {} })),
      deps,
    );
    expect(r.detail).toBe("not a Yooits tip session");
    expect(tip().status).toBe("pending");
  });

  it("still succeeds if looking up the charge id fails", async () => {
    deps.fetchLatestChargeId = async () => {
      throw new Error("network");
    };
    await handleStripeEvent(ev("checkout.session.completed", session()), deps);
    expect(tip().status).toBe("succeeded");
    expect(tip().charge_id).toBeNull();
  });
});

describe("refunds and disputes", () => {
  beforeEach(async () => {
    await handleStripeEvent(ev("checkout.session.completed", session()), deps);
  });

  it("records refunds as absolute amounts, so retries can't double-count", async () => {
    const refund = {
      id: "ch_1",
      payment_intent: "pi_1",
      amount_refunded: 1050,
      application_fee: "fee_1",
    };
    await handleStripeEvent(ev("charge.refunded", refund), deps);
    await handleStripeEvent(ev("charge.refunded", refund), deps); // new event id, same refund
    expect(tip().amount_refunded_cents).toBe(1050);
  });

  it("records the Yooits fee being refunded, capped at the fee", async () => {
    await handleStripeEvent(
      ev(
        "application_fee.refunded",
        { id: "fee_1", charge: "ch_1", account: ACCT, amount_refunded: 50 },
        { account: null },
      ),
      deps,
    );
    expect(tip().platform_fee_refunded_cents).toBe(50);
    await handleStripeEvent(
      ev(
        "application_fee.refunded",
        { id: "fee_1", charge: "ch_1", account: ACCT, amount_refunded: 9999 },
        { account: null },
      ),
      deps,
    );
    expect(tip().platform_fee_refunded_cents).toBe(50);
  });

  it("tracks a dispute from opening to close", async () => {
    await handleStripeEvent(
      ev("charge.dispute.created", {
        id: "dp_1",
        payment_intent: "pi_1",
        status: "needs_response",
        amount: 1050,
      }),
      deps,
    );
    expect(tip().dispute_status).toBe("needs_response");
    await handleStripeEvent(
      ev("charge.dispute.closed", {
        id: "dp_1",
        payment_intent: "pi_1",
        status: "lost",
        amount: 1050,
      }),
      deps,
    );
    expect(tip().dispute_status).toBe("lost");
    expect(tip().status).toBe("succeeded");
  });

  it("does not let another account's dispute touch this tip", async () => {
    const r = await handleStripeEvent(
      ev(
        "charge.dispute.created",
        { id: "dp_x", payment_intent: "pi_1", status: "needs_response" },
        { account: "acct_other" },
      ),
      deps,
    );
    expect(r.outcome).toBe("processed");
    expect(tip().dispute_status).toBeNull();
  });
});

describe("out-of-order delivery", () => {
  it("asks Stripe to retry a refund that arrives before the tip is linked, then applies it", async () => {
    const refund = ev("charge.refunded", {
      id: "ch_1",
      payment_intent: "pi_1",
      amount_refunded: 1050,
      application_fee: "fee_1",
    });
    await expect(handleStripeEvent(refund, deps)).rejects.toBeInstanceOf(RetryLaterError);
    expect(store.events.get(refund.id)?.processed).toBe(false);

    await handleStripeEvent(ev("checkout.session.completed", session()), deps);
    const retried = await handleStripeEvent(refund, deps); // Stripe redelivers the same event
    expect(retried.outcome).toBe("processed");
    expect(tip().amount_refunded_cents).toBe(1050);
  });

  it("does not retry forever for charges that were never Yooits tips", async () => {
    const r = await handleStripeEvent(
      ev("charge.refunded", {
        id: "ch_other",
        payment_intent: "pi_other",
        amount_refunded: 100,
        application_fee: null,
      }),
      deps,
    );
    expect(r.outcome).toBe("processed");
  });
});

describe("connected accounts", () => {
  it("updates status from account.updated", async () => {
    await handleStripeEvent(
      ev("account.updated", {
        id: ACCT,
        charges_enabled: false,
        details_submitted: true,
        requirements: { disabled_reason: "requirements.past_due" },
      }),
      deps,
    );
    expect(store.accounts.get(ACCT)?.status).toBe("restricted");
    await handleStripeEvent(
      ev("account.updated", { id: ACCT, charges_enabled: true, details_submitted: true }),
      deps,
    );
    expect(store.accounts.get(ACCT)?.status).toBe("connected");
  });

  it("keeps a creator disconnected until they reconnect themselves", async () => {
    store.accounts.set(ACCT, { status: "disconnected" });
    await handleStripeEvent(
      ev("account.updated", { id: ACCT, charges_enabled: true, details_submitted: true }),
      deps,
    );
    expect(store.accounts.get(ACCT)?.status).toBe("disconnected");
    expect(store.accounts.get(ACCT)?.charges_enabled).toBe(true);
  });

  it("marks deauthorized accounts disconnected", async () => {
    await handleStripeEvent(ev("account.application.deauthorized", { id: "ca_1" }), deps);
    expect(store.accounts.get(ACCT)?.status).toBe("disconnected");
  });
});

describe("safety rails", () => {
  it("ignores live-mode events until live payments are approved", async () => {
    const r = await handleStripeEvent(
      ev("checkout.session.completed", session(), { livemode: true }),
      deps,
    );
    expect(r.outcome).toBe("ignored");
    expect(tip().status).toBe("pending");
    expect(store.events.size).toBe(0);
  });

  it("ignores event types it doesn't handle", async () => {
    const r = await handleStripeEvent(ev("customer.created", { id: "cus_1" }), deps);
    expect(r.outcome).toBe("ignored");
  });
});
