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

/**
 * Returns true when the caller is over a limit; otherwise records the attempt.
 * The check and the insert happen in one database call that holds per-creator
 * and per-IP locks (see record_checkout_attempt), so concurrent requests can't
 * slip past the limit.
 */
export async function checkAndRecordAttempt(opts: {
  ipHash: string;
  creatorUserId: string;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("record_checkout_attempt", {
    _ip_hash: opts.ipHash,
    _creator_user_id: opts.creatorUserId,
    _ip_limit: IP_LIMIT_PER_10_MIN,
    _ip_window_seconds: 10 * 60,
    _creator_limit: CREATOR_LIMIT_PER_HOUR,
    _creator_window_seconds: 60 * 60,
  });
  if (error) throw error;
  return data !== true;
}
