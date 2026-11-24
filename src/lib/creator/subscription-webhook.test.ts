import { beforeEach, describe, expect, it } from "vitest";
import {
  handleCreatorSubscriptionEvent,
  isCreatorSubscriptionEvent,
  mapStripeSubscriptionStatus,
  SubscriptionRetryLaterError,
  type CreatorSubPatch,
  type CreatorSubRow,
  type CreatorSubscriptionStore,
  type SubscriptionEventLike,
} from "./subscription-webhook";

/** In-memory store with the same claim semantics as claim_stripe_event. */
function memoryStore() {
  const rows = new Map<string, CreatorSubRow & Record<string, unknown>>();
  const events = new Map<string, { processed: boolean; claimed: boolean }>();
  const store: CreatorSubscriptionStore & { failNextUpdate?: boolean } = {
    async claimEvent(e) {
      const cur = events.get(e.id);
      if (!cur) {
        events.set(e.id, { processed: false, claimed: true });
        return "claimed";
      }
      if (cur.processed) return "duplicate";
      if (cur.claimed) return "in_progress";
      cur.claimed = true;
      return "claimed";
    },
    async markEventProcessed(id) {
      events.get(id)!.processed = true;
    },
    async releaseEvent(id) {
      events.get(id)!.claimed = false;
    },
    async getById(id) {
      return rows.get(id) ?? null;
    },
    async getByStripeSubscriptionId(id) {
      return [...rows.values()].find((r) => r.stripe_subscription_id === id) ?? null;
    },
    async update(id, patch: CreatorSubPatch) {
      if (store.failNextUpdate) {
        store.failNextUpdate = false;
        throw new Error("database down");
      }
      Object.assign(rows.get(id)!, patch);
    },
  };
  return { store, rows, events };
}

const ROW: CreatorSubRow = {
  id: "row-1",
  subscriber_user_id: "bob",
  creator_user_id: "alice",
  stripe_account_id: "acct_alice",
  checkout_session_id: "cs_test_1",
  stripe_subscription_id: null,
  status: "incomplete",
  livemode: false,
  total_cents: 597,
  stripe_synced_at: null,
  needs_review: false,
};

const meta = { yooits_creator_subscription_id: "row-1" };
let n = 0;
const ev = (
  type: string,
  object: Record<string, unknown>,
  over: Partial<SubscriptionEventLike> = {},
): SubscriptionEventLike => ({
  id: `evt_${++n}`,
  type,
  account: "acct_alice",
  livemode: false,
  created: 1_800_000_000 + n,
  data: { object },
  ...over,
});

const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_1",
  mode: "subscription",
  amount_total: 597,
  currency: "usd",
  payment_status: "paid",
  subscription: "sub_1",
  customer: "cus_1",
  metadata: meta,
  ...over,
});

const subscription = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  currency: "usd",
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  metadata: meta,
  items: {
    data: [
      {
        quantity: 1,
        current_period_end: 1_802_592_000,
        price: { unit_amount: 500, currency: "usd" },
      },
      {
        quantity: 1,
        current_period_end: 1_802_592_000,
        price: { unit_amount: 97, currency: "usd" },
      },
    ],
  },
  ...over,
});

let mem: ReturnType<typeof memoryStore>;
const run = (e: SubscriptionEventLike, liveModeAllowed = false) =>
  handleCreatorSubscriptionEvent(e, { store: mem.store, liveModeAllowed });
const row = () => mem.rows.get("row-1")!;

beforeEach(() => {
  mem = memoryStore();
  mem.rows.set("row-1", { ...ROW });
});

describe("routing", () => {
  it("takes subscription events and our checkouts on connected accounts only", () => {
    expect(isCreatorSubscriptionEvent(ev("customer.subscription.updated", subscription()))).toBe(
      true,
    );
    expect(isCreatorSubscriptionEvent(ev("checkout.session.completed", session()))).toBe(true);
    // A tip checkout has no subscription row id.
    expect(
      isCreatorSubscriptionEvent(
        ev("checkout.session.completed", { metadata: { yooits_tip_id: "t" } }),
      ),
    ).toBe(false);
    // Platform events (Yooits.me Plus) are never ours, so they're never claimed here.
    expect(
      isCreatorSubscriptionEvent(
        ev("customer.subscription.updated", subscription(), { account: null }),
      ),
    ).toBe(false);
    expect(isCreatorSubscriptionEvent(ev("charge.refunded", {}))).toBe(false);
  });

  it("maps Stripe's statuses so only paying subscriptions give access", () => {
    expect(mapStripeSubscriptionStatus("active")).toBe("active");
    expect(mapStripeSubscriptionStatus("trialing")).toBe("active");
    expect(mapStripeSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapStripeSubscriptionStatus("incomplete_expired")).toBe("expired");
    expect(mapStripeSubscriptionStatus("paused")).toBe("unpaid");
    expect(mapStripeSubscriptionStatus("unpaid")).toBe("unpaid");
    expect(mapStripeSubscriptionStatus("canceled")).toBe("canceled");
    expect(mapStripeSubscriptionStatus("something new")).toBe("incomplete");
  });
});

