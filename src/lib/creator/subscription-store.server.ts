/**
 * Supabase-backed CreatorSubscriptionStore. Uses the service-role client, so
 * it bypasses RLS: only ever import this from server functions and routes.
 * The event claim is the same one tips and Plus use (claim_stripe_event).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { supabaseTippingStore } from "@/lib/tipping/store.server";
import type { CreatorSubRow, CreatorSubscriptionStore } from "./subscription-webhook";

const COLUMNS =
  "id, subscriber_user_id, creator_user_id, stripe_account_id, checkout_session_id, stripe_subscription_id, status, livemode, total_cents, stripe_synced_at, needs_review";

function fail(what: string, error: { message: string } | null): never {
  console.error(`[creator-subscriptions] ${what} failed`, error?.message);
  throw new Error(`${what} failed`);
}

// The generated database types don't include this table yet.
/* eslint-disable @typescript-eslint/no-explicit-any */
const table = () =>
  (supabaseAdmin as unknown as { from: (t: string) => any }).from("creator_subscriptions");
/* eslint-enable @typescript-eslint/no-explicit-any */

export const supabaseCreatorSubscriptionStore: CreatorSubscriptionStore = {
  claimEvent: (e) => supabaseTippingStore.claimEvent(e),
  markEventProcessed: (id) => supabaseTippingStore.markEventProcessed(id),
  releaseEvent: (id) => supabaseTippingStore.releaseEvent(id),

  async getById(id) {
    const { data, error } = await table().select(COLUMNS).eq("id", id).maybeSingle();
    if (error) fail("load subscription", error);
    return (data as unknown as CreatorSubRow | null) ?? null;
  },

  async getByStripeSubscriptionId(id) {
    const { data, error } = await table()
      .select(COLUMNS)
      .eq("stripe_subscription_id", id)
      .maybeSingle();
    if (error) fail("load subscription", error);
    return (data as unknown as CreatorSubRow | null) ?? null;
  },

  async update(id, patch) {
    const { error } = await table()
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) fail("update subscription", error);
  },
};
