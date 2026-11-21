import { createFileRoute } from "@tanstack/react-router";
import { getTippingConfig, TippingUnavailableError } from "@/lib/tipping/config.server";
import { getStripe } from "@/lib/tipping/stripe.server";
import { verifyStripeWebhook } from "@/lib/tipping/verify-webhook";
import { supabaseTippingStore } from "@/lib/tipping/store.server";
import { handleStripeEvent, RetryLaterError } from "@/lib/tipping/webhook-handler";

/**
 * Stripe webhook endpoint for both the platform endpoint and the
 * "connected accounts" endpoint. Each endpoint has its own signing secret
 * (STRIPE_WEBHOOK_SECRET and STRIPE_CONNECT_WEBHOOK_SECRET); a request is
 * accepted if it verifies against either.
 */
export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let cfg;
        try {
          cfg = getTippingConfig();
        } catch (e) {
          if (e instanceof TippingUnavailableError)
            return new Response("disabled", { status: 503 });
          throw e;
        }
        if (cfg.webhookSecrets.length === 0) return new Response("not configured", { status: 503 });

        const signature = request.headers.get("stripe-signature");
        if (!signature) return new Response("missing signature", { status: 400 });
        const body = await request.text(); // raw body is required for verification

        const stripe = getStripe();
        const event = await verifyStripeWebhook(stripe, body, signature, cfg.webhookSecrets);
        if (!event) return new Response("invalid signature", { status: 400 });

        try {
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
              log: (msg, extra) => console.log(`[stripe-webhook] ${msg}`, extra ?? {}),
            },
          );
          return Response.json({ received: true, outcome: result.outcome });
        } catch (e) {
          // 500 makes Stripe retry with backoff; the event isn't marked processed.
          const retry = e instanceof RetryLaterError;
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
