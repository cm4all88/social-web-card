/**
 * Turns the database's checkout gate (creator_subscription_checkout_gate)
 * into a checkout plan, or a message the subscriber can read. Pure, so the
 * money math and every refusal can be unit-tested.
 */
import { canAcceptTips } from "@/lib/tipping/account-status";
import { creatorFeeBreakdown, parseFeeRates, type FeeBreakdown } from "./fees";
import { subscriptionApplicationFee, type ApplicationFee } from "./subscription-checkout";

export class SubscriptionCheckoutError extends Error {}

export type SubscriptionCheckoutPlan = {
  creatorUserId: string;
  username: string;
  displayName: string;
  offerId: string;
  stripeAccountId: string;
  breakdown: FeeBreakdown;
  fee: ApplicationFee;
};

const MESSAGES: Record<string, string> = {
  off: "Subscriptions aren't available yet.",
  sign_in: "Sign in to subscribe.",
  not_allowed: "Your account can't subscribe right now.",
  unavailable: "This creator isn't taking subscriptions right now.",
  self: "You can't subscribe to yourself.",
  already_subscribed: "You're already subscribed.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
};

const fail = (reason: string): never => {
  throw new SubscriptionCheckoutError(MESSAGES[reason] ?? MESSAGES.unavailable);
};

export function planCreatorSubscriptionCheckout(
  raw: unknown,
  opts: { livemode: boolean },
): SubscriptionCheckoutPlan {
  const g = (raw ?? {}) as Record<string, unknown>;
  if (g.ok !== true) fail(typeof g.reason === "string" ? g.reason : "unavailable");

  const account = (g.account ?? null) as {
    stripe_account_id?: unknown;
    status?: unknown;
    charges_enabled?: unknown;
    livemode?: unknown;
  } | null;
  const stripeAccountId =
    typeof account?.stripe_account_id === "string" ? account.stripe_account_id : null;
  if (
    !account ||
    !stripeAccountId ||
    !canAcceptTips({
      status: String(account.status),
      charges_enabled: account.charges_enabled === true,
    }) ||
    account.livemode !== opts.livemode
  ) {
    fail("unavailable");
  }
  if (g.currency !== "usd") fail("unavailable");

  const breakdown = creatorFeeBreakdown(Number(g.price_cents), parseFeeRates(g.rates));
  if (!breakdown) fail("off");
  const fee = subscriptionApplicationFee(breakdown!);
  if (!fee) fail("off");

  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  const creatorUserId = str(g.creator_user_id);
  const username = str(g.username);
  const offerId = str(g.offer_id);
  if (!creatorUserId || !username || !offerId) fail("unavailable");

  return {
    creatorUserId: creatorUserId!,
    username: username!,
    displayName: str(g.display_name) ?? username!,
    offerId: offerId!,
    stripeAccountId: stripeAccountId!,
    breakdown: breakdown!,
    fee: fee!,
  };
}
