/**
 * Gift money toward a wishlist item. SWITCHED OFF and unusable until Stripe
 * agrees in writing (see supabase/migrations/20261122234000_wishlist_gift_money.sql).
 * Nothing in the UI uses this yet.
 *
 * Pure: turns the database's checkout gate (wishlist_gift_checkout_gate) and
 * an amount into a plan with server-side fee math, and builds the Stripe
 * Checkout parameters. The same direct-charge path as tips: the charge is
 * created on the list owner's connected account, which pays Stripe's fee, so
 * Yooits' application fee is what's left of the service fee after that.
 */
import type Stripe from "stripe";
import { creatorFeeBreakdown, parseFeeRates, type FeeBreakdown } from "@/lib/creator/fees";

export const GIFT_CURRENCY = "usd" as const;

export class GiftCheckoutError extends Error {}

const MESSAGES: Record<string, string> = {
  off: "Gift money isn't available.",
  sign_in: "Sign in to send a gift.",
  not_allowed: "Your account can't send gifts right now.",
  unavailable: "This list isn't taking gift money.",
  self: "This is your own list.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  amount: "Enter an amount within the allowed range.",
};

const fail = (reason: string): never => {
  throw new GiftCheckoutError(MESSAGES[reason] ?? MESSAGES.unavailable);
};

export type GiftCheckoutPlan = {
  recipientUserId: string;
  username: string;
  wishlistId: string;
  wishlistSlug: string;
  itemId: string;
  itemName: string;
  stripeAccountId: string;
  breakdown: FeeBreakdown;
  /** Yooits' application fee: the service fee less Stripe's estimated cut. */
  applicationFeeCents: number;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

export function planWishlistGiftCheckout(
  raw: unknown,
  amountCents: unknown,
  opts: { livemode: boolean },
): GiftCheckoutPlan {
  const g = (raw ?? {}) as Record<string, unknown>;
  if (g.ok !== true) fail(typeof g.reason === "string" ? g.reason : "unavailable");

  const account = (g.account ?? {}) as Record<string, unknown>;
  const stripeAccountId = str(account.stripe_account_id);
  if (!stripeAccountId || account.livemode !== opts.livemode) fail("unavailable");

  const min = int(g.amount_min_cents);
  const max = int(g.amount_max_cents);
  const amount = int(amountCents);
  if (min === null || max === null) fail("unavailable");
  if (amount === null || amount < min! || amount > max!) fail("amount");

  const breakdown = creatorFeeBreakdown(amount!, parseFeeRates(g.rates));
  if (!breakdown) fail("off");

  const ids = {
    recipientUserId: str(g.recipient_user_id),
    username: str(g.username),
    wishlistId: str(g.wishlist_id),
    wishlistSlug: str(g.wishlist_slug),
    itemId: str(g.item_id),
    itemName: str(g.item_name),
  };
  if (Object.values(ids).some((v) => v === null)) fail("unavailable");

  return {
    ...(ids as { [K in keyof typeof ids]: string }),
    stripeAccountId: stripeAccountId!,
    breakdown: breakdown!,
    applicationFeeCents: Math.max(0, breakdown!.yooitsNet),
  };
}

/** Stripe Checkout parameters for one gift, sent with the Stripe-Account header. */
export function buildGiftCheckoutParams(opts: {
  giftId: string;
  plan: GiftCheckoutPlan;
  baseUrl: string;
  now?: number;
}): Stripe.Checkout.SessionCreateParams {
  const { giftId, plan, baseUrl } = opts;
  const now = opts.now ?? Date.now();
  const back = `${baseUrl}/${plan.username}/wishlist/${plan.wishlistSlug}`;
  return {
    mode: "payment",
    submit_type: "pay",
    client_reference_id: giftId,
    expires_at: Math.floor(now / 1000) + 30 * 60 + 60,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: GIFT_CURRENCY,
          unit_amount: plan.breakdown.creatorPrice,
          product_data: { name: `Gift toward: ${plan.itemName}`.slice(0, 250) },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: GIFT_CURRENCY,
          unit_amount: plan.breakdown.serviceFee,
          product_data: {
            name: "Service and processing fee",
            description: "Covers Yooits and card processing.",
          },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: plan.applicationFeeCents,
      description: `Wishlist gift via Yooits`,
      metadata: { yooits_wishlist_gift_id: giftId },
    },
    metadata: { yooits_wishlist_gift_id: giftId, yooits_recipient_user_id: plan.recipientUserId },
    success_url: `${back}?gift=success`,
    cancel_url: `${back}?gift=cancelled`,
  };
}

// ---------------------------------------------------------------------------
// Webhook: checkout outcomes for gifts (checkout.session.* on connected accounts)
// ---------------------------------------------------------------------------

export type GiftRow = {
  id: string;
  stripe_account_id: string;
  total_cents: number;
  livemode: boolean;
  status: "pending" | "succeeded" | "failed" | "expired" | "needs_review";
};

export type GiftPatch = Partial<{
  status: GiftRow["status"];
  checkout_session_id: string;
  payment_intent_id: string | null;
  paid_at: string;
}>;

export interface GiftStore {
  getById(id: string): Promise<GiftRow | null>;
  update(id: string, patch: GiftPatch): Promise<void>;
}

export type GiftEventLike = {
  id: string;
  type: string;
  account?: string | null;
  livemode: boolean;
  data: { object: Record<string, unknown> };
};

const GIFT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

/** A checkout event that carries a wishlist gift id. */
export function isWishlistGiftEvent(e: GiftEventLike): boolean {
  if (!GIFT_EVENTS.has(e.type)) return false;
  const md = e.data.object.metadata as Record<string, unknown> | undefined;
  return typeof md?.yooits_wishlist_gift_id === "string";
}

/**
 * Applies one already-claimed, signature-verified event. Anything that doesn't
 * match what the server created marks the gift needs_review.
 */
export async function applyWishlistGiftEvent(
  e: GiftEventLike,
  deps: { store: GiftStore; liveModeAllowed: boolean },
): Promise<"updated" | "ignored" | "needs_review"> {
  const s = e.data.object;
  const giftId = (s.metadata as Record<string, unknown>).yooits_wishlist_gift_id as string;
  const gift = await deps.store.getById(giftId);
  if (!gift) return "ignored";
  if (gift.status === "succeeded" || gift.status === "needs_review") return "ignored";

  const mismatch =
    (e.livemode && !deps.liveModeAllowed) ||
    e.livemode !== gift.livemode ||
    e.account !== gift.stripe_account_id ||
    s.amount_total !== gift.total_cents ||
    s.currency !== GIFT_CURRENCY;
  if (mismatch) {
    await deps.store.update(gift.id, { status: "needs_review" });
    return "needs_review";
  }

  const pi = typeof s.payment_intent === "string" ? s.payment_intent : null;
  const sessionId = typeof s.id === "string" ? s.id : undefined;
  switch (e.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      if (s.payment_status !== "paid") return "ignored";
      await deps.store.update(gift.id, {
        status: "succeeded",
        checkout_session_id: sessionId,
        payment_intent_id: pi,
        paid_at: new Date().toISOString(),
      });
      return "updated";
    case "checkout.session.async_payment_failed":
      await deps.store.update(gift.id, { status: "failed" });
      return "updated";
    case "checkout.session.expired":
      if (gift.status !== "pending") return "ignored";
      await deps.store.update(gift.id, { status: "expired" });
      return "updated";
    default:
      return "ignored";
  }
}
