/**
 * Server function for wishlist gift money checkout. SWITCHED OFF and
 * unusable until Stripe agrees in writing: the database gate
 * (wishlist_gift_checkout_gate) refuses until a Yooits.me admin records Stripe's
 * written approval, switches gift money and its checkout on and sets the fee;
 * the server's Stripe Connect settings (TIPPING_ENABLED and a key) must be on
 * too. No page calls this yet. Amounts, fees and accounts are worked out here
 * from the database, never taken from the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTippingConfig, isLiveKey, TippingUnavailableError } from "@/lib/tipping/config.server";
import { getStripe } from "@/lib/tipping/stripe.server";
import {
  buildGiftCheckoutParams,
  GIFT_CURRENCY,
  GiftCheckoutError,
  planWishlistGiftCheckout,
} from "./wishlist-gifts";

const GENERIC = "Something went wrong. Please try again.";

function publicError(e: unknown): never {
  if (e instanceof TippingUnavailableError) throw new Error("Gift money isn't available.");
  if (e instanceof GiftCheckoutError) throw new Error(e.message);
  console.error("[wishlist-gifts]", e instanceof Error ? e.message : e);
  throw new Error(GENERIC);
}

// The generated database types don't include these yet.
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabaseAdmin as unknown as {
  from: (t: string) => any;
  rpc: (f: string, a: object) => any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const createWishlistGiftCheckout = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    z.object({
      itemId: z.string().uuid(),
      amountCents: z.number().int(),
      giverName: z.string().trim().max(50).optional(),
      message: z.string().trim().max(280).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    try {
      const cfg = getTippingConfig();
      const livemode = isLiveKey(cfg.secretKey);
      const { data: gate, error } = await db.rpc("wishlist_gift_checkout_gate", {
        _giver: context.userId,
        _item_id: data.itemId,
      });
      if (error) throw error;
      const plan = planWishlistGiftCheckout(gate, data.amountCents, { livemode });

      const { data: row, error: insertErr } = await db
        .from("wishlist_gifts")
        .insert({
          recipient_user_id: plan.recipientUserId,
          giver_user_id: context.userId,
          wishlist_id: plan.wishlistId,
          item_id: plan.itemId,
          item_name: plan.itemName.slice(0, 120),
          stripe_account_id: plan.stripeAccountId,
          currency: GIFT_CURRENCY,
          gift_amount_cents: plan.breakdown.creatorPrice,
          service_fee_cents: plan.breakdown.serviceFee,
          application_fee_cents: plan.applicationFeeCents,
          total_cents: plan.breakdown.total,
          giver_name: data.giverName || null,
          giver_message: data.message || null,
          livemode,
        })
        .select("id")
        .single();
      if (insertErr || !row) throw insertErr ?? new Error("gift insert failed");

      const base = cfg.siteUrl ?? new URL(getRequest().url).origin;
      let session;
      try {
        session = await getStripe().checkout.sessions.create(
          buildGiftCheckoutParams({ giftId: row.id, plan, baseUrl: base }),
          { stripeAccount: plan.stripeAccountId, idempotencyKey: `yooits-wishlist-gift-${row.id}` },
        );
      } catch (e) {
        await db.from("wishlist_gifts").update({ status: "expired" }).eq("id", row.id);
        throw e;
      }
      await db.from("wishlist_gifts").update({ checkout_session_id: session.id }).eq("id", row.id);
      if (!session.url) throw new Error("checkout session has no url");
      return { url: session.url };
    } catch (e) {
      publicError(e);
    }
  });
