/**
 * Yooits.me Plus: what it costs and what a Stripe subscription means for a
 * creator's plan. No network here, so it can be tested on its own.
 */

/** $4.99 a month, US dollars. Checkout refuses any Stripe price that differs. */
export const PLUS_PRICE_CENTS = 499;
export const PLUS_CURRENCY = "usd";
export const PLUS_INTERVAL = "month";
/** Stripe Price lookup key for the Plus monthly price. */
export const PLUS_PRICE_LOOKUP_KEY = "yooits_plus_monthly";
/** Set on every Plus checkout and subscription, so webhooks only touch our own. */
export const PLUS_METADATA_KEY = "yooits_product";
export const PLUS_METADATA_VALUE = "plus";

export const PLUS_PRICE_LABEL = "$4.99 a month";

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

const STATUSES: readonly SubscriptionStatus[] = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
];

export function isSubscriptionStatus(v: unknown): v is SubscriptionStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

/** Mirrors public.plus_status_is_active(): these keep Plus on. */
export function statusKeepsPlus(s: SubscriptionStatus): boolean {
  return s === "active" || s === "trialing" || s === "past_due";
}

/** A subscription that blocks starting another checkout (one Plus at a time). */
export function statusBlocksNewCheckout(s: SubscriptionStatus): boolean {
  return s !== "canceled" && s !== "incomplete_expired";
}

/** The price must be exactly Plus: $4.99, USD, monthly, one unit, active. */
export function priceIsPlus(p: {
  active?: boolean | null;
  unit_amount?: number | null;
  currency?: string | null;
  recurring?: { interval?: string | null; interval_count?: number | null } | null;
  type?: string | null;
}): boolean {
  return (
    p.active === true &&
    p.type === "recurring" &&
    p.unit_amount === PLUS_PRICE_CENTS &&
    p.currency === PLUS_CURRENCY &&
    p.recurring?.interval === PLUS_INTERVAL &&
    (p.recurring?.interval_count ?? 1) === 1
  );
}

/**
 * For a Founding Member who chooses to keep Plus after their free months:
 * the first charge waits until the free months end. Stripe Checkout needs a
 * trial end at least 48 hours away, so a grant ending sooner than that (plus
 * a margin) gets no trial and they are charged when they subscribe.
 * Returns a Unix timestamp in seconds, or null.
 */
export function founderTrialEnd(grantEndsAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!grantEndsAt) return null;
  const ends = new Date(grantEndsAt).getTime();
  if (!Number.isFinite(ends)) return null;
  const minimum = now.getTime() + 50 * 60 * 60 * 1000;
  if (ends < minimum) return null;
  return Math.floor(ends / 1000);
}

/** "March 3, 2027" */
export function formatPlusDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