describe("checkout", () => {
  it("starts the subscription when the first payment is in", async () => {
    const r = await run(ev("checkout.session.completed", session()));
    expect(r).toEqual({ outcome: "processed", detail: "subscription started" });
    expect(row()).toMatchObject({
      status: "active",
      stripe_subscription_id: "sub_1",
      stripe_customer_id: "cus_1",
    });
  });

  it("waits for an unpaid session and expires an abandoned one", async () => {
    await run(ev("checkout.session.completed", session({ payment_status: "unpaid" })));
    expect(row().status).toBe("incomplete");
    mem.rows.set("row-1", { ...ROW });
    await run(
      ev("checkout.session.expired", session({ subscription: null, payment_status: "unpaid" })),
    );
    expect(row().status).toBe("expired");
  });

  it.each([
    ["another account", {}, { account: "acct_mallory" }],
    ["another amount", { amount_total: 100 }, {}],
    ["another currency", { currency: "eur" }, {}],
    ["a one-off payment", { mode: "payment" }, {}],
    ["another session", { id: "cs_test_other" }, {}],
  ])("flags %s for review and grants nothing", async (_label, sessionOver, eventOver) => {
    const r = await run(ev("checkout.session.completed", session(sessionOver), eventOver));
    expect(r.detail).toBe("needs_review");
    expect(row()).toMatchObject({ status: "incomplete", needs_review: true });
  });

  it("ignores live-mode events until live payments are approved", async () => {
    const r = await run(ev("checkout.session.completed", session(), { livemode: true }));
    expect(r.outcome).toBe("ignored");
    expect(mem.events.size).toBe(0);
    expect(row().status).toBe("incomplete");
  });

  it("flags a live-mode event for a test-mode row once live is approved", async () => {
    const r = await run(ev("checkout.session.completed", session(), { livemode: true }), true);
    expect(r.detail).toBe("needs_review");
  });
});

describe("subscription events", () => {
  it("records the status, period end and a cancellation", async () => {
    await run(ev("customer.subscription.created", subscription()));
    expect(row()).toMatchObject({
      status: "active",
      stripe_subscription_id: "sub_1",
      current_period_end: new Date(1_802_592_000 * 1000).toISOString(),
      cancel_at_period_end: false,
    });
    await run(ev("customer.subscription.updated", subscription({ cancel_at_period_end: true })));
    expect(row()).toMatchObject({ status: "active", cancel_at_period_end: true });
    await run(
      ev(
        "customer.subscription.deleted",
        subscription({ status: "canceled", ended_at: 1_802_592_000 }),
      ),
    );
    expect(row()).toMatchObject({
      status: "canceled",
      canceled_at: new Date(1_802_592_000 * 1000).toISOString(),
    });
  });

  it("finds the row by subscription id when metadata is missing", async () => {
    mem.rows.set("row-1", { ...ROW, stripe_subscription_id: "sub_1", status: "active" });
    await run(
      ev("customer.subscription.updated", subscription({ status: "past_due", metadata: {} })),
    );
    expect(row().status).toBe("past_due");
  });

  it("leaves subscriptions that aren't Yooits.me's alone", async () => {
    const r = await run(
      ev("customer.subscription.updated", subscription({ id: "sub_x", metadata: {} })),
    );
    expect(r.detail).toBe("not a Yooits.me creator subscription");
  });

  it("doesn't let an older event delivered late undo a newer one", async () => {
    const newer = ev("customer.subscription.updated", subscription({ status: "canceled" }));
    const older = ev("customer.subscription.updated", subscription({ status: "active" }), {
      created: (newer.created ?? 0) - 100,
    });
    await run(newer);
    const r = await run(older);
    expect(r.detail).toBe("older than the newest event applied");
    expect(row().status).toBe("canceled");
  });

  it("flags a subscription whose price isn't the one checkout set", async () => {
    mem.rows.set("row-1", { ...ROW, stripe_subscription_id: "sub_1", status: "active" });
    const cheap = subscription({
      items: {
        data: [
          { quantity: 1, current_period_end: 1, price: { unit_amount: 100, currency: "usd" } },
        ],
      },
    });
    const r = await run(ev("customer.subscription.updated", cheap));
    expect(r.detail).toBe("needs_review");
    // It loses access.
    expect(row()).toMatchObject({ status: "incomplete", needs_review: true });
    // And a later normal event doesn't give it back while it waits for review.
    await run(ev("customer.subscription.updated", subscription()));
    expect(row().status).toBe("incomplete");
  });

  it("reads the period from the subscription on older API versions", async () => {
    const items = subscription().items.data.map(({ current_period_end: _drop, ...rest }) => rest);
    await run(
      ev(
        "customer.subscription.updated",
        subscription({ items: { data: items }, current_period_end: 1_900_000_000 }),
      ),
    );
    expect(row().current_period_end).toBe(new Date(1_900_000_000 * 1000).toISOString());
  });
});

describe("idempotency", () => {
  it("handles each event once", async () => {
    const e = ev("checkout.session.completed", session());
    expect((await run(e)).outcome).toBe("processed");
    expect((await run(e)).outcome).toBe("duplicate");
  });

  it("asks Stripe to retry while another delivery holds the event", async () => {
    const e = ev("checkout.session.completed", session());
    await mem.store.claimEvent({ id: e.id, type: e.type, account: "acct_alice", livemode: false });
    await expect(run(e)).rejects.toBeInstanceOf(SubscriptionRetryLaterError);
  });

  it("releases the claim when handling fails, so the retry can run", async () => {
    const e = ev("checkout.session.completed", session());
    mem.store.failNextUpdate = true;
    await expect(run(e)).rejects.toThrow("database down");
    expect((await run(e)).outcome).toBe("processed");
    expect(row().status).toBe("active");
  });
});
