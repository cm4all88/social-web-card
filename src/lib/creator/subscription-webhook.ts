/**
 * Stripe webhook processing for creator subscriptions, independent of HTTP
 * and storage so it can be unit-tested. The route verifies the signature
 * first (src/routes/api/stripe/webhook.ts) and sends these events here.
 *
 * Creator subscriptions are direct charges on creators' connected accounts,
 * so every event that belongs here carries `account`. Platform events are
 * never claimed here: Yooits.me Plus uses the same event-claim table.
 *
 * Idempotency, as for tips:
 *  1. Every event is claimed atomically before it is handled (claim_stripe_event).
 *  2. Every change sets absolute values taken from Stripe, and a subscription
 *     event older than the newest one applied is skipped, so replays and late
 *     deliveries can't undo a newer state.
 *
 * Anything Stripe reports that doesn't match what the server created (the
 * account, the amount, the currency, the mode) marks the row needs_review and
 * never grants access.
 */
import { SUBSCRIPTION_CURRENCY } from "./subscription-checkout";

export class SubscriptionRetryLaterError extends Error {}

export type CreatorSubStatus =
  "incomplete" | "active" | "past_due" | "canceled" | "unpaid" | "expired";

export type CreatorSubRow = {
  id: string;
  subscriber_user_id: string | null;
  creator_user_id: string | null;
  stripe_account_id: string | null;
  checkout_session_id: string | null;
  stripe_subscription_id: string | null;
  status: CreatorSubStatus;
  livemode: boolean;
  total_cents: number | null;
  stripe_synced_at: string | null;
  needs_review: boolean;
};

export type CreatorSubPatch = Partial<{
  status: CreatorSubStatus;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  stripe_synced_at: string;
  needs_review: boolean;
}>;

export interface CreatorSubscriptionStore {
  claimEvent(e: {
    id: string;
    type: string;
    account: string | null;
    livemode: boolean;
  }): Promise<"claimed" | "duplicate" | "in_progress">;
  markEventProcessed(id: string): Promise<void>;
  releaseEvent(id: string): Promise<void>;
  getById(id: string): Promise<CreatorSubRow | null>;
  getByStripeSubscriptionId(id: string): Promise<CreatorSubRow | null>;
  update(id: string, patch: CreatorSubPatch): Promise<void>;
}

export type SubscriptionEventLike = {
  id: string;
  type: string;
  account?: string | null;
  livemode: boolean;
  /** Seconds since the epoch, as Stripe sends it. */
  created?: number;
  data: { object: Record<string, unknown> };
};

export type SubscriptionHandlerDeps = {
  store: CreatorSubscriptionStore;
  liveModeAllowed: boolean;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

export type SubscriptionHandleResult = {
  outcome: "processed" | "duplicate" | "ignored";
  detail?: string;
};

export const SUBSCRIPTION_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
] as const;

const META_KEY = "yooits_creator_subscription_id";

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const idOf = (v: unknown): string | null =>
  str(v) ?? (v && typeof v === "object" && "id" in v ? str((v as { id: unknown }).id) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const metaId = (obj: Record<string, unknown>) =>
  str(((obj.metadata ?? {}) as Record<string, unknown>)[META_KEY]);
const isoFromSeconds = (s: number | null) => (s === null ? null : new Date(s * 1000).toISOString());

/**
 * True for events this handler owns: subscription events on a connected
 * account, and checkout sessions on a connected account that a creator
 * subscription checkout created. Everything else goes to the tip handler.
 */
export function isCreatorSubscriptionEvent(event: SubscriptionEventLike): boolean {
  if (!event.account) return false;
  if (event.type.startsWith("customer.subscription.")) return true;
  if (event.type.startsWith("checkout.session.")) return metaId(event.data.object) !== null;
  return false;
}

/** Stripe's subscription status as ours. Only active and past_due give access. */
export function mapStripeSubscriptionStatus(status: string | null): CreatorSubStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "incomplete_expired":
      return "expired";
    case "unpaid":
    case "paused": // no access while paused
      return "unpaid";
    default:
      return "incomplete";
  }
}

const GRANTS_ACCESS: CreatorSubStatus[] = ["active", "past_due"];

export async function handleCreatorSubscriptionEvent(
  event: SubscriptionEventLike,
  deps: SubscriptionHandlerDeps,
): Promise<SubscriptionHandleResult> {
  const log = deps.log ?? (() => {});
  if (event.livemode && !deps.liveModeAllowed) {
    log("ignoring live-mode subscription event; live payments are not approved", {
      id: event.id,
      type: event.type,
    });
    return { outcome: "ignored", detail: "livemode not approved" };
  }
  if (!isCreatorSubscriptionEvent(event)) return { outcome: "ignored", detail: "not ours" };
  if (!(SUBSCRIPTION_EVENT_TYPES as readonly string[]).includes(event.type)) {
    return { outcome: "ignored", detail: "unhandled type" };
  }

  const claim = await deps.store.claimEvent({
    id: event.id,
    type: event.type,
    account: event.account ?? null,
    livemode: event.livemode,
  });
  if (claim === "duplicate") return { outcome: "duplicate" };
  if (claim === "in_progress")
    throw new SubscriptionRetryLaterError("event is being processed elsewhere");

  let detail: string;
  try {
    detail = await dispatch(event, deps);
  } catch (e) {
    await deps.store.releaseEvent(event.id).catch(() => {});
    throw e;
  }
  await deps.store.markEventProcessed(event.id);
  return { outcome: "processed", detail };
}

async function dispatch(event: SubscriptionEventLike, deps: SubscriptionHandlerDeps) {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return onSessionCompleted(event, obj, deps);
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return onSessionClosed(obj, deps);
    default:
      return onSubscription(event, obj, deps);
  }
}

