/** Connected-account states shown to creators. */
export type PaymentAccountStatus =
  | "not_started"
  | "pending"
  | "restricted"
  | "connected"
  | "disconnected";

/** Minimal slice of a Stripe Account object that decides tipping eligibility. */
export type StripeAccountLike = {
  id: string;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  details_submitted?: boolean | null;
  country?: string | null;
  default_currency?: string | null;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[] | null;
    past_due?: string[] | null;
  } | null;
};

export type AccountSnapshot = {
  status: Exclude<PaymentAccountStatus, "not_started" | "disconnected">;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  disabled_reason: string | null;
  requirements_due_count: number;
  country: string | null;
  default_currency: string | null;
};

/**
 * Map a Stripe account to a Yooits status.
 *  - connected:  Stripe says it can accept charges and nothing disables it.
 *  - restricted: onboarding was submitted but Stripe has disabled charges or
 *                needs more information.
 *  - pending:    onboarding not finished yet.
 */
export function snapshotAccount(account: StripeAccountLike): AccountSnapshot {
  const charges = account.charges_enabled === true;
  const payouts = account.payouts_enabled === true;
  const submitted = account.details_submitted === true;
  const disabledReason = account.requirements?.disabled_reason ?? null;
  const due = new Set([
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? []),
  ]);

  let status: AccountSnapshot["status"];
  if (charges && submitted && !disabledReason) status = "connected";
  else if (submitted || disabledReason) status = "restricted";
  else status = "pending";

  return {
    status,
    charges_enabled: charges,
    payouts_enabled: payouts,
    details_submitted: submitted,
    disabled_reason: disabledReason,
    requirements_due_count: due.size,
    country: account.country ?? null,
    default_currency: account.default_currency ?? null,
  };
}

/** A creator may receive tips only when their account is fully connected. */
export function canAcceptTips(
  row: { status: string; charges_enabled: boolean } | null | undefined,
): boolean {
  return !!row && row.status === "connected" && row.charges_enabled;
}
