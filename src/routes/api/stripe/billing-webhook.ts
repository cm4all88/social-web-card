import { createFileRoute } from "@tanstack/react-router";
import { BillingUnavailableError, getBillingConfig } from "@/lib/billing/config.server";
import { getBillingStripe } from "@/lib/billing/stripe.server";
import { billingStore } from "@/lib/billing/store.server";
import { BillingRetryLaterError, handleBillingEvent } from "@/lib/billing/sync";
import { verifyStripeWebhook } from "@/lib/tipping/verify-webhook";

/**
 * Stripe webhook for Yooits Plus (Stripe Billing on Yooits' own account).
 * Its own endpoint and signing secret (STRIPE_BILLING_WEBHOOK_SECRET), apart
 * from the tipping webhook, so neither can affect the other.
 */
export const Route = createFileRoute("/api/stripe/billing-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let cfg;
        try {
          cfg = getBillingConfig();
        } catch (e) {
          if (e instanceof BillingUnavailableError) return new Response("disabled", { status: 503 });
          throw e;
        }
        if (!cfg.webhookSecret) return new Response("not configured", { status: 503 });
        const signature = request.headers.get("stripe-signature");
        if (!signature) return new Response("missing signature", { status: 400 });
        const body = await request.text(); // raw body is required for verification

        const stripe = getBillingStripe();
        const event = await verifyStripeWebhook(stripe, body, signature, [cfg.webhookSecret]);
        if (!event) return new Response("invalid signature", { status: 400 });
        // Connected-account events (creator tipping) never belong here.
        if ((event as { account?: string }).account) return Response.json({ received: true, outcome: "ignored" });

        try {
          const result = await handleBillingEvent(event as never, {
            store: billingStore(),
            liveModeAllowed: cfg.liveModeAllowed,
            plusPriceId: cfg.priceId,
            retrieveSubscription: (id) => stripe.subscriptions.retrieve(id) as never,
            log: (msg, extra) => console.log(`[plus-webhook] ${msg}`, extra ?? {}),
          });
          return Response.json({ received: true, outcome: result.outcome });
        } catch (e) {
          const retry = e instanceof BillingRetryLaterError;
          console.error(`[plus-webhook] ${retry ? "retry later" : "failed"}`, event.id, event.type, (e as Error)?.message);
          return new Response("retry", { status: 500 });
        }
      },
    },
  },
});
