/**
 * Self-serve account deletion.
 *
 * Removes the person's page and everything on it, then their sign-in. Most
 * tables have no foreign key to auth.users, so each is cleared explicitly.
 * Kept on purpose:
 *  - tips and creator_payment_accounts: payment records that tax and payment
 *    rules require us to keep (see the Privacy Policy draft);
 *  - plus_subscriptions and billing_customers: Plus payment records, kept
 *    with no account attached (their user_id is cleared by foreign key);
 *  - admin_audit_log: append-only by design.
 * Admin accounts and suspended accounts can't delete themselves here: an admin
 * must hand over admin first, and a suspension is resolved with Yooits.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export class AccountDeletionRefused extends Error {}

/** Tables cleared for the user, in this order (children before parents). */
export const DELETED_TABLES = [
  "wishlist_items",
  "wishlists",
  "social_links",
  "tip_settings",
  "account_status",
  "profiles",
] as const;

export const KEPT_TABLES = [
  "tips",
  "creator_payment_accounts",
  "plus_subscriptions",
  "billing_customers",
  "admin_audit_log",
] as const;

/** Subscription states that are still running (or could still charge). */
const RUNNING = ["trialing", "active", "past_due", "unpaid", "incomplete", "paused"];

export async function deleteAccount(
  admin: SupabaseClient,
  userId: string,
  confirmUsername: string,
): Promise<void> {
  const [
    { data: profile, error: pErr },
    { data: roles, error: rErr },
    { data: status, error: sErr },
    { data: subs, error: bErr },
  ] = await Promise.all([
    admin.from("profiles").select("username").eq("user_id", userId).maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("account_status").select("suspended_at").eq("user_id", userId).maybeSingle(),
    admin.from("plus_subscriptions").select("status").eq("user_id", userId),
  ]);
  if (pErr || rErr || sErr || bErr) throw pErr ?? rErr ?? sErr ?? bErr;

  // With no profile left (an earlier attempt stopped part-way), there is no
  // username to type, so any confirmation finishes the job.
  const username = (profile as { username?: string } | null)?.username ?? null;
  const confirmed =
    username === null
      ? confirmUsername.trim().length > 0
      : confirmUsername.trim().toLowerCase() === username.toLowerCase();
  if (!confirmed) {
    throw new AccountDeletionRefused("Type your username exactly to confirm.");
  }
  if ((roles as { role: string }[] | null)?.some((r) => r.role === "admin")) {
    throw new AccountDeletionRefused(
      "Admin accounts can't be deleted here. Give admin access to someone else first.",
    );
  }
  if ((status as { suspended_at?: string | null } | null)?.suspended_at) {
    throw new AccountDeletionRefused("This account is suspended. Contact Yooits to close it.");
  }

  if ((subs as { status: string }[] | null)?.some((x) => RUNNING.includes(x.status))) {
    throw new AccountDeletionRefused(
      "You still have a Plus subscription. Cancel Plus first; you can delete your account once it has ended.",
    );
  }

  // Avatar files live under "<userId>/" in the avatars bucket.
  const { data: files, error: lErr } = await admin.storage.from("avatars").list(userId, { limit: 1000 });
  if (lErr) throw lErr;
  if (files && files.length > 0) {
    const { error } = await admin.storage
      .from("avatars")
      .remove(files.map((f) => `${userId}/${f.name}`));
    if (error) throw error;
  }

  for (const table of DELETED_TABLES) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) throw error;
  }

  // Last: the sign-in itself (user_roles goes with it by foreign key).
  const { error: aErr } = await admin.auth.admin.deleteUser(userId);
  if (aErr) throw aErr;
}
