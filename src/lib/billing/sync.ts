/**
 * Stripe Billing webhook handling for Yooits Plus, independent of HTTP and
 * storage so it can be unit-tested. Signature verification happens first
 * (src/routes/api/stripe/billing-webhook.ts).
 *
 * Order-independent and idempotent: whatever the event, the subscription is
 * read fresh from Stripe and stored as Stripe has it now (absolute values),
 * so a late, repeated or out-of-order delivery can't leave a wrong state.
 * Each event is also claimed once in stripe_events, under a "plus:" prefix so
 * the tipping webhook's claims never collide with these.
 */
import {
  isSubscriptionStatus,
  PLUS_METADATA_KEY,
  PLUS_METADATA_VALUE,
  PLUS_PRICE_LOOKUP_KEY,
  type SubscriptionStatus,
} from "./plus";

export type PlusSubscriptionRow = {
  stripe_subscription_id: string;
  user_id: string | null;
  stripe_customer_id: string;
  status: SubscriptionStatus;
  price_id: string | null;
  unit_amount_cents: number | null;
  currency: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  livemode: boolean;
};

type PriceLike = {
  id: string;
  unit_amount?: number | null;
  currency?: string | null;
  lookup_key?: string | null;
  metadata?: Record<string, string> | null;
};

export type StripeSubscriptionLike = {
  id: string;
  customer: string | { id: string };
  status: string;
  livemode: boolean;
  metadata?: Record<string, string> | null;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  canceled_at?: number | null;
  ended_at?: number | null;
  trial_end?: number | null;
  current_period_end?: number | null; // older API versions
  items?: { data: { price: PriceLike; current_period_end?: number | null }[] } | null;
};

export type BillingEventLike = {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
};

export interface BillingStore {
  claimEvent(e: { id: string; type: string; livemode: boolean }): Promise<"claimed" | "duplicate" | "in_progress">;
  markEventProcessed(id: string): Promise<void>;
  releaseEvent(id: string): Promise<void>;
  /** The Yooits account a Stripe customer belongs to, if we created it. */
  userForCustomer(customerId: string): Promise<string | null>;
  userExists(userId: string): Promise<boolean>;
  linkCustomer(customerId: string, userId: string, livemode: boolean): Promise<void>;
  upsertSubscription(row: PlusSubscriptionRow): Promise<void>;
}

