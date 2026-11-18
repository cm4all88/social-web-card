/**
 * Stripe webhook event processing for tips, independent of HTTP and storage so
 * it can be unit-tested. Signature verification happens before this is called
 * (see src/routes/api/stripe/webhook.ts).
 *
 * Idempotency, in two layers:
 *  1. Every event id is recorded; an event already marked processed is skipped.
 *  2. Every state change is itself idempotent (it sets absolute values taken
 *     from Stripe, or only moves a tip forward from `pending`), so a duplicate
 *     or concurrent delivery cannot double-count anything.
 *
 * Out-of-order delivery: if an event refers to a tip we can't match yet
 * (e.g. a refund arrives before checkout.session.completed was processed), we
 * throw RetryLaterError so the route answers 500 and Stripe redelivers later.
 */
import { snapshotAccount, type AccountSnapshot, type StripeAccountLike } from "./account-status";
import { TIP_CURRENCY } from "./money";

export class RetryLaterError extends Error {}

export type TipRow = {
  id: string;
  creator_user_id: string;
  stripe_account_id: string;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  charge_id: string | null;
  tip_amount_cents: number;
  platform_fee_cents: number;
  total_cents: number;
  status: "pending" | "succeeded" | "failed" | "expired" | "needs_review";
  amount_refunded_cents: number;
  platform_fee_refunded_cents: number;
  dispute_status: string | null;
  livemode: boolean;
};

export type TipPatch = Partial<
  Pick<
    TipRow,
    | "payment_intent_id"
    | "charge_id"
    | "status"
    | "amount_refunded_cents"
    | "platform_fee_refunded_cents"
    | "dispute_status"
  >
> & { dispute_amount_cents?: number | null; paid_at?: string };

export interface TippingStore {
  /** Record the event. Returns "duplicate" if it was already fully processed. */
  claimEvent(e: {
    id: string;
    type: string;
    account: string | null;
    livemode: boolean;
  }): Promise<"new" | "duplicate">;
  markEventProcessed(id: string): Promise<void>;
  getTipById(id: string): Promise<TipRow | null>;
  getTipByPaymentIntent(paymentIntentId: string): Promise<TipRow | null>;
  getTipByChargeId(chargeId: string): Promise<TipRow | null>;
  updateTip(id: string, patch: TipPatch): Promise<void>;
  /** Update the stored connected account by Stripe id. No-op if unknown. */
  updateAccount(
    stripeAccountId: string,
    patch: Partial<AccountSnapshot> | { status: "disconnected" },
  ): Promise<void>;
  getAccountStatus(stripeAccountId: string): Promise<string | null>;
}

export type HandlerDeps = {
  store: TippingStore;
  /** True only when live payments have been explicitly approved. */
  liveModeAllowed: boolean;
  /** Optional: look up the charge id for a PaymentIntent on a connected account. */
  fetchLatestChargeId?: (
    paymentIntentId: string,
    stripeAccountId: string,
  ) => Promise<string | null>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

/** The subset of Stripe.Event this handler needs. */
export type StripeEventLike = {
  id: string;
  type: string;
  account?: string | null;
  livemode: boolean;
  data: { object: Record<string, unknown> };
};

export type HandleResult = { outcome: "processed" | "duplicate" | "ignored"; detail?: string };

export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.succeeded",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
  "application_fee.refunded",
  "account.updated",
  "account.application.deauthorized",
] as const;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const idOf = (v: unknown): string | null =>
  str(v) ?? (v && typeof v === "object" && "id" in v ? str((v as { id: unknown }).id) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function handleStripeEvent(
  event: StripeEventLike,
  deps: HandlerDeps,
): Promise<HandleResult> {
  const log = deps.log ?? (() => {});

  if (event.livemode && !deps.liveModeAllowed) {
    log("ignoring live-mode event; live payments are not approved", {
      id: event.id,
      type: event.type,
    });
    return { outcome: "ignored", detail: "livemode not approved" };
  }
  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(event.type)) {
    return { outcome: "ignored", detail: "unhandled type" };
  }

  const claim = await deps.store.claimEvent({
    id: event.id,
    type: event.type,
    account: event.account ?? null,
    livemode: event.livemode,
  });
  if (claim === "duplicate") return { outcome: "duplicate" };

  const detail = await dispatch(event, deps);
  await deps.store.markEventProcessed(event.id);
  return { outcome: "processed", detail };
}

