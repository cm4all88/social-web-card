/** Browser side of share counting. Fire-and-forget, and silent for Do Not Track. */
import { browserOptedOut } from "@/lib/analytics/track";
import { trackShare } from "@/lib/analytics/functions";
import { supabase } from "@/integrations/supabase/client";
import type { ShareChannel } from "./links";

export function recordShare(username: string, channel: ShareChannel): void {
  if (browserOptedOut()) return;
  try {
    void trackShare({ data: { username, channel } }).catch(() => {});
  } catch {
    // never let counting break a share
  }
}

export type MyShareStats = {
  enabled: boolean;
  days: number;
  shares: number;
  my_shares: number;
  share_visits: number;
  referred_signups: number;
};

export type OwnerShareStats = {
  enabled: boolean;
  days: number;
  since: string;
  shares: number;
  owner_shares: number;
  visitor_shares: number;
  profiles_shared: number;
  share_visits: number;
  referred_signups: number;
  channels: { channel: string; shares: number }[];
  pages: { username: string; shares: number; owner_shares: number; admin: boolean }[];
};

type Rpc = (
  f: string,
  a: object,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const rpc = (f: string, a: object) => (supabase as unknown as { rpc: Rpc }).rpc(f, a);

export async function loadMyShareStats(days = 30): Promise<MyShareStats | null> {
  const { data, error } = await rpc("my_share_stats", { _days: days });
  if (error) return null;
  return data as MyShareStats;
}

export async function loadOwnerShareStats(days: number): Promise<OwnerShareStats> {
  const { data, error } = await rpc("owner_share_stats", { _days: days });
  if (error) throw new Error(error.message);
  return data as OwnerShareStats;
}
