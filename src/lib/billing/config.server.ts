/**
 * Server-only settings for Yooits Plus billing (Stripe Billing on Yooits' own
 * Stripe account). Separate from tipping: turning one on never turns on the
 * other, and the creator tipping settings are not read here except for the
 * shared Stripe key.
 *
 * Switches, all off unless set to "true" in Vercel by hand:
 *  - PLUS_BILLING_ENABLED: webhooks, the billing portal and cancelling work,
 *    so existing subscribers are looked after.
 *  - PLUS_CHECKOUT_ENABLED: new people can start paying. Needs the one above.
 *  - PLUS_LIVE_MODE_APPROVED: a LIVE Stripe key is accepted for billing.
 *    Without it only TEST keys work. Deploys never set any of these.
 *  - On a Vercel production deployment (yooits.me) a TEST key also keeps
 *    billing off unless STRIPE_TEST_MODE_ON_PRODUCTION=true.
 */

export class BillingUnavailableError extends Error {
  constructor(message = "Plus isn't available to buy right now.") {
    super(message);
  }
}

export type BillingConfig = {
  secretKey: string;
  webhookSecret: string | null;
  liveModeAllowed: boolean;
  checkoutOpen: boolean;
  siteUrl: string | null;
  priceId: string | null;
  portalConfigurationId: string | null;
};

const env = (name: string): string | undefined => {
  const v = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return v && v.trim().length > 0 ? v.trim() : undefined;
};

const isLiveKey = (k: string) => k.startsWith("sk_live_") || k.startsWith("rk_live_");
const isTestKey = (k: string) => k.startsWith("sk_test_") || k.startsWith("rk_test_");

export function isBillingEnabled(): boolean {
  return env("PLUS_BILLING_ENABLED") === "true";
}

/** Returns the config or throws BillingUnavailableError (never leaks key material). */
export function getBillingConfig(): BillingConfig {
  if (!isBillingEnabled()) throw new BillingUnavailableError();
  const secretKey = env("STRIPE_SECRET_KEY");
  if (!secretKey) throw new BillingUnavailableError();
  const liveModeAllowed = env("PLUS_LIVE_MODE_APPROVED") === "true";
  if (isLiveKey(secretKey) && !liveModeAllowed) throw new BillingUnavailableError();
  if (!isLiveKey(secretKey) && !isTestKey(secretKey)) throw new BillingUnavailableError();
  if (
    isTestKey(secretKey) &&
    env("VERCEL_ENV") === "production" &&
    env("STRIPE_TEST_MODE_ON_PRODUCTION") !== "true"
  ) {
    throw new BillingUnavailableError();
  }
  return {
    secretKey,
    webhookSecret: env("STRIPE_BILLING_WEBHOOK_SECRET") ?? null,
    liveModeAllowed,
    checkoutOpen: env("PLUS_CHECKOUT_ENABLED") === "true",
    siteUrl: env("PUBLIC_SITE_URL")?.replace(/\/+$/, "") ?? null,
    priceId: env("STRIPE_PLUS_PRICE_ID") ?? null,
    portalConfigurationId: env("STRIPE_PORTAL_CONFIGURATION_ID") ?? null,
  };
}

export function billingConfigOrNull(): BillingConfig | null {
  try {
    return getBillingConfig();
  } catch {
    return null;
  }
}
