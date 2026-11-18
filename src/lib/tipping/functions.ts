/**
 * Server functions for tipping. Handlers run only on the server; the browser
 * gets RPC stubs. Every amount, account id and eligibility decision is made
 * here from the database and Stripe, never from browser input.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canAcceptTips, snapshotAccount } from "./account-status";
import {
  getTippingConfig,
  isLiveKey,
  isTippingEnabled,
  TippingUnavailableError,
} from "./config.server";
import { MAX_TIP_CENTS, MIN_TIP_CENTS, PLATFORM_FEE_CENTS, quoteTip, TIP_CURRENCY } from "./money";
import { buildTipCheckoutParams } from "./checkout-params";
import { checkAndRecordAttempt, hashIp } from "./rate-limit.server";
import { getStripe } from "./stripe.server";

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{1,30}$/);

/** Generic message for anything unexpected; details stay in the Worker log. */
const GENERIC = "Something went wrong. Please try again.";

function siteUrl(): string {
  const cfg = getTippingConfig();
  if (cfg.siteUrl) return cfg.siteUrl;
  return new URL(getRequest().url).origin;
}

function publicError(e: unknown): never {
  if (e instanceof TippingUnavailableError) throw new Error(e.message);
  if (e instanceof UserFacingError) throw new Error(e.message);
  console.error("[tipping]", e instanceof Error ? e.message : e);
  throw new Error(GENERIC);
}

class UserFacingError extends Error {}

async function loadCreatorByUsername(username: string) {
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, username, display_name")
    .eq("username", username)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return null;
  const [{ data: settings }, { data: account }] = await Promise.all([
    supabaseAdmin
      .from("tip_settings")
      .select("enabled, show_on_profile, button_text")
      .eq("user_id", profile.user_id)
      .maybeSingle(),
    supabaseAdmin
      .from("creator_payment_accounts")
      .select("stripe_account_id, status, charges_enabled, livemode")
      .eq("user_id", profile.user_id)
      .maybeSingle(),
  ]);
  return { profile, settings, account };
}

// ---------------------------------------------------------------------------
// Public: is tipping available for this creator?
// ---------------------------------------------------------------------------
export const getPublicTipConfig = createServerFn({ method: "GET" })
  .inputValidator(z.object({ username: usernameSchema }))
  .handler(async ({ data }) => {
    const off = { available: false as const };
    if (!isTippingEnabled()) return off;
    try {
      getTippingConfig();
      const creator = await loadCreatorByUsername(data.username);
      if (!creator || !creator.settings?.enabled || !canAcceptTips(creator.account)) return off;
      return {
        available: true as const,
        showOnProfile: creator.settings.show_on_profile,
        buttonText: creator.settings.button_text,
        displayName: creator.profile.display_name || creator.profile.username,
        username: creator.profile.username,
        minCents: MIN_TIP_CENTS,
        maxCents: MAX_TIP_CENTS,
        feeCents: PLATFORM_FEE_CENTS,
      };
    } catch (e) {
      console.error("[tipping] config", e instanceof Error ? e.message : e);
      return off;
    }
  });

