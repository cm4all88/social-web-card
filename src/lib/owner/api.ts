/**
 * Typed calls for the owner console's database functions. Every function
 * checks has_role(admin) inside the database, so these are safe to call from
 * the browser; a non-admin gets error code 42501.
 *
 * The generated Supabase types don't know these functions yet (they come from
 * migration 20261118210000_owner_console.sql), so the call is typed here
 * rather than by editing the generated types file.
 */
import { supabase } from "@/integrations/supabase/client";

export type OwnerOverview = {
  total_users: number;
  signups_7d: number;
  signups_30d: number;
  unconfirmed_emails: number;
  profiles_with_links: number;
  admins: number;
  open_invites: number;
  connected_creators: number;
  tipping_suspended: number;
  public_wishlists: number;
  unpublished: number;
  suspended: number;
};

export type AccountStatus = {
  unpublished_at: string | null;
  unpublished_reason: string | null;
  unpublished_by: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  suspended_by: string | null;
  tips_disabled_at: string | null;
  tips_disabled_reason: string | null;
  tips_disabled_by: string | null;
};

export type OwnerUserRow = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  link_count: number;
  is_admin: boolean;
  unpublished: boolean;
  suspended: boolean;
  tips_disabled: boolean;
  total_count: number;
};

export type OwnerUserDetail = {
  user_id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  is_self: boolean;
  status: AccountStatus | null;
  profile: {
    username: string;
    display_name: string | null;
    bio: string | null;
    avatar_url: string | null;
    theme: string | null;
  } | null;
  roles: string[];
  links: { platform: string; url: string; enabled: boolean }[];
  wishlists: number;
  tipping: {
    status: string;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    suspended_at: string | null;
    suspended_reason: string | null;
  } | null;
};

export type AuditEntry = {
  id: number;
  created_at: string;
  actor_user_id: string | null;
  actor_username: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  target_username: string | null;
  details: Record<string, unknown>;
};

type OwnerFunctions = {
  owner_overview: { args: Record<string, never>; result: OwnerOverview };
  owner_list_users: {
    args: { _search?: string | null; _limit?: number; _offset?: number };
    result: OwnerUserRow[];
  };
  owner_get_user: { args: { _user_id: string }; result: OwnerUserDetail | null };
  owner_audit_log: { args: { _limit?: number; _before_id?: number | null }; result: AuditEntry[] };
  owner_set_unpublished: { args: { _user_id: string; _unpublished: boolean; _reason?: string | null }; result: boolean };
  owner_set_suspended: { args: { _user_id: string; _suspended: boolean; _reason?: string | null }; result: boolean };
  owner_set_tips_disabled: { args: { _user_id: string; _disabled: boolean; _reason?: string | null }; result: boolean };
};

export class OwnerAccessError extends Error {}

export async function ownerRpc<K extends keyof OwnerFunctions>(
  fn: K,
  args: OwnerFunctions[K]["args"],
): Promise<OwnerFunctions[K]["result"]> {
  // Called as a method so the client keeps its `this`.
  const client = supabase as unknown as {
    rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
  };
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    if (error.code === "42501") {
      // The database says why (e.g. "You can't suspend your own account.").
      throw new OwnerAccessError(
        /^Not authorized/.test(error.message) ? "Only Yooits admins can do this." : error.message,
      );
    }
    throw new Error(error.message);
  }
  return data as OwnerFunctions[K]["result"];
}

/** Plain-language labels for audit log actions. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "role.granted": "Admin access granted",
  "role.revoked": "Admin access removed",
  "role.changed": "Admin role changed",
  "invite.created": "Invite code created",
  "invite.revoked": "Invite code revoked",
  "tipping.suspended": "Tips stopped",
  "tipping.restored": "Tips restored",
  "account.unpublished": "Page unpublished",
  "account.republished": "Page republished",
  "account.suspended": "Account suspended",
  "account.reactivated": "Account reactivated",
};

export function auditLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