async function flag(
  row: CreatorSubRow,
  deps: SubscriptionHandlerDeps,
  why: string,
  eventId: string,
) {
  deps.log?.("creator subscription mismatch; flagged for review", {
    row: row.id,
    event: eventId,
    why,
  });
  await deps.store.update(row.id, {
    needs_review: true,
    ...(GRANTS_ACCESS.includes(row.status) ? { status: "incomplete" as const } : {}),
  });
  return "needs_review";
}

async function onSessionCompleted(
  event: SubscriptionEventLike,
  session: Record<string, unknown>,
  deps: SubscriptionHandlerDeps,
) {
  const id = metaId(session);
  const row = id ? await deps.store.getById(id) : null;
  if (!row) return "unknown creator subscription";

  const sessionId = str(session.id);
  const subscriptionId = idOf(session.subscription);
  const mismatch =
    event.account !== row.stripe_account_id ||
    event.livemode !== row.livemode ||
    str(session.mode) !== "subscription" ||
    (row.checkout_session_id !== null && sessionId !== row.checkout_session_id) ||
    num(session.amount_total) !== row.total_cents ||
    str(session.currency) !== SUBSCRIPTION_CURRENCY ||
    (row.stripe_subscription_id !== null &&
      subscriptionId !== null &&
      subscriptionId !== row.stripe_subscription_id);
  if (mismatch) return flag(row, deps, "checkout session", event.id);

  const patch: CreatorSubPatch = {};
  if (subscriptionId && !row.stripe_subscription_id) patch.stripe_subscription_id = subscriptionId;
  const customerId = idOf(session.customer);
  if (customerId) patch.stripe_customer_id = customerId;
  // First payment in: access starts now. A subscription event may already
  // have moved the row on; never move it backwards or past a review flag.
  const paid = str(session.payment_status) === "paid";
  if (paid && row.status === "incomplete" && !row.needs_review) patch.status = "active";
  if (Object.keys(patch).length) await deps.store.update(row.id, patch);
  return paid ? "subscription started" : "awaiting payment";
}

async function onSessionClosed(session: Record<string, unknown>, deps: SubscriptionHandlerDeps) {
  const id = metaId(session);
  const row = id ? await deps.store.getById(id) : null;
  if (!row) return "unknown creator subscription";
  if (row.status !== "incomplete" || row.stripe_subscription_id) return `left as ${row.status}`;
  await deps.store.update(row.id, { status: "expired" });
  return "expired";
}

/** The subscription's monthly total from its items. */
function itemsTotal(sub: Record<string, unknown>): {
  total: number | null;
  periodEnd: number | null;
  currency: string | null;
} {
  const items = ((sub.items as { data?: unknown[] } | undefined)?.data ?? []) as Record<
    string,
    unknown
  >[];
  let total = 0;
  let periodEnd: number | null = null;
  let currency: string | null = str(sub.currency);
  for (const item of items) {
    const price = (item.price ?? {}) as Record<string, unknown>;
    const unit = num(price.unit_amount);
    const qty = num(item.quantity) ?? 1;
    if (unit === null) return { total: null, periodEnd, currency };
    total += unit * qty;
    currency = currency ?? str(price.currency);
    const end = num(item.current_period_end);
    if (end !== null) periodEnd = periodEnd === null ? end : Math.min(periodEnd, end);
  }
  // Older API versions put the period on the subscription itself.
  periodEnd = periodEnd ?? num(sub.current_period_end);
  return { total: items.length ? total : null, periodEnd, currency };
}

async function onSubscription(
  event: SubscriptionEventLike,
  sub: Record<string, unknown>,
  deps: SubscriptionHandlerDeps,
) {
  const subscriptionId = str(sub.id);
  const id = metaId(sub);
  let row = id ? await deps.store.getById(id) : null;
  if (!row && subscriptionId) row = await deps.store.getByStripeSubscriptionId(subscriptionId);
  if (!row) return "not a Yooits.me creator subscription";

  // A late delivery of an older event must not undo a newer state.
  const at = num(event.created);
  if (at !== null && row.stripe_synced_at && Date.parse(row.stripe_synced_at) > at * 1000) {
    return "older than the newest event applied";
  }

  const { total, periodEnd, currency } = itemsTotal(sub);
  const mismatch =
    event.account !== row.stripe_account_id ||
    event.livemode !== row.livemode ||
    (row.stripe_subscription_id !== null && subscriptionId !== row.stripe_subscription_id) ||
    total !== row.total_cents ||
    (currency !== null && currency !== SUBSCRIPTION_CURRENCY);
  if (mismatch) return flag(row, deps, "subscription", event.id);

  const status =
    event.type === "customer.subscription.deleted"
      ? ("canceled" as const)
      : mapStripeSubscriptionStatus(str(sub.status));
  const patch: CreatorSubPatch = {
    status: row.needs_review && GRANTS_ACCESS.includes(status) ? row.status : status,
    current_period_end: isoFromSeconds(periodEnd),
    cancel_at_period_end: sub.cancel_at_period_end === true || num(sub.cancel_at) !== null,
    canceled_at: isoFromSeconds(num(sub.canceled_at) ?? num(sub.ended_at)),
  };
  if (subscriptionId && !row.stripe_subscription_id) patch.stripe_subscription_id = subscriptionId;
  const customerId = idOf(sub.customer);
  if (customerId) patch.stripe_customer_id = customerId;
  if (at !== null) patch.stripe_synced_at = new Date(at * 1000).toISOString();
  await deps.store.update(row.id, patch);
  return `subscription ${patch.status}`;
}
