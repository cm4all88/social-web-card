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
  tips_approved_at?: string | null;
  tips_approval_note?: string | null;
  tips_approved_by?: string | null;
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

export type AbuseReport = {
  id: string;
  created_at: string;
  status: "open" | "resolved" | "dismissed";
  reason: string;
  details: string | null;
  target_kind: "profile" | "wishlist" | "message";
  target_user_id: string;
  target_username: string | null;
  wishlist_slug: string | null;
  wishlist_title: string | null;
  reporter_user_id: string | null;
  reporter_username: string | null;
  reporter_contact: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  message_id?: string | null;
  message_excerpt?: string | null;
  message_removed?: boolean;
  target_messaging_suspended?: boolean;
};

export type MessagingStatus = {
  enabled: boolean;
  people_with_messages_on: number;
  conversations: number;
  messages_7d: number;
  suspended: number;
  open_message_reports: number;
};

export type UserMessaging = {
  mode: "off" | "requests" | "everyone";
  suspended: boolean;
  suspended_reason: string | null;
  messages_sent_7d: number;
  reports_about: number;
};

export type OwnerCreatorMilestone = {
  key: string;
  threshold: number;
  title: string;
  unlocks: string;
  kind: string;
  live: boolean;
  sort: number;
  updated_at: string;
};

export type OwnerCreatorSubscriptionSettings = {
  enabled: boolean;
  checkout_enabled: boolean;
  price_min_cents: number;
  price_max_cents: number;
  yooits_percent_bps: number | null;
  yooits_fixed_cents: number | null;
  stripe_percent_bps: number | null;
  stripe_fixed_cents: number | null;
  updated_at: string;
};

