import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTippingConfig, isLiveKey, isTestKey } from "@/lib/tipping/config.server";
import { getStripe } from "@/lib/tipping/stripe.server";
import type Stripe from "stripe";

export const publicFields = "id,title,description,price_cents,kind";

// These tables are server-only and are added by the digital products migration.
export const products = () => supabaseAdmin.from("digital_products");
export const orders = () => supabaseAdmin.from("digital_orders");
export const files = () => supabaseAdmin.storage.from("digital-products");

export function pilotPaymentMode() {
  const config = getTippingConfig();
  const live = isLiveKey(config.secretKey);
  if (
    process.env.DIGITAL_PRODUCTS_ENABLED !== "true" ||
    (live && process.env.DIGITAL_PRODUCTS_LIVE_APPROVED !== "true")
  ) {
    throw new Error("Product checkout is unavailable.");
  }
  return { live, siteUrl: config.siteUrl };
}

export function digitalOrderMode() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (isLiveKey(key)) return true;
  if (
    isTestKey(key) &&
    (process.env.VERCEL_ENV !== "production" ||
      process.env.STRIPE_TEST_MODE_ON_PRODUCTION === "true")
  )
    return false;
  throw new Error("Purchases are unavailable.");
}

export async function sellerAccount(userId: string) {
  const { live } = pilotPaymentMode();
  const pilotSellers = (process.env.DIGITAL_PRODUCTS_SELLER_IDS ?? "")
    .split(",")
    .map((id) => id.trim());
  if (!pilotSellers.includes(userId))
    throw new Error("This creator is outside the digital product pilot.");
  const [approved, account] = await Promise.all([
    supabaseAdmin.rpc("creator_is_monetized", { _user_id: userId }),
    supabaseAdmin
      .from("creator_payment_accounts")
      .select("stripe_account_id")
      .eq("user_id", userId)
      .eq("status", "connected")
      .eq("charges_enabled", true)
      .eq("payouts_enabled", true)
      .eq("livemode", live)
      .is("tipping_suspended_at", null)
      .maybeSingle(),
  ]);
  if (approved.error || account.error) throw new Error("Could not check seller eligibility.");
  if (!approved.data || !account.data)
    throw new Error("Creator approval and payouts are required.");
  return { id: account.data.stripe_account_id, live };
}

export async function applyProductEvent(event: Stripe.Event) {
  if (!event.account) return false;
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded" ||
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    const session = event.data.object;
    const id = session.metadata?.digital_order_id;
    if (!id) return false;
    const expired =
      event.type === "checkout.session.expired" ||
      event.type === "checkout.session.async_payment_failed";
    if (!expired && (session.payment_status !== "paid" || session.currency !== "usd")) return true;
    const { error } = await orders()
      .update({ status: expired ? "revoked" : "paid" })
      .eq("id", id)
      .eq("status", "pending")
      .eq("stripe_account_id", event.account)
      .eq("livemode", event.livemode)
      .eq("amount_cents", session.amount_total ?? -1);
    if (error) throw error;
    return true;
  }
  if (event.type !== "charge.refunded" && event.type !== "charge.dispute.created") return false;

  // Stripe copies PaymentIntent metadata to the charge, including on a refund
  // that arrives before the checkout webhook.
  const charge =
    event.type === "charge.refunded"
      ? event.data.object
      : typeof event.data.object.charge === "string"
        ? await getStripe().charges.retrieve(
            event.data.object.charge,
            {},
            { stripeAccount: event.account },
          )
        : event.data.object.charge;
  const id = charge.metadata.digital_order_id;
  if (!id) return false;
  const { error } = await orders()
    .update({ status: "revoked" })
    .eq("id", id)
    .eq("stripe_account_id", event.account)
    .eq("livemode", event.livemode);
  if (error) throw error;
  return true;
}