async function dispatch(event: StripeEventLike, deps: HandlerDeps): Promise<string> {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return onSessionPaidOrCompleted(event, obj, deps);
    case "checkout.session.async_payment_failed":
      return onSessionClosed(obj, "failed", deps);
    case "checkout.session.expired":
      return onSessionClosed(obj, "expired", deps);
    case "charge.succeeded":
      return onChargeSucceeded(event, obj, deps);
    case "charge.refunded":
      return onChargeRefunded(event, obj, deps);
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
    case "charge.dispute.funds_withdrawn":
    case "charge.dispute.funds_reinstated":
      return onDispute(event, obj, deps);
    case "application_fee.refunded":
      return onApplicationFeeRefunded(obj, deps);
    case "account.updated":
      return onAccountUpdated(obj as unknown as StripeAccountLike, deps);
    case "account.application.deauthorized":
      if (event.account) await deps.store.updateAccount(event.account, { status: "disconnected" });
      return "account disconnected";
    default:
      return "unhandled";
  }
}

async function findTipForSession(
  obj: Record<string, unknown>,
  deps: HandlerDeps,
): Promise<TipRow | null> {
  const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
  const tipId = str(metadata.yooits_tip_id);
  if (!tipId) return null;
  return deps.store.getTipById(tipId);
}

async function onSessionPaidOrCompleted(
  event: StripeEventLike,
  session: Record<string, unknown>,
  deps: HandlerDeps,
): Promise<string> {
  const tip = await findTipForSession(session, deps);
  if (!tip) return "not a Yooits tip session";

  const sessionId = str(session.id);
  const paymentIntentId = idOf(session.payment_intent);
  const amountTotal = num(session.amount_total);
  const currency = str(session.currency);
  const paymentStatus = str(session.payment_status);

  // Everything Stripe reports must match what our server created.
  const mismatch =
    event.account !== tip.stripe_account_id ||
    (tip.checkout_session_id !== null && sessionId !== tip.checkout_session_id) ||
    amountTotal !== tip.total_cents ||
    currency !== TIP_CURRENCY ||
    event.livemode !== tip.livemode;

  if (mismatch) {
    deps.log?.("tip session mismatch; flagged for review", { tip: tip.id, event: event.id });
    if (tip.status === "pending" || tip.status === "expired") {
      await deps.store.updateTip(tip.id, {
        status: "needs_review",
        payment_intent_id: paymentIntentId,
      });
    }
    return "needs_review";
  }

  if (paymentStatus !== "paid") {
    // Delayed payment methods: wait for async_payment_succeeded/failed.
    if (paymentIntentId && !tip.payment_intent_id) {
      await deps.store.updateTip(tip.id, { payment_intent_id: paymentIntentId });
    }
    return "awaiting payment";
  }

  if (tip.status === "succeeded") return "already succeeded";
  if (tip.status === "failed" || tip.status === "needs_review") {
    // Never silently overwrite a terminal or flagged state.
    await deps.store.updateTip(tip.id, {
      status: "needs_review",
      payment_intent_id: paymentIntentId,
    });
    return "needs_review";
  }

  let chargeId = tip.charge_id;
  if (!chargeId && paymentIntentId && deps.fetchLatestChargeId) {
    try {
      chargeId = await deps.fetchLatestChargeId(paymentIntentId, tip.stripe_account_id);
    } catch {
      chargeId = null; // charge.succeeded / charge.refunded will fill it in.
    }
  }

  await deps.store.updateTip(tip.id, {
    status: "succeeded",
    payment_intent_id: paymentIntentId,
    ...(chargeId ? { charge_id: chargeId } : {}),
    paid_at: new Date().toISOString(),
  });
  return "succeeded";
}

async function onSessionClosed(
  session: Record<string, unknown>,
  status: "failed" | "expired",
  deps: HandlerDeps,
): Promise<string> {
  const tip = await findTipForSession(session, deps);
  if (!tip) return "not a Yooits tip session";
  if (tip.status !== "pending") return `left as ${tip.status}`;
  await deps.store.updateTip(tip.id, { status });
  return status;
}

