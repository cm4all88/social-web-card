/**
 * Stripe Checkout parameters for a creator subscription. Pure functions, so
 * they can be unit-tested without Stripe.
 *
 * The subscription is created as a DIRECT charge on the creator's connected
 * account (the request carries the Stripe-Account header). That account pays
 * Stripe's processing fee, so the subscriber's total is grossed up to cover
 * it (creatorFeeBreakdown) and Yooits.me takes only its own share as the
 * application fee. The creator is left with the whole price they set.
 *
 * Checkout only takes a percentage application fee for subscriptions, with at
 * most two decimal places. The percentage is rounded down, so the fee Stripe
 * takes is never more than Yooits.me's share and the creator never gets less than
 * their price (Yooits.me may get up to a few cents less on large prices).
 */
import type Stripe from "stripe";
import type { FeeBreakdown } from "./fees";

export const SUBSCRIPTION_CURRENCY = "usd";

export type ApplicationFee = {
  /** What Checkout is told: a percent with at most two decimals. */
  percent: number;
  /** The fee in cents that percent gives on the total. */
  cents: number;
};

export function subscriptionApplicationFee(b: FeeBreakdown): ApplicationFee | null {
  if (b.total <= 0 || b.yooitsNet < 0) return null;
  // Hundredths of a percent, rounded down.
  const hundredths = Math.floor((b.yooitsNet * 10_000) / b.total);
  const cents = Math.round((b.total * hundredths) / 10_000);
  return { percent: hundredths / 100, cents };
}

export function buildCreatorSubscriptionCheckoutParams(opts: {
  rowId: string;
  creatorUserId: string;
  subscriberUserId: string;
  offerId: string;
  handle: string;
  displayName: string;
  breakdown: FeeBreakdown;
  fee: ApplicationFee;
  baseUrl: string;
  email?: string;
  now?: number;
}): Stripe.Checkout.SessionCreateParams {
  const { rowId, handle, breakdown, fee, baseUrl } = opts;
  const now = opts.now ?? Date.now();
  const metadata = {
    yooits_creator_subscription_id: rowId,
    yooits_creator_user_id: opts.creatorUserId,
    yooits_subscriber_user_id: opts.subscriberUserId,
    yooits_offer_id: opts.offerId,
  };
  const monthly = { interval: "month" as const, interval_count: 1 };
  return {
    mode: "subscription",
    client_reference_id: rowId,
    customer_email: opts.email,
    // Checkout's minimum expiry is 30 minutes.
    expires_at: Math.floor(now / 1000) + 30 * 60 + 60,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: SUBSCRIPTION_CURRENCY,
          unit_amount: breakdown.creatorPrice,
          recurring: monthly,
          product_data: {
            name: `Subscription to ${opts.displayName} (@${handle})`,
            description: "Monthly. The creator receives this whole amount.",
          },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: SUBSCRIPTION_CURRENCY,
          unit_amount: breakdown.serviceFee,
          recurring: monthly,
          product_data: {
            name: "Yooits.me service and processing fee",
            description:
              "Covers Yooits.me's fee and the card processing fee, so the creator gets their full price.",
          },
        },
      },
    ],
    subscription_data: {
      application_fee_percent: fee.percent,
      description: `Subscription to @${handle} via Yooits.me`,
      metadata,
    },
    metadata,
    success_url: `${baseUrl}/${handle}/subscribe?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/${handle}/subscribe?status=cancelled`,
  };
}
