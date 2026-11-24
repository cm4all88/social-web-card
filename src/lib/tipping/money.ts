/**
 * Tip amount rules. Pure functions, shared by the browser (for display) and
 * the server (the only place amounts are trusted). All amounts are integer
 * cents in USD.
 */

export const TIP_CURRENCY = "usd" as const;

/** Minimum tip the creator receives: $5.00. */
export const MIN_TIP_CENTS = 500;

/**
 * Maximum single tip: $500.00. A cap limits card-testing and stolen-card
 * exposure on a public, no-login checkout. Raise deliberately if creators ask.
 */
export const MAX_TIP_CENTS = 50_000;

/** Flat Yooits.me service fee added on top of the tip: $0.50. */
export const PLATFORM_FEE_CENTS = 50;

export const SUGGESTED_TIP_CENTS = [500, 1000, 2000, 5000] as const;

export type TipQuote = {
  tipCents: number;
  feeCents: number;
  totalCents: number;
};

export type TipValidation = { ok: true; quote: TipQuote } | { ok: false; error: string };

/** Validate a tip amount in cents and return the server-authoritative quote. */
export function quoteTip(tipCents: unknown): TipValidation {
  if (typeof tipCents !== "number" || !Number.isFinite(tipCents) || !Number.isInteger(tipCents)) {
    return { ok: false, error: "Enter a whole-cent amount." };
  }
  if (tipCents < MIN_TIP_CENTS) {
    return { ok: false, error: `The minimum tip is ${formatUsd(MIN_TIP_CENTS)}.` };
  }
  if (tipCents > MAX_TIP_CENTS) {
    return { ok: false, error: `The maximum tip is ${formatUsd(MAX_TIP_CENTS)}.` };
  }
  return {
    ok: true,
    quote: { tipCents, feeCents: PLATFORM_FEE_CENTS, totalCents: tipCents + PLATFORM_FEE_CENTS },
  };
}

/**
 * Parse a dollar amount typed by a visitor ("10", "10.5", "$12.00") into cents.
 * Returns null for anything that isn't a plain non-negative amount with at most
 * two decimals.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