// ---------------------------------------------------------------------------
// Public: create a Stripe Checkout session for a tip (no account needed).
// ---------------------------------------------------------------------------
export const createTipCheckout = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      username: usernameSchema,
      amountCents: z.number().int(),
      supporterName: z.string().trim().max(50).optional(),
      message: z.string().trim().max(280).optional(),
      source: z.enum(["profile", "link"]).default("profile"),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const cfg = getTippingConfig();
      const quote = quoteTip(data.amountCents);
      if (!quote.ok) throw new UserFacingError(quote.error);

      const creator = await loadCreatorByUsername(data.username);
      if (
        !creator ||
        !creator.settings?.enabled ||
        !canAcceptTips(creator.account) ||
        !creator.account
      ) {
        throw new UserFacingError("This creator isn't accepting tips right now.");
      }
      const account = creator.account;
      const livemode = isLiveKey(cfg.secretKey);
      if (account.livemode !== livemode) {
        throw new UserFacingError("This creator isn't accepting tips right now.");
      }

      const ip =
        getRequestHeader("cf-connecting-ip") ?? getRequestIP({ xForwardedFor: true }) ?? "unknown";
      const limited = await checkAndRecordAttempt({
        ipHash: await hashIp(ip, cfg.ipHashSalt),
        creatorUserId: creator.profile.user_id,
      });
      if (limited)
        throw new UserFacingError("Too many attempts. Please wait a few minutes and try again.");

      const { tipCents, feeCents, totalCents } = quote.quote;
      const { data: tip, error: tipErr } = await supabaseAdmin
        .from("tips")
        .insert({
          creator_user_id: creator.profile.user_id,
          stripe_account_id: account.stripe_account_id,
          currency: TIP_CURRENCY,
          tip_amount_cents: tipCents,
          platform_fee_cents: feeCents,
          total_cents: totalCents,
          supporter_name: data.supporterName || null,
          supporter_message: data.message || null,
          source: data.source,
          livemode,
        })
        .select("id")
        .single();
      if (tipErr || !tip) throw tipErr ?? new Error("tip insert failed");

      const base = siteUrl();
      const handle = creator.profile.username;
      const stripe = getStripe();
      let session;
      try {
        session = await stripe.checkout.sessions.create(
          buildTipCheckoutParams({
            tipId: tip.id,
            creatorUserId: creator.profile.user_id,
            handle,
            quote: quote.quote,
            baseUrl: base,
          }),
          { stripeAccount: account.stripe_account_id, idempotencyKey: `yooits-tip-${tip.id}` },
        );
      } catch (e) {
        await supabaseAdmin.from("tips").update({ status: "failed" }).eq("id", tip.id);
        throw e;
      }

      await supabaseAdmin.from("tips").update({ checkout_session_id: session.id }).eq("id", tip.id);
      if (!session.url) throw new Error("checkout session has no url");
      return { url: session.url };
    } catch (e) {
      publicError(e);
    }
  });

// ---------------------------------------------------------------------------
// Public: what happened to a checkout (for the thank-you page).
// The session id is unguessable and only reveals the tip amount and status.
// ---------------------------------------------------------------------------
export const getTipCheckoutResult = createServerFn({ method: "GET" })
  .inputValidator(z.object({ sessionId: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]{10,200}$/) }))
  .handler(async ({ data }) => {
    try {
      getTippingConfig();
      const { data: tip } = await supabaseAdmin
        .from("tips")
        .select("status, tip_amount_cents, total_cents, stripe_account_id")
        .eq("checkout_session_id", data.sessionId)
        .maybeSingle();
      if (!tip) return { status: "unknown" as const };
      if (tip.status === "succeeded") {
        return {
          status: "paid" as const,
          tipCents: tip.tip_amount_cents,
          totalCents: tip.total_cents,
        };
      }
      if (tip.status !== "pending") return { status: "not_paid" as const };
      // The webhook may not have arrived yet; ask Stripe (read-only).
      const session = await getStripe().checkout.sessions.retrieve(
        data.sessionId,
        {},
        { stripeAccount: tip.stripe_account_id },
      );
      if (session.payment_status === "paid") {
        return {
          status: "paid" as const,
          tipCents: tip.tip_amount_cents,
          totalCents: tip.total_cents,
        };
      }
      return {
        status: session.status === "complete" ? ("processing" as const) : ("not_paid" as const),
      };
    } catch (e) {
      console.error("[tipping] result", e instanceof Error ? e.message : e);
      return { status: "unknown" as const };
    }
  });

// ---------------------------------------------------------------------------
// Creator: connect / refresh / disconnect Stripe, refund a tip.
// ---------------------------------------------------------------------------
const authed = [attachSupabaseAuth, requireSupabaseAuth] as const;

export const getTippingAvailability = createServerFn({ method: "GET" })
  .middleware([...authed])
  .handler(async () => ({ enabled: isTippingEnabled() }));

