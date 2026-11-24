import type Stripe from "stripe";
import { TIP_CURRENCY, type TipQuote } from "./money";

/**
 * Stripe Checkout parameters for one tip, created as a DIRECT charge on the
 * creator's connected account (the request is sent with the Stripe-Account
 * header). Visitor pays tip + fee; the fee is taken as Yooits.me's application
 * fee, so the creator's balance receives the tip minus Stripe's processing fee.
 */
export function buildTipCheckoutParams(opts: {
  tipId: string;
  creatorUserId: string;
  handle: string;
  quote: TipQuote;
  baseUrl: string;
  now?: number;
}): Stripe.Checkout.SessionCreateParams {
  const { tipId, creatorUserId, handle, quote, baseUrl } = opts;
  const now = opts.now ?? Date.now();
  return {
    mode: "payment",
    submit_type: "pay",
    client_reference_id: tipId,
    // Checkout's minimum expiry is 30 minutes.
    expires_at: Math.floor(now / 1000) + 30 * 60 + 60,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: TIP_CURRENCY,
          unit_amount: quote.tipCents,
          product_data: { name: `Tip for @${handle}` },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: TIP_CURRENCY,
          unit_amount: quote.feeCents,
          product_data: {
            name: "Yooits.me service fee",
            description: "A flat fee for Yooits.me. It doesn't come out of the tip.",
          },
        },
      },
    ],
    payment_intent_data: {
      application_fee_amount: quote.feeCents,
      description: `Tip for @${handle} via Yooits.me`,
      metadata: { yooits_tip_id: tipId },
    },
    metadata: { yooits_tip_id: tipId, yooits_creator_user_id: creatorUserId },
    success_url: `${baseUrl}/${handle}/tip?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/${handle}/tip?status=cancelled`,
  };
}
