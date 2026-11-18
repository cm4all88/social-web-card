import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Checkout attempts allowed per visitor IP in 10 minutes. */
export const IP_LIMIT_PER_10_MIN = 10;
/** Checkout attempts allowed per creator in one hour (all visitors). */
export const CREATOR_LIMIT_PER_HOUR = 120;

/** Salted SHA-256 of the IP so we never store the address itself. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns true when the caller is over a limit; otherwise records the attempt. */
export async function checkAndRecordAttempt(opts: {
  ipHash: string;
  creatorUserId: string;
}): Promise<boolean> {
  const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();

  const [byIp, byCreator] = await Promise.all([
    supabaseAdmin
      .from("checkout_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", opts.ipHash)
      .gte("created_at", tenMinAgo),
    supabaseAdmin
      .from("checkout_attempts")
      .select("id", { count: "exact", head: true })
      .eq("creator_user_id", opts.creatorUserId)
      .gte("created_at", hourAgo),
  ]);
  if (byIp.error || byCreator.error) throw byIp.error ?? byCreator.error;
  if (
    (byIp.count ?? 0) >= IP_LIMIT_PER_10_MIN ||
    (byCreator.count ?? 0) >= CREATOR_LIMIT_PER_HOUR
  ) {
    return true;
  }
  const { error } = await supabaseAdmin
    .from("checkout_attempts")
    .insert({ ip_hash: opts.ipHash, creator_user_id: opts.creatorUserId });
  if (error) throw error;
  return false;
}
