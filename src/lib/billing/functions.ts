/**
 * Server functions for Yooits.me Plus. Handlers run only on the server; the
 * browser gets RPC stubs. The price, the customer and the plan are decided
 * here from the database and Stripe, never from browser input.
 *
 * Paid checkout opens only when PLUS_BILLING_ENABLED is "true" and
 * PLUS_CHECKOUT_ENABLED is "true" (everyone) or "owner" (Yooits.me admins only),
 * see config.server.ts. Without them, Founding Members keep
 * their free Plus and nobody is offered a way to pay.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { billingConfigOrNull, BillingUnavailableError, getBillingConfig } from "./config.server";
import { loadPlusState } from "./store.server";
import { subscriptionToRow } from "./sync";
import { getBillingStripe } from "./stripe.server";
import { storedPortalConfigurationId } from "@/lib/payments/setup.server";
import {
  founderTrialEnd,
  PLUS_METADATA_KEY,
  PLUS_METADATA_VALUE,
  PLUS_PRICE_CENTS,
  PLUS_PRICE_LOOKUP_KEY,
  priceIsPlus,
  statusBlocksNewCheckout,
  statusKeepsPlus,
} from "./plus";

const GENERIC = "Something went wrong. Please try again.";
class UserFacingError extends Error {}

function publicError(e: unknown): never {
  if (e instanceof BillingUnavailableError || e instanceof UserFacingError)
    throw new Error(e.message);
  console.error("[plus-billing]", e instanceof Error ? e.message : e);
  throw new Error(GENERIC);
}

/** Yooits.me colours and logo on the Plus checkout page (the site's own tokens). */
export const PLUS_CHECKOUT_BRANDING: Stripe.Checkout.SessionCreateParams.BrandingSettings = {
  display_name: "Yooits.me",
  background_color: "#ffffff",
  button_color: "#df6df8",
  border_style: "rounded",
  font_family: "default",
  logo: { type: "url", url: "https://yooits.me/email/yooits-logo.png" },
};

const isLive = (key: string) => /^(sk|rk)_live_/.test(key);
const db = () => supabaseAdmin as unknown as SupabaseClient;

function siteUrl(): string {
  const cfg = getBillingConfig();
  return cfg.siteUrl ?? new URL(getRequest().url).origin;
}

/** True when this person may start a Plus checkout under the current switch. */
async function checkoutAllowed(cfg: { checkoutMode: string }, userId: string): Promise<boolean> {
  if (cfg.checkoutMode === "everyone") return true;
  if (cfg.checkoutMode !== "owner") return false;
  const { data, error } = await db().rpc("has_role", { _user_id: userId, _role: "admin" });
  return !error && data === true;
}

async function isSuspended(userId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("account_status")
    .select("suspended_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return !!(data as { suspended_at: string | null } | null)?.suspended_at;
}

/** The Plus price in Stripe, checked to be exactly $4.99 a month in USD. */
export async function findPlusPrice(stripe: Stripe, priceId: string | null): Promise<Stripe.Price> {
  let price: Stripe.Price | undefined;
  if (priceId) {
    price = await stripe.prices.retrieve(priceId);
  } else {
    const list = await stripe.prices.list({
      lookup_keys: [PLUS_PRICE_LOOKUP_KEY],
      active: true,
      limit: 1,
    });
    price = list.data[0];
  }
  if (!price || !priceIsPlus(price)) {
    console.error("[plus-billing] Plus price missing or not $4.99/month USD");
    throw new BillingUnavailableError();
  }
  return price;
}

/** The person's Stripe customer in this mode, created once. */
async function customerFor(
  stripe: Stripe,
  userId: string,
  email: string | undefined,
  livemode: boolean,
): Promise<string> {
  const { data, error } = await db()
    .from("billing_customers")
    .select("stripe_customer_id, livemode")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const existing = data as { stripe_customer_id: string; livemode: boolean } | null;
  if (existing && existing.livemode === livemode) return existing.stripe_customer_id;
  if (existing) {
    // A test-mode customer from sandbox testing; live payments get a new one.
    throw new UserFacingError("Your billing is set up in test mode. Contact Yooits.me to switch it.");
  }
  const customer = await stripe.customers.create(
    { email, metadata: { user_id: userId, [PLUS_METADATA_KEY]: PLUS_METADATA_VALUE } },
    { idempotencyKey: `plus-customer-${userId}-${livemode ? "live" : "test"}` },
  );
  const { error: insErr } = await db()
    .from("billing_customers")
    .insert({ stripe_customer_id: customer.id, user_id: userId, livemode });
  if (insErr) {
    // Another request created it first: use the stored one.
    const { data: again } = await db()
      .from("billing_customers")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    const id = (again as { stripe_customer_id: string } | null)?.stripe_customer_id;
    if (id) return id;
    throw insErr;
  }
  return customer.id;
}

// ---------------------------------------------------------------------------
// Signed in: where do I stand with Plus?
// ---------------------------------------------------------------------------
export const getMyPlus = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const state = await loadPlusState(context.userId);
      const cfg = billingConfigOrNull();
      const livemode = cfg ? isLive(cfg.secretKey) : false;
      const current =
        state.subscriptions.find((s) => statusKeepsPlus(s.status)) ??
        state.subscriptions.find((s) => statusBlocksNewCheckout(s.status)) ??
        null;
      const grantActive =
        !!state.grant &&
        !state.grant.revoked_at &&
        new Date(state.grant.ends_at).getTime() > Date.now();
      const canManage = !!cfg && state.customers.some((c) => c.livemode === livemode);
      return {
        plan: state.plan,
        priceCents: PLUS_PRICE_CENTS,
        founding: grantActive ? { endsAt: state.grant!.ends_at } : null,
        subscription: current
          ? {
              status: current.status,
              currentPeriodEnd: current.current_period_end,
              trialEnd: current.trial_end,
              cancelAtPeriodEnd: current.cancel_at_period_end || !!current.cancel_at,
              cancelAt: current.cancel_at,
              testMode: !current.livemode,
            }
          : null,
        checkoutAvailable: !!cfg && !current && (await checkoutAllowed(cfg, context.userId)),
        canManageBilling: canManage,
      };
    } catch (e) {
      publicError(e);
    }
  });