async function tipForPaymentIntent(
  paymentIntentId: string | null,
  event: StripeEventLike,
  deps: HandlerDeps,
): Promise<TipRow | null> {
  if (!paymentIntentId) return null;
  const tip = await deps.store.getTipByPaymentIntent(paymentIntentId);
  if (tip) {
    if (event.account && event.account !== tip.stripe_account_id) return null;
    return tip;
  }
  return null;
}

/** Charges on a connected account that might belong to a tip we haven't linked yet. */
async function isPossiblyOurs(
  event: StripeEventLike,
  obj: Record<string, unknown>,
  deps: HandlerDeps,
) {
  if (!event.account) return false;
  const known = await deps.store.getAccountStatus(event.account);
  if (!known) return false;
  // Charges created by our Checkout sessions carry the platform's application fee.
  return obj.application_fee !== null && obj.application_fee !== undefined;
}

async function onChargeSucceeded(
  event: StripeEventLike,
  charge: Record<string, unknown>,
  deps: HandlerDeps,
) {
  const tip = await tipForPaymentIntent(idOf(charge.payment_intent), event, deps);
  const chargeId = str(charge.id);
  if (!tip) {
    // checkout.session.completed usually lands at about the same time; the
    // completed handler also looks the charge up, so no retry is needed here.
    return "no matching tip yet";
  }
  if (chargeId && tip.charge_id !== chargeId)
    await deps.store.updateTip(tip.id, { charge_id: chargeId });
  return "charge linked";
}

async function onChargeRefunded(
  event: StripeEventLike,
  charge: Record<string, unknown>,
  deps: HandlerDeps,
) {
  const tip = await tipForPaymentIntent(idOf(charge.payment_intent), event, deps);
  if (!tip) {
    if (await isPossiblyOurs(event, charge, deps))
      throw new RetryLaterError("refund before tip was linked");
    return "not a Yooits tip";
  }
  const refunded = num(charge.amount_refunded) ?? 0;
  await deps.store.updateTip(tip.id, {
    amount_refunded_cents: Math.max(refunded, tip.amount_refunded_cents),
    ...(str(charge.id) ? { charge_id: str(charge.id) } : {}),
  });
  return "refund recorded";
}

async function onDispute(
  event: StripeEventLike,
  dispute: Record<string, unknown>,
  deps: HandlerDeps,
) {
  const tip = await tipForPaymentIntent(idOf(dispute.payment_intent), event, deps);
  if (!tip) {
    const known = event.account ? await deps.store.getAccountStatus(event.account) : null;
    if (known) throw new RetryLaterError("dispute before tip was linked");
    return "not a Yooits tip";
  }
  await deps.store.updateTip(tip.id, {
    dispute_status: str(dispute.status) ?? "unknown",
    dispute_amount_cents: num(dispute.amount),
  });
  return "dispute recorded";
}

async function onApplicationFeeRefunded(fee: Record<string, unknown>, deps: HandlerDeps) {
  const chargeId = idOf(fee.charge);
  if (!chargeId) return "no charge on fee";
  const tip = await deps.store.getTipByChargeId(chargeId);
  if (!tip) {
    const acct = idOf(fee.account);
    if (acct && (await deps.store.getAccountStatus(acct)))
      throw new RetryLaterError("fee refund before charge linked");
    return "not a Yooits tip";
  }
  const refunded = num(fee.amount_refunded) ?? 0;
  await deps.store.updateTip(tip.id, {
    platform_fee_refunded_cents: Math.min(
      Math.max(refunded, tip.platform_fee_refunded_cents),
      tip.platform_fee_cents,
    ),
  });
  return "fee refund recorded";
}

async function onAccountUpdated(account: StripeAccountLike, deps: HandlerDeps) {
  if (!account?.id) return "no account id";
  const current = await deps.store.getAccountStatus(account.id);
  if (!current) return "unknown account";
  const snap = snapshotAccount(account);
  // A creator who disconnected in Yooits stays disconnected until they reconnect.
  const patch = current === "disconnected" ? { ...snap, status: undefined } : snap;
  if (patch.status === undefined) delete (patch as Partial<AccountSnapshot>).status;
  await deps.store.updateAccount(account.id, patch);
  return `account ${current === "disconnected" ? "disconnected (flags refreshed)" : snap.status}`;
}