export type OwnerCreatorApplication = {
  id: string;
  user_id: string;
  username: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  about: string;
  content_types: string[];
  qualifying_visitors: number;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

export type OwnerCreatorSubscriptions = {
  settings: OwnerCreatorSubscriptionSettings;
  applications: OwnerCreatorApplication[];
  creators: {
    user_id: string;
    username: string | null;
    approved_at: string;
    suspended: boolean;
    suspended_reason: string | null;
    posts: number;
    subscribers: number;
  }[];
  offers: {
    id: string;
    user_id: string;
    username: string | null;
    version: number;
    price_cents: number;
    description: string;
    status: "pending" | "approved" | "rejected";
    created_at: string;
    decision_note: string | null;
  }[];
  posts: {
    id: string;
    user_id: string;
    username: string | null;
    visibility: "public" | "subscribers";
    title: string;
    body: string;
    preview: string | null;
    media_count: number;
    created_at: string;
    removed: boolean;
    removed_reason: string | null;
  }[];
};

export type OwnerSupportOfferingSettings = {
  enabled: boolean;
  checkout_enabled: boolean;
  price_min_cents: number;
  price_max_cents: number;
  updated_at: string;
};

export type OwnerSupportVersion = {
  id: string;
  version: number;
  kind: "download" | "digital_card" | "reader_pack" | "exclusive_post";
  title: string;
  description: string;
  what_you_get: string;
  min_price_cents: number;
  allow_pay_more: boolean;
  file_name: string | null;
  file_path: string | null;
  content_body: string | null;
  status: "pending" | "approved" | "rejected" | "retired" | "withdrawn";
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

export type OwnerSupportOfferings = {
  settings: OwnerSupportOfferingSettings;
  offerings: {
    id: string;
    user_id: string;
    username: string | null;
    created_at: string;
    archived: boolean;
    suspended: boolean;
    suspended_reason: string | null;
    versions: OwnerSupportVersion[] | null;
  }[];
};

export type OwnerCreatorEarnings = {
  settings: {
    enabled: boolean;
    suspicious_pages_per_day: number;
    suspicious_events_per_day: number;
    updated_at: string;
  };
  milestones: OwnerCreatorMilestone[];
  top_creators: { user_id: string; username: string; qualifying_visitors: number }[];
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
  owner_set_tips_approved: { args: { _user_id: string; _approved: boolean; _note?: string | null }; result: boolean };
  owner_list_reports: { args: { _status?: "open" | "resolved" | "dismissed" | "all" }; result: AbuseReport[] };
  owner_resolve_report: {
    args: { _id: string; _status: "open" | "resolved" | "dismissed"; _note?: string | null };
    result: string;
  };
  owner_open_report_count: { args: Record<string, never>; result: number };
  owner_messaging_status: { args: Record<string, never>; result: MessagingStatus };
  owner_set_messaging_enabled: { args: { _enabled: boolean }; result: boolean };
  owner_remove_message: { args: { _message_id: string; _reason?: string | null }; result: boolean };
  owner_set_messaging_suspended: {
    args: { _user_id: string; _suspended: boolean; _reason?: string | null };
    result: boolean;
  };
  owner_user_messaging: { args: { _user_id: string }; result: UserMessaging };
  owner_creator_earnings: { args: Record<string, never>; result: OwnerCreatorEarnings };
  owner_set_creator_earnings: {
    args: {
      _enabled: boolean | null;
      _suspicious_pages_per_day?: number | null;
      _suspicious_events_per_day?: number | null;
    };
    result: boolean;
  };
  owner_set_creator_milestone: {
    args: { _key: string; _threshold: number; _title: string; _unlocks: string; _live: boolean };
    result: boolean;
  };
  owner_creator_subscriptions: { args: Record<string, never>; result: OwnerCreatorSubscriptions };
  owner_set_creator_subscription_settings: {
    args: {
      _enabled: boolean | null;
      _price_min_cents: number | null;
      _price_max_cents: number | null;
      _yooits_percent_bps: number | null;
      _yooits_fixed_cents: number | null;
      _stripe_percent_bps: number | null;
      _stripe_fixed_cents: number | null;
    };
    result: OwnerCreatorSubscriptionSettings;
  };
  owner_decide_creator_application: {
    args: { _id: string; _approve: boolean; _note?: string | null };
    result: string;
  };
  owner_decide_creator_offer: {
    args: { _id: string; _approve: boolean; _note?: string | null };
    result: string;
  };
  owner_set_creator_monetization_suspended: {
    args: { _user_id: string; _suspended: boolean; _reason?: string | null };
    result: boolean;
  };
  owner_remove_creator_post: {
    args: { _id: string; _removed: boolean; _reason?: string | null };
    result: boolean;
  };
  owner_support_offerings: { args: Record<string, never>; result: OwnerSupportOfferings };
  owner_set_support_offering_settings: {
    args: { _enabled: boolean | null; _price_min_cents: number | null; _price_max_cents: number | null };
    result: OwnerSupportOfferingSettings;
  };
  owner_decide_support_version: {
    args: { _id: string; _approve: boolean; _note?: string | null };
    result: string;
  };
  owner_set_support_offering_suspended: {
    args: { _offering_id: string; _suspended: boolean; _reason?: string | null };
    result: boolean;
  };
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
  "tipping.approved": "Tips approved",
  "tipping.approval_revoked": "Tips approval withdrawn",
  "account.unpublished": "Page unpublished",
  "account.republished": "Page republished",
  "account.suspended": "Account suspended",
  "account.reactivated": "Account reactivated",
  "beta.codes_created": "Founding Member invites created",
  "beta.code_revoked": "Founding Member invite revoked",
  "beta.redeemed": "Became a Founding Member",
  "beta.program_opened": "Founding Member invites turned on",
  "beta.program_closed": "Founding Member invites turned off",
  "beta.grant_revoked": "Founding Plus ended early",
  "report.resolved": "Report resolved",
  "report.dismissed": "Report dismissed",
  "report.reopened": "Report reopened",
  "messaging.enabled": "Messages turned on for everyone",
  "messaging.disabled": "Messages turned off for everyone",
  "messaging.suspended": "Messaging suspended for a person",
  "messaging.unsuspended": "Messaging restored for a person",
  "message.removed": "Message removed",
  "announcement.created": "Announcement created",
  "announcement.edited": "Announcement edited",
  "announcement.archived": "Announcement archived",
  "announcement.restored": "Announcement restored",
  "feature_flag.enabled": "Feature switched on",
  "feature_flag.disabled": "Feature switched off",
  "creator_earnings.settings": "Creator earnings settings changed",
  "creator_earnings.milestone": "Creator milestone changed",
  "creator_subscriptions.settings": "Creator subscription settings changed",
  "creator.application_approved": "Creator application approved",
  "creator.application_rejected": "Creator application rejected",
  "creator.offer_approved": "Creator subscription price approved",
  "creator.offer_rejected": "Creator subscription price rejected",
  "creator.monetization_suspended": "Creator subscriptions paused",
  "creator.monetization_restored": "Creator subscriptions restored",
  "creator.post_removed": "Creator post removed",
  "creator.post_restored": "Creator post restored",
  "support_offerings.settings": "Support Offerings settings changed",
  "support.version_approved": "Support offering approved",
  "support.version_rejected": "Support offering rejected",
  "support.offering_suspended": "Support offering paused",
  "support.offering_restored": "Support offering restored",
};

export function auditLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