// ---------------------------------------------------------------------------
// Signed in: start a Plus subscription in Stripe Checkout.
// ---------------------------------------------------------------------------
export const startPlusCheckout = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const cfg = getBillingConfig();
      const userId = context.userId;
      if (!(await checkoutAllowed(cfg, userId))) throw new BillingUnavailableError();
      if (await isSuspended(userId))
        throw new UserFacingError("This account can't start Plus right now.");

      const state = await loadPlusState(userId);
      if (state.subscriptions.some((s) => statusBlocksNewCheckout(s.status))) {
        throw new UserFacingError("You already have Plus. Manage it from your dashboard.");
      }

      const stripe = getBillingStripe();
      const livemode = isLive(cfg.secretKey);
      const price = await findPlusPrice(stripe, cfg.priceId);
      const { data: userData } = await db().auth.admin.getUserById(userId);
      const customer = await customerFor(
        stripe,
        userId,
        userData?.user?.email ?? undefined,
        livemode,
      );

      // A Founding Member who keeps Plus isn't charged before the free months end.
      const grantLive = state.grant && !state.grant.revoked_at ? state.grant.ends_at : null;
      const trialEnd = founderTrialEnd(grantLive);
      const base = siteUrl();
      const metadata = { user_id: userId, [PLUS_METADATA_KEY]: PLUS_METADATA_VALUE };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer,
        client_reference_id: userId,
        line_items: [{ price: price.id, quantity: 1 }],
        metadata,
        subscription_data: {
          metadata,
          ...(trialEnd ? { trial_end: trialEnd } : {}),
          description: "Yooits.me Plus",
        },
        allow_promotion_codes: false,
        branding_settings: PLUS_CHECKOUT_BRANDING,
        success_url: `${base}/dashboard?plus=started#plus`,
        cancel_url: `${base}/dashboard#plus`,
      });
      if (!session.url) throw new Error("checkout session without url");
      return { url: session.url };
    } catch (e) {
      publicError(e);
    }
  });

// ---------------------------------------------------------------------------
// Signed in: Stripe's billing portal (card, invoices, cancel).
// ---------------------------------------------------------------------------
export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const cfg = getBillingConfig();
      const livemode = isLive(cfg.secretKey);
      const state = await loadPlusState(context.userId);
      const customer = state.customers.find((c) => c.livemode === livemode);
      if (!customer) throw new UserFacingError("There's no billing to manage yet.");
      const stripe = getBillingStripe();
      const configuration =
        cfg.portalConfigurationId ?? (await storedPortalConfigurationId(livemode));
      const session = await stripe.billingPortal.sessions.create({
        customer: customer.stripe_customer_id,
        return_url: `${siteUrl()}/dashboard#plus`,
        ...(configuration ? { configuration } : {}),
      });
      return { url: session.url };
    } catch (e) {
      publicError(e);
    }
  });

// ---------------------------------------------------------------------------
// Signed in: cancel at the end of the paid month, or undo that.
// Plus stays on until then; nothing is refunded or deleted.
// ---------------------------------------------------------------------------
export const setPlusCancellation = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(z.object({ cancel: z.boolean() }))
  .handler(async ({ context, data }) => {
    try {
      const cfg = getBillingConfig();
      const livemode = isLive(cfg.secretKey);
      const state = await loadPlusState(context.userId);
      const sub = state.subscriptions.find(
        (s) => statusKeepsPlus(s.status) && s.livemode === livemode,
      );
      if (!sub) throw new UserFacingError("There's no Plus subscription to change.");
      const stripe = getBillingStripe();
      // Check with Stripe that this subscription is still this person's.
      const live = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      const liveCustomer = typeof live.customer === "string" ? live.customer : live.customer.id;
      if (liveCustomer !== sub.stripe_customer_id) throw new Error("customer mismatch");
      const updated = await stripe.subscriptions.update(
        sub.stripe_subscription_id,
        data.cancel
          ? { cancel_at_period_end: true }
          : { cancel_at_period_end: false, cancel_at: "" },
      );
      // The webhook stores the result too; storing it here shows it at once.
      await db()
        .from("plus_subscriptions")
        .update({
          ...subscriptionToRow(updated as never, context.userId),
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_subscription_id", sub.stripe_subscription_id);
      return { cancelAtPeriodEnd: !!updated.cancel_at_period_end || !!updated.cancel_at };
    } catch (e) {
      publicError(e);
    }
  });
