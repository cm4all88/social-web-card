/**
 * Server-side check of the owner's account switches (unpublished, suspended,
 * tips off) for tipping. Uses the database function tips_allowed, which also
 * honours the payment account's own "tips stopped" flag. Fails closed: if the
 * check can't run, tips are treated as not allowed.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function tipsAllowed(userId: string): Promise<boolean> {
  // Called as a method so the client keeps its `this`.
  const client = supabaseAdmin as unknown as {
    rpc: (fn: string, args: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("tips_allowed", { _user_id: userId });
  if (error) {
    console.error("[account-status] tips_allowed", error.message);
    return false;
  }
  return data === true;
}

/**
 * Has a Yooits admin approved this creator for tips? (Chris, 21 Nov: owner
 * approval first.) Fails closed like tipsAllowed.
 */
export async function tipsApproved(userId: string): Promise<boolean> {
  const client = supabaseAdmin as unknown as {
    rpc: (fn: string, args: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("tips_approved", { _user_id: userId });
  if (error) {
    console.error("[account-status] tips_approved", error.message);
    return false;
  }
  return data === true;
}
