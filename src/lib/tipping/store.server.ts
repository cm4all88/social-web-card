/**
 * Supabase-backed TippingStore. Uses the service-role client, so it bypasses
 * RLS: only ever import this from server functions / server routes.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TipPatch, TipRow, TippingStore } from "./webhook-handler";

const TIP_COLUMNS =
  "id, creator_user_id, stripe_account_id, checkout_session_id, payment_intent_id, charge_id, application_fee_id, application_fee_cents, tip_amount_cents, platform_fee_cents, total_cents, status, amount_refunded_cents, platform_fee_refunded_cents, dispute_status, livemode";

function fail(what: string, error: { message: string } | null): never {
  // Keep messages generic; details go to the Worker log only.
  console.error(`[tipping] ${what} failed`, error?.message);
  throw new Error(`${what} failed`);
}

export const supabaseTippingStore: TippingStore = {
  async claimEvent(e) {
    // One atomic statement in the database (claim_stripe_event).
    const { data, error } = await supabaseAdmin.rpc("claim_stripe_event", {
      _id: e.id,
      _type: e.type,
      _account: e.account ?? undefined,
      _livemode: e.livemode,
    });
    if (error) fail("claim event", error);
    if (data === "claimed" || data === "duplicate" || data === "in_progress") return data;
    fail("claim event", { message: `unexpected result ${String(data)}` });
  },

  async markEventProcessed(id) {
    const { error } = await supabaseAdmin
      .from("stripe_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) fail("mark event", error);
  },

  async releaseEvent(id) {
    const { error } = await supabaseAdmin
      .from("stripe_events")
      .update({ claimed_at: null })
      .eq("id", id)
      .is("processed_at", null);
    if (error) fail("release event", error);
  },

  async getTipById(id) {
    const { data, error } = await supabaseAdmin
      .from("tips")
      .select(TIP_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) fail("load tip", error);
    return (data as TipRow | null) ?? null;
  },

  async getTipByPaymentIntent(pi) {
    const { data, error } = await supabaseAdmin
      .from("tips")
      .select(TIP_COLUMNS)
      .eq("payment_intent_id", pi)
      .maybeSingle();
    if (error) fail("load tip", error);
    return (data as TipRow | null) ?? null;
  },

  async getTipByChargeId(chargeId) {
    const { data, error } = await supabaseAdmin
      .from("tips")
      .select(TIP_COLUMNS)
      .eq("charge_id", chargeId)
      .maybeSingle();
    if (error) fail("load tip", error);
    return (data as TipRow | null) ?? null;
  },

  async getTipByApplicationFee(feeId) {
    const { data, error } = await supabaseAdmin
      .from("tips")
      .select(TIP_COLUMNS)
      .eq("application_fee_id", feeId)
      .maybeSingle();
    if (error) fail("load tip", error);
    return (data as TipRow | null) ?? null;
  },

  async updateTip(id, patch: TipPatch) {
    const { error } = await supabaseAdmin.from("tips").update(patch).eq("id", id);
    if (error) fail("update tip", error);
  },

  async updateAccount(stripeAccountId, patch) {
    const { error } = await supabaseAdmin
      .from("creator_payment_accounts")
      .update(patch)
      .eq("stripe_account_id", stripeAccountId);
    if (error) fail("update account", error);
  },

  async getAccountStatus(stripeAccountId) {
    const { data, error } = await supabaseAdmin
      .from("creator_payment_accounts")
      .select("status")
      .eq("stripe_account_id", stripeAccountId)
      .maybeSingle();
    if (error) fail("load account", error);
    return data?.status ?? null;
  },
};
