/**
 * Supabase-backed TippingStore. Uses the service-role client, so it bypasses
 * RLS: only ever import this from server functions / server routes.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TipPatch, TipRow, TippingStore } from "./webhook-handler";

const TIP_COLUMNS =
  "id, creator_user_id, stripe_account_id, checkout_session_id, payment_intent_id, charge_id, tip_amount_cents, platform_fee_cents, total_cents, status, amount_refunded_cents, platform_fee_refunded_cents, dispute_status, livemode";

function fail(what: string, error: { message: string } | null): never {
  // Keep messages generic; details go to the Worker log only.
  console.error(`[tipping] ${what} failed`, error?.message);
  throw new Error(`${what} failed`);
}

export const supabaseTippingStore: TippingStore = {
  async claimEvent(e) {
    const { error: insErr } = await supabaseAdmin
      .from("stripe_events")
      .upsert(
        { id: e.id, type: e.type, account: e.account, livemode: e.livemode },
        { onConflict: "id", ignoreDuplicates: true },
      );
    if (insErr) fail("record event", insErr);
    const { data, error } = await supabaseAdmin
      .from("stripe_events")
      .select("processed_at")
      .eq("id", e.id)
      .maybeSingle();
    if (error) fail("read event", error);
    return data?.processed_at ? "duplicate" : "new";
  },

  async markEventProcessed(id) {
    const { error } = await supabaseAdmin
      .from("stripe_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) fail("mark event", error);
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
