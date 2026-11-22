/**
 * Supabase-backed GiftStore (service role; server only). Event claims use
 * the same claim_stripe_event table as tips, Plus and creator subscriptions.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { GiftRow, GiftStore } from "./wishlist-gifts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const table = () =>
  (supabaseAdmin as unknown as { from: (t: string) => any }).from("wishlist_gifts");
/* eslint-enable @typescript-eslint/no-explicit-any */

function fail(what: string, error: { message: string } | null): never {
  console.error(`[wishlist-gifts] ${what} failed`, error?.message);
  throw new Error(`${what} failed`);
}

export const supabaseGiftStore: GiftStore = {
  async getById(id) {
    const { data, error } = await table()
      .select("id, stripe_account_id, total_cents, livemode, status")
      .eq("id", id)
      .maybeSingle();
    if (error) fail("load gift", error);
    return (data as GiftRow | null) ?? null;
  },
  async update(id, patch) {
    const { error } = await table().update(patch).eq("id", id);
    if (error) fail("update gift", error);
  },
};
