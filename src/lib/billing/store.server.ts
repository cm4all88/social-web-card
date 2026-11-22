/**
 * Supabase-backed BillingStore. Uses the service-role client (bypasses RLS):
 * only import this from server functions and server routes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BillingStore, PlusSubscriptionRow } from "./sync";

function fail(what: string, error: { message: string } | null): never {
  console.error(`[plus-billing] ${what} failed`, error?.message);
  throw new Error(`${what} failed`);
}

// The billing tables aren't in the generated types yet.
const db = () => supabaseAdmin as unknown as SupabaseClient;

export function billingStore(client: () => SupabaseClient = db): BillingStore {
  return {
    async claimEvent(e) {
      const { data, error } = await client().rpc("claim_stripe_event", {
        _id: e.id,
        _type: e.type,
        _account: null,
        _livemode: e.livemode,
      });
      if (error) fail("claim event", error);
      if (data === "claimed" || data === "duplicate" || data === "in_progress") return data;
      fail("claim event", { message: `unexpected result ${String(data)}` });
    },
    async markEventProcessed(id) {
      const { error } = await client().from("stripe_events").update({ processed_at: new Date().toISOString() }).eq("id", id);
      if (error) fail("mark event", error);
    },
    async releaseEvent(id) {
      const { error } = await client().from("stripe_events").update({ claimed_at: null }).eq("id", id).is("processed_at", null);
      if (error) fail("release event", error);
    },
    async userForCustomer(customerId) {
      const { data, error } = await client()
        .from("billing_customers")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      if (error) fail("load customer", error);
      return (data as { user_id: string | null } | null)?.user_id ?? null;
    },
    async userExists(userId) {
      const { data, error } = await client().from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
      if (error) fail("load profile", error);
      return !!data;
    },
    async linkCustomer(customerId, userId, livemode) {
      const { error } = await client()
        .from("billing_customers")
        .upsert({ stripe_customer_id: customerId, user_id: userId, livemode }, { onConflict: "stripe_customer_id", ignoreDuplicates: true });
      if (error) fail("link customer", error);
    },
    async upsertSubscription(row: PlusSubscriptionRow) {
      const { error } = await client()
        .from("plus_subscriptions")
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "stripe_subscription_id" });
      if (error) fail("store subscription", error);
    },
  };
}

/** The signed-in person's Plus picture, read with the service role. */
export async function loadPlusState(userId: string) {
  const c = db();
  const [{ data: plan, error: pErr }, { data: subs, error: sErr }, { data: grant, error: gErr }, { data: cust, error: cErr }] =
    await Promise.all([
      c.rpc("current_plan", { _user_id: userId }),
      c
        .from("plus_subscriptions")
        .select("stripe_subscription_id, stripe_customer_id, status, current_period_end, trial_end, cancel_at_period_end, cancel_at, livemode, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
      c
        .from("plan_entitlements")
        .select("ends_at, revoked_at, starts_at")
        .eq("user_id", userId)
        .eq("source", "founding_creator")
        .maybeSingle(),
      c.from("billing_customers").select("stripe_customer_id, livemode").eq("user_id", userId),
    ]);
  if (pErr || sErr || gErr || cErr) fail("load plan", pErr ?? sErr ?? gErr ?? cErr);
  return {
    plan: plan === "plus" ? ("plus" as const) : ("free" as const),
    subscriptions: (subs ?? []) as {
      stripe_subscription_id: string;
      stripe_customer_id: string;
      status: PlusSubscriptionRow["status"];
      current_period_end: string | null;
      trial_end: string | null;
      cancel_at_period_end: boolean;
      cancel_at: string | null;
      livemode: boolean;
    }[],
    grant: grant as { ends_at: string; revoked_at: string | null; starts_at: string } | null,
    customers: (cust ?? []) as { stripe_customer_id: string; livemode: boolean }[],
  };
}
