/**
 * Typed calls for the Founding Members database functions (migration
 * 20261121230000_founding_creator_beta.sql). Owner functions check
 * has_role(admin) inside the database and write the audit log, so these are
 * safe from the browser; a non-admin gets error code 42501.
 */
import { supabase } from "@/integrations/supabase/client";
import { OwnerAccessError } from "@/lib/owner/api";
import type { BetaCodeState } from "./invite";

export type BetaOverview = {
  name: string;
  open: boolean;
  max_seats: number;
  plus_months: number;
  default_code_days: number;
  codes_created: number;
  codes_open: number;
  codes_redeemed: number;
  codes_expired: number;
  codes_revoked: number;
  signups: number;
  existing_redeemed: number;
  plus_now: number;
  active_14d: number;
  grants_revoked: number;
  seats_left: number;
  feedback: number;
};

export type BetaChannel = "email" | "dm" | "in_person" | "other";

export type BetaInviteRow = {
  id: string;
  code: string;
  label: string | null;
  channel: BetaChannel | null;
  status: "open" | "redeemed" | "expired" | "revoked";
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  used_at: string | null;
  used_by: string | null;
  used_by_username: string | null;
};

export type BetaMemberRow = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  via_signup: boolean;
  joined_at: string;
  redeemed_at: string;
  ends_at: string;
  status: "active" | "quiet" | "ended" | "revoked";
  revoked_reason: string | null;
  last_sign_in_at: string | null;
  link_count: number;
  feedback_count: number;
  invite_label: string | null;
};

export type BetaFeedbackRow = {
  id: number;
  created_at: string;
  user_id: string;
  username: string | null;
  in_beta: boolean;
  rating: number | null;
  message: string;
};

export type OwnEntitlement = { plan: string; ends_at: string; revoked_at: string | null };

type BetaFunctions = {
  owner_beta_overview: { args: Record<string, never>; result: BetaOverview };
  owner_beta_create_invites: {
    args: {
      _count: number;
      _label?: string | null;
      _channel?: BetaChannel | null;
      _days?: number | null;
    };
    result: { id: string; code: string; expires_at: string }[];
  };
  owner_beta_list_invites: { args: { _limit?: number; _offset?: number }; result: BetaInviteRow[] };
  owner_beta_revoke_invite: { args: { _invite_id: string; _reason: string }; result: boolean };
  owner_beta_list_members: { args: { _limit?: number; _offset?: number }; result: BetaMemberRow[] };
  owner_beta_revoke_grant: { args: { _user_id: string; _reason: string }; result: boolean };
  owner_beta_list_feedback: {
    args: { _limit?: number; _before_id?: number | null };
    result: BetaFeedbackRow[];
  };
  owner_beta_set_open: { args: { _open: boolean }; result: boolean };
  beta_code_state: { args: { _code: string }; result: BetaCodeState };
  redeem_beta_invite: { args: { _code: string }; result: BetaCodeState };
};

type LooseClient = {
  rpc: (
    f: string,
    a: object,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
  from: (t: string) => ReturnType<typeof supabase.from>;
};
// Not in the generated types yet; called as methods so the client keeps its `this`.
const client = supabase as unknown as LooseClient;

export async function betaRpc<K extends keyof BetaFunctions>(
  fn: K,
  args: BetaFunctions[K]["args"],
): Promise<BetaFunctions[K]["result"]> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    if (error.code === "42501") {
      throw new OwnerAccessError(
        /^Not authorized/.test(error.message) ? "Only Yooits admins can do this." : error.message,
      );
    }
    throw new Error(error.message);
  }
  return data as BetaFunctions[K]["result"];
}

/** The signed-in person's own founding grant, if any (RLS shows only theirs). */
export async function loadOwnEntitlement(userId: string): Promise<OwnEntitlement | null> {
  const { data } = await client
    .from("plan_entitlements")
    .select("plan, ends_at, revoked_at")
    .eq("user_id", userId)
    .eq("source", "founding_creator")
    .maybeSingle();
  return (data as OwnEntitlement | null) ?? null;
}

export async function sendFeedback(rating: number | null, message: string): Promise<void> {
  const { error } = await client.from("beta_feedback").insert({ rating, message } as never);
  if (error) throw new Error(error.message);
}
