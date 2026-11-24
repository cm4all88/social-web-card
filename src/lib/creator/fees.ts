/**
 * Creator subscription fee math. Creators keep 100% of the price they set;
 * the buyer pays the price plus a service and processing fee that covers
 * Yooits.me's share and the card processor's fee.
 *
 * Rates come from the owner console (creator_subscription_settings). They are
 * unset until the owner chooses them, and with no rates there is no fee to
 * show, so nothing can be sold. Any checkout must call this on the server;
 * a total shown in the browser is only a preview.
 */

export type FeeRates = {
  yooits_percent_bps: number;
  yooits_fixed_cents: number;
  stripe_percent_bps: number;
  stripe_fixed_cents: number;
};

export type FeeBreakdown = {
  /** What the creator set and keeps. */
  creatorPrice: number;
  /** Service and processing fee added to the buyer's total. */
  serviceFee: number;
  /** What the buyer is charged each month, before any tax. */
  total: number;
  /** The processor's estimated cut of the total. */
  estimatedProcessingFee: number;
  /** What's left for Yooits.me after the processor's fee. */
  yooitsNet: number;
};

const bps = (cents: number, rate: number) => Math.round((cents * rate) / 10_000);

const valid = (n: unknown, max: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;

/** Reads the fee rates the database sends, or null if any is unset or broken. */
export function parseFeeRates(raw: unknown): FeeRates | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    !valid(r.yooits_percent_bps, 5000) ||
    !valid(r.yooits_fixed_cents, 10_000) ||
    !valid(r.stripe_percent_bps, 2000) ||
    !valid(r.stripe_fixed_cents, 1000)
  ) {
    return null;
  }
  return {
    yooits_percent_bps: r.yooits_percent_bps,
    yooits_fixed_cents: r.yooits_fixed_cents,
    stripe_percent_bps: r.stripe_percent_bps,
    stripe_fixed_cents: r.stripe_fixed_cents,
  };
}

/**
 * The smallest total for which the creator gets their whole price and Yooits.me
 * gets its share after the processor's fee. Returns null for a bad price or
 * missing rates.
 */
export function creatorFeeBreakdown(
  priceCents: number,
  rates: FeeRates | null,
): FeeBreakdown | null {
  if (!rates || !Number.isInteger(priceCents) || priceCents <= 0) return null;
  const yooitsTarget = bps(priceCents, rates.yooits_percent_bps) + rates.yooits_fixed_cents;
  const processing = (total: number) =>
    bps(total, rates.stripe_percent_bps) + rates.stripe_fixed_cents;
  const covers = (total: number) => total - processing(total) - priceCents >= yooitsTarget;
  const pct = rates.stripe_percent_bps / 10_000;
  let total = Math.ceil((priceCents + yooitsTarget + rates.stripe_fixed_cents) / (1 - pct));
  // Rounding can leave a cent either way: settle on the smallest total that works.
  while (total - 1 >= priceCents && covers(total - 1)) total -= 1;
  while (!covers(total)) total += 1;
  const estimatedProcessingFee = processing(total);
  return {
    creatorPrice: priceCents,
    serviceFee: total - priceCents,
    total,
    estimatedProcessingFee,
    yooitsNet: total - priceCents - estimatedProcessingFee,
  };
}

export const formatCents = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