export type BillingDeps = {
  store: BillingStore;
  liveModeAllowed: boolean;
  /** Price id configured for Plus, if any (otherwise the lookup key decides). */
  plusPriceId: string | null;
  retrieveSubscription(id: string): Promise<StripeSubscriptionLike>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

export class BillingRetryLaterError extends Error {}

export type BillingOutcome =
  | "duplicate"
  | "in_progress"
  | "ignored"
  | "not_plus"
  | "live_not_approved"
  | "unknown_customer"
  | "customer_mismatch"
  | "synced";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (s: number | null | undefined) => (typeof s === "number" && s > 0 ? new Date(s * 1000).toISOString() : null);
const idOf = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;

export const SUBSCRIPTION_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

/** Which subscription an event is about, or null when it isn't one of ours to read. */
export function subscriptionIdFromEvent(e: BillingEventLike): string | null {
  const o = e.data.object;
  if (e.type === "checkout.session.completed") {
    if (o.mode !== "subscription") return null;
    const md = (o.metadata ?? {}) as Record<string, string>;
    if (md[PLUS_METADATA_KEY] !== PLUS_METADATA_VALUE) return null;
    return idOf(o.subscription);
  }
  if (e.type.startsWith("customer.subscription.")) return idOf(o.id);
  if (e.type.startsWith("invoice.")) {
    const parent = o.parent as { subscription_details?: { subscription?: unknown } } | null | undefined;
    return idOf(parent?.subscription_details?.subscription) ?? idOf(o.subscription);
  }
  return null;
}

/** True when the subscription is Yooits Plus (our metadata, lookup key or configured price). */
export function isPlusSubscription(sub: StripeSubscriptionLike, plusPriceId: string | null): boolean {
  if (sub.metadata?.[PLUS_METADATA_KEY] === PLUS_METADATA_VALUE) return true;
  return (sub.items?.data ?? []).some(
    (i) => i.price.lookup_key === PLUS_PRICE_LOOKUP_KEY || (!!plusPriceId && i.price.id === plusPriceId),
  );
}

export function subscriptionToRow(sub: StripeSubscriptionLike, userId: string | null): PlusSubscriptionRow {
  const item = sub.items?.data?.[0];
  if (!isSubscriptionStatus(sub.status)) throw new Error(`unknown subscription status ${sub.status}`);
  const customer = idOf(sub.customer);
  if (!customer) throw new Error("subscription without customer");
  return {
    stripe_subscription_id: sub.id,
    user_id: userId,
    stripe_customer_id: customer,
    status: sub.status,
    price_id: item?.price.id ?? null,
    unit_amount_cents: item?.price.unit_amount ?? null,
    currency: item?.price.currency ?? null,
    current_period_end: iso(item?.current_period_end ?? sub.current_period_end),
    trial_end: iso(sub.trial_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    cancel_at: iso(sub.cancel_at),
    canceled_at: iso(sub.canceled_at),
    ended_at: iso(sub.ended_at),
    livemode: sub.livemode,
  };
}

export async function handleBillingEvent(e: BillingEventLike, deps: BillingDeps): Promise<{ outcome: BillingOutcome }> {
  const log = deps.log ?? (() => {});
  const subId = subscriptionIdFromEvent(e);
  if (!subId) return { outcome: "ignored" };
  if (e.livemode && !deps.liveModeAllowed) {
    log("live event while live billing isn't approved; ignored", { event: e.id });
    return { outcome: "live_not_approved" };
  }

  const claimId = `plus:${e.id}`;
  const claim = await deps.store.claimEvent({ id: claimId, type: e.type, livemode: e.livemode });
  if (claim === "duplicate") return { outcome: "duplicate" };
  if (claim === "in_progress") throw new BillingRetryLaterError("event in progress elsewhere");

  try {
    const outcome = await sync(subId, deps, log);
    await deps.store.markEventProcessed(claimId);
    return { outcome };
  } catch (err) {
    await deps.store.releaseEvent(claimId).catch(() => {});
    throw err;
  }
}

async function sync(subId: string, deps: BillingDeps, log: NonNullable<BillingDeps["log"]>): Promise<BillingOutcome> {
  const sub = await deps.retrieveSubscription(subId);
  if (!isPlusSubscription(sub, deps.plusPriceId)) return "not_plus";
  if (sub.livemode && !deps.liveModeAllowed) return "live_not_approved";

  const customer = idOf(sub.customer)!;
  const fromMeta = sub.metadata?.user_id && UUID.test(sub.metadata.user_id) ? sub.metadata.user_id.toLowerCase() : null;
  const fromCustomer = await deps.store.userForCustomer(customer);
  if (fromMeta && fromCustomer && fromMeta !== fromCustomer) {
    // Never move Plus between accounts on the word of metadata alone.
    log("subscription metadata and customer disagree; not stored", { subscription: sub.id });
    return "customer_mismatch";
  }
  let userId = fromCustomer ?? fromMeta;
  if (!userId) {
    log("subscription for a customer Yooits didn't create; not stored", { subscription: sub.id });
    return "unknown_customer";
  }
  if (!(await deps.store.userExists(userId))) {
    // The account was deleted: keep the payment record, attached to no one.
    userId = null;
  } else if (!fromCustomer) {
    await deps.store.linkCustomer(customer, userId, sub.livemode);
  }
  await deps.store.upsertSubscription(subscriptionToRow(sub, userId));
  return "synced";
}