export const startStripeOnboarding = createServerFn({ method: "POST" })
  .middleware([...authed])
  .handler(async ({ context }) => {
    try {
      const cfg = getTippingConfig();
      const stripe = getStripe();
      const userId = context.userId;
      const livemode = isLiveKey(cfg.secretKey);

      const { data: existing } = await supabaseAdmin
        .from("creator_payment_accounts")
        .select("stripe_account_id, livemode")
        .eq("user_id", userId)
        .maybeSingle();

      let accountId = existing?.livemode === livemode ? existing.stripe_account_id : null;
      if (existing && existing.livemode !== livemode) {
        throw new UserFacingError("Your payment account was set up in a different Stripe mode.");
      }

      if (!accountId) {
        const email = typeof context.claims.email === "string" ? context.claims.email : undefined;
        const account = await stripe.accounts.create(
          {
            country: "US",
            email,
            controller: {
              fees: { payer: "account" },
              losses: { payments: "stripe" },
              requirement_collection: "stripe",
              stripe_dashboard: { type: "full" },
            },
            metadata: { yooits_user_id: userId },
          },
          { idempotencyKey: `yooits-acct-${userId}-${livemode ? "live" : "test"}` },
        );
        const snap = snapshotAccount(account);
        const { error } = await supabaseAdmin
          .from("creator_payment_accounts")
          .insert({ user_id: userId, stripe_account_id: account.id, livemode, ...snap });
        if (error) throw error;
        accountId = account.id;
      } else {
        // Reconnecting after a disconnect: take the status from Stripe again.
        const snap = snapshotAccount(await stripe.accounts.retrieve(accountId));
        await supabaseAdmin.from("creator_payment_accounts").update(snap).eq("user_id", userId);
      }

      const base = siteUrl();
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        refresh_url: `${base}/admin?stripe=refresh`,
        return_url: `${base}/admin?stripe=return`,
      });
      return { url: link.url };
    } catch (e) {
      publicError(e);
    }
  });

export const refreshStripeAccount = createServerFn({ method: "POST" })
  .middleware([...authed])
  .handler(async ({ context }) => {
    try {
      getTippingConfig();
      const { data: row } = await supabaseAdmin
        .from("creator_payment_accounts")
        .select("stripe_account_id, status")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!row) return { status: "not_started" as const };
      const snap = snapshotAccount(await getStripe().accounts.retrieve(row.stripe_account_id));
      const patch =
        row.status === "disconnected" ? { ...snap, status: "disconnected" as const } : snap;
      await supabaseAdmin
        .from("creator_payment_accounts")
        .update(patch)
        .eq("user_id", context.userId);
      return { status: patch.status };
    } catch (e) {
      publicError(e);
    }
  });

export const disconnectStripeAccount = createServerFn({ method: "POST" })
  .middleware([...authed])
  .handler(async ({ context }) => {
    try {
      getTippingConfig();
      await supabaseAdmin
        .from("creator_payment_accounts")
        .update({ status: "disconnected" })
        .eq("user_id", context.userId);
      await supabaseAdmin
        .from("tip_settings")
        .update({ enabled: false })
        .eq("user_id", context.userId);
      return { status: "disconnected" as const };
    } catch (e) {
      publicError(e);
    }
  });

/** Full refund of one tip, including the Yooits service fee. */
export const refundTip = createServerFn({ method: "POST" })
  .middleware([...authed])
  .inputValidator(z.object({ tipId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    try {
      getTippingConfig();
      const { data: tip } = await supabaseAdmin
        .from("tips")
        .select(
          "id, creator_user_id, stripe_account_id, payment_intent_id, status, amount_refunded_cents",
        )
        .eq("id", data.tipId)
        .maybeSingle();
      // Same answer whether the tip doesn't exist or isn't theirs.
      if (!tip || tip.creator_user_id !== context.userId)
        throw new UserFacingError("Tip not found.");
      if (tip.status !== "succeeded" || !tip.payment_intent_id) {
        throw new UserFacingError("Only completed tips can be refunded.");
      }
      if (tip.amount_refunded_cents > 0)
        throw new UserFacingError("This tip has already been refunded.");
      await getStripe().refunds.create(
        {
          payment_intent: tip.payment_intent_id,
          refund_application_fee: true,
          reason: "requested_by_customer",
        },
        { stripeAccount: tip.stripe_account_id, idempotencyKey: `yooits-refund-${tip.id}` },
      );
      return { ok: true as const };
    } catch (e) {
      publicError(e);
    }
  });
