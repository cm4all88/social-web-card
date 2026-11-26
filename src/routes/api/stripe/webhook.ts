import { applyProductEvent } from "@/lib/digital-products/store.server";
import { createFileRoute } from "@tanstack/react-router";
import {
  envWebhookSecrets,
  getTippingConfig,
  TippingUnavailableError,
} from "@/lib/tipping/config.server";
import { keyOnlyStripe, storedWebhookSecrets, stripeKey } from "@/lib/payments/setup.server";
import { getStripe } from "@/lib/tipping/stripe.server";
import { verifyStripeWebhook } from "@/lib/tipping/verify-webhook";
import { supabaseTippingStore } from "@/lib/tipping/store.server";
import { handleStripeEvent, RetryLaterError } from "@/lib/tipping/webhook-handler";
import { supabaseCreatorSubscriptionStore } from "@/lib/creator/subscription-store.server";
import {
  handleCreatorSubscriptionEvent,
  isCreatorSubscriptionEvent,
  SubscriptionRetryLaterError,
  type SubscriptionEventLike,
} from "@/lib/creator/subscription-webhook";
import {
  applyWishlistGiftEvent,
  isWishlistGiftEvent,
  type GiftEventLike,
} from "@/lib/wishlist-gifts";
import { supabaseGiftStore } from "@/lib/wishlist-gift-store.server";

/**
 * Stripe webhook endpoint for both the platform endpoint and the
 * "connected accounts" endpoint. Each endpoint has its own signing secret
 * (STRIPE_WEBHOOK_SECRET and STRIPE_CONNECT_WEBHOOK_SECRET, or the ones
 * Owner > Payments stored); a request is accepted if it verifies against any.
 * While tipping is off a verified event gets 200 and changes nothing.
 *
 * Creator subscription events (subscriptions and their checkouts on
 * connected accounts) go to the creator subscription handler; wishlist gift
 * checkouts (switched off) go to the gift handler; everything else goes to
 * the tip handler.
 */
export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Verify first, with the secrets in Vercel or the ones Owner > Payments
        // stored, so a Stripe endpoint stays healthy while payments are off.
        const key = stripeKey();
        if (!key) return new Response("not configured", { status: 503 });
        const secrets = [
          ...envWebhookSecrets(),
          ...(await storedWebhookSecrets(["payments_webhook", "connect_webhook"])),
        ];
        if (secrets.length === 0) return new Response("not configured", { status: 503 });

        const signature = request.headers.get("stripe-signature");
        if (!signature) return new Response("missing signature", { status: 400 });
        const body = await request.text(); // raw body is required for verification

        const event = await verifyStripeWebhook(keyOnlyStripe(key.key), body, signature, secrets);
        if (!event) return new Response("invalid signature", { status: 400 });

        let cfg;
        try {
          cfg = getTippingConfig();
        } catch (e) {
          // Payments are switched off (or this key isn't allowed): nothing to do.
          if (e instanceof TippingUnavailableError)
            return Response.json({ received: true, outcome: "payments_off" });
          throw e;
        }
        const stripe = getStripe();

        const log = (msg: string, extra?: Record<string, unknown>) =>
          console.log(`[stripe-webhook] ${msg}`, extra ?? {});
        try {
          if (await applyProductEvent(event)) {
            return Response.json({ received: true, outcome: "digital_product" });
          }
          const giftEvent = event as unknown as GiftEventLike;
          if (isWishlistGiftEvent(giftEvent)) {
            const claim = await supabaseTippingStore.claimEvent({
              id: event.id,
              type: event.type,
              account: giftEvent.account ?? null,
              livemode: event.livemode,
            });
            if (claim === "duplicate")
              return Response.json({ received: true, outcome: "duplicate" });
            if (claim === "in_progress") return new Response("retry", { status: 500 });
            try {
              const outcome = await applyWishlistGiftEvent(giftEvent, {
                store: supabaseGiftStore,
                liveModeAllowed: cfg.liveModeAllowed,
              });
              await supabaseTippingStore.markEventProcessed(event.id);
              log("wishlist gift", { id: event.id, outcome });
              return Response.json({ received: true, outcome });
            } catch (err) {
              await supabaseTippingStore.releaseEvent(event.id);
              throw err;
            }
          }
          const subEvent = event as unknown as SubscriptionEventLike;
          if (isCreatorSubscriptionEvent(subEvent)) {
            const result = await handleCreatorSubscriptionEvent(subEvent, {
              store: supabaseCreatorSubscriptionStore,
              liveModeAllowed: cfg.liveModeAllowed,
              log,
            });
            return Response.json({ received: true, outcome: result.outcome });
          }
          const result = await handleStripeEvent(
            event as unknown as Parameters<typeof handleStripeEvent>[0],
            {
              store: supabaseTippingStore,
              liveModeAllowed: cfg.liveModeAllowed,
              fetchLatestCharge: async (pi, account) => {
                const intent = await stripe.paymentIntents.retrieve(
                  pi,
                  { expand: ["latest_charge"] },
                  { stripeAccount: account },
                );
                const latest = intent.latest_charge;
                if (!latest) return null;
                if (typeof latest === "string")
                  return { chargeId: latest, applicationFeeId: null, applicationFeeCents: null };
                const fee = latest.application_fee;
                return {
                  chargeId: latest.id,
                  applicationFeeId: typeof fee === "string" ? fee : (fee?.id ?? null),
                  applicationFeeCents: latest.application_fee_amount ?? null,
                };
              },
              log,
            },
          );
          return Response.json({ received: true, outcome: result.outcome });
        } catch (e) {
          // 500 makes Stripe retry with backoff; the event isn't marked processed.
          const retry = e instanceof RetryLaterError || e instanceof SubscriptionRetryLaterError;
          console.error(
            `[stripe-webhook] ${retry ? "retry later" : "failed"}`,
            event.id,
            event.type,
            (e as Error)?.message,
          );
          return new Response("retry", { status: 500 });
        }
      },
    },
  },
});
