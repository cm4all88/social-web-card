/**
 * Owner > Payments: see the Stripe account Yooits is connected to, set it up,
 * and see which payment features are ready. Owner only (checked on the
 * server). Nothing here sells anything or flips a feature switch.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { overview, runSetup } from "./setup.server";
import { webhookBase } from "./stripe-setup";
import { featureReadiness, type FeatureInputs } from "./readiness";

const db = () => supabaseAdmin as unknown as SupabaseClient;
const env = (name: string) => {
  const v = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return v && v.trim().length > 0 ? v.trim() : undefined;
};

async function requireAdmin(userId: string): Promise<void> {
  const { data, error } = await db().rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || data !== true) throw new Error("Only the Yooits owner can see payments setup.");
}

function base(): string | null {
  return webhookBase(env("PUBLIC_SITE_URL") ?? new URL(getRequest().url).origin);
}

async function settings() {
  const one = async (table: string) => {
    const { data } = await db().from(table).select("enabled, checkout_enabled").maybeSingle();
    const r = data as { enabled: boolean; checkout_enabled: boolean } | null;
    return { enabled: !!r?.enabled, checkout: !!r?.checkout_enabled };
  };
  const [creatorSubs, gifts, offerings] = await Promise.all([
    one("creator_subscription_settings"),
    one("wishlist_gift_settings"),
    one("support_offering_settings"),
  ]);
  return { creatorSubs, gifts, offerings };
}

async function load() {
  const b = base();
  const o = await overview(b);
  const s = await settings();
  const inputs: FeatureInputs = {
    keyMode: o.key.mode,
    accountReady: !!o.account?.chargesEnabled && !!o.account?.detailsSubmitted,
    connectOk: o.connect.ok,
    plusPriceOk: o.plusPrice.ok,
    portalOk: o.portal.ok,
    webhookOk: Object.fromEntries(o.webhooks.map((w) => [w.item, w.state === "ok"])),
    env: {
      PLUS_BILLING_ENABLED: env("PLUS_BILLING_ENABLED") === "true",
      PLUS_CHECKOUT_ENABLED: env("PLUS_CHECKOUT_ENABLED") === "true",
      PLUS_CHECKOUT_OWNER_ONLY: env("PLUS_CHECKOUT_ENABLED") === "owner",
      PLUS_LIVE_MODE_APPROVED: env("PLUS_LIVE_MODE_APPROVED") === "true",
      TIPPING_ENABLED: env("TIPPING_ENABLED") === "true",
      STRIPE_LIVE_MODE_APPROVED: env("STRIPE_LIVE_MODE_APPROVED") === "true",
    },
    settings: s,
  };
  return { ...o, features: featureReadiness(inputs) };
}

export const getPaymentsSetup = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    return load();
  });

export const runPaymentsSetup = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const b = base();
    if (!b) throw new Error("Open this page on yooits.me or test.yooits.me to set up Stripe.");
    let steps: string[];
    try {
      steps = await runSetup(b, context.userId);
    } catch (e) {
      const m = ((e as Error)?.message ?? "Setup didn't finish.").replace(
        /(sk|rk|whsec)_[A-Za-z0-9_]+/g,
        "[hidden]",
      );
      console.error("[stripe-setup] failed", m);
      throw new Error(`Setup didn't finish: ${m.slice(0, 200)}`);
    }
    return { steps, status: await load() };
  });
