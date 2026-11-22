/**
 * Server functions for creator subscription checkout. Handlers run only on
 * the server; the browser gets RPC stubs. Prices, fees, accounts and
 * eligibility all come from the database (creator_subscription_checkout_gate)
 * and are worked out here, never taken from the browser.
 *
 * Switched off three ways: the owner's checkout switch
 * (creator_subscription_settings.checkout_enabled, false), the server's
 * Stripe Connect settings (TIPPING_ENABLED and a Stripe key), and live keys
 * until live payments are approved. No page shows a subscribe button yet.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTippingConfig, isLiveKey, TippingUnavailableError } from "@/lib/tipping/config.server";
import { getStripe } from "@/lib/tipping/stripe.server";
import { buildCreatorSubscriptionCheckoutParams } from "./subscription-checkout";
import { planCreatorSubscriptionCheckout, SubscriptionCheckoutError } from "./subscription-plan";

const GENERIC = "Something went wrong. Please try again.";

function publicError(e: unknown): never {
  if (e instanceof TippingUnavailableError) throw new Error("Subscriptions aren't available yet.");
  if (e instanceof SubscriptionCheckoutError) throw new Error(e.message);
  console.error("[creator-subscriptions]", e instanceof Error ? e.message : e);
  throw new Error(GENERIC);
}

// The generated database types don't include these yet.
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  from: (t: string) => any;
  rpc: (f: string, a: object) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const authed = [attachSupabaseAuth, requireSupabaseAuth] as const;

export const createCreatorSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([...authed])
  .inputValidator(
    z.object({
      username: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9._-]{1,30}$/),
      // The subscriber confirms they are 18 or older, every time.
      adultConfirmed: z.literal(true),
    }),
  )
  .handler(async ({ context, data }) => {
    try {
      const cfg = getTippingConfig();
      const livemode = isLiveKey(cfg.secretKey);
      const { data: gate, error } = await db.rpc("creator_subscription_checkout_gate", {
        _subscriber: context.userId,
        _username: data.username,
      });
      if (error) throw error;
      const plan = planCreatorSubscriptionCheckout(gate, { livemode });

      const { data: row, error: insertErr } = await db
        .from("creator_subscriptions")
        .insert({
          subscriber_user_id: context.userId,
          creator_user_id: plan.creatorUserId,
          offer_id: plan.offerId,
          status: "incomplete",
          livemode,
          price_cents: plan.breakdown.creatorPrice,
          fee_cents: plan.breakdown.serviceFee,
          total_cents: plan.breakdown.total,
          application_fee_cents: plan.fee.cents,
          application_fee_percent: plan.fee.percent,
          stripe_account_id: plan.stripeAccountId,
          adult_confirmed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (insertErr || !row) throw insertErr ?? new Error("subscription insert failed");

      const base = cfg.siteUrl ?? new URL(getRequest().url).origin;
      const email = typeof context.claims.email === "string" ? context.claims.email : undefined;
      let session;
      try {
        session = await getStripe().checkout.sessions.create(
          buildCreatorSubscriptionCheckoutParams({
            rowId: row.id,
            creatorUserId: plan.creatorUserId,
            subscriberUserId: context.userId,
            offerId: plan.offerId,
            handle: plan.username,
            displayName: plan.displayName,
            breakdown: plan.breakdown,
            fee: plan.fee,
            baseUrl: base,
            email,
          }),
          { stripeAccount: plan.stripeAccountId, idempotencyKey: `yooits-creator-sub-${row.id}` },
        );
      } catch (e) {
        await db.from("creator_subscriptions").update({ status: "expired" }).eq("id", row.id);
        throw e;
      }
      await db
        .from("creator_subscriptions")
        .update({ checkout_session_id: session.id })
        .eq("id", row.id);
      if (!session.url) throw new Error("checkout session has no url");
      return { url: session.url };
    } catch (e) {
      publicError(e);
    }
  });

/** The subscriber cancels: access lasts until the end of the period they paid for. */
export const cancelMyCreatorSubscription = createServerFn({ method: "POST" })
  .middleware([...authed])
  .inputValidator(z.object({ subscriptionId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    try {
      getTippingConfig();
      const { data: row } = await db
        .from("creator_subscriptions")
        .select("id, subscriber_user_id, stripe_account_id, stripe_subscription_id, status")
        .eq("id", data.subscriptionId)
        .maybeSingle();
      // Same answer whether it doesn't exist or isn't theirs.
      if (!row || row.subscriber_user_id !== context.userId)
        throw new SubscriptionCheckoutError("Subscription not found.");
      if (!row.stripe_subscription_id || !["active", "past_due"].includes(row.status)) {
        throw new SubscriptionCheckoutError("This subscription isn't active.");
      }
      await getStripe().subscriptions.update(
        row.stripe_subscription_id,
        { cancel_at_period_end: true },
        {
          stripeAccount: row.stripe_account_id,
          idempotencyKey: `yooits-creator-sub-cancel-${row.id}`,
        },
      );
      // The webhook records the change from Stripe.
      return { ok: true as const };
    } catch (e) {
      publicError(e);
    }
  });
