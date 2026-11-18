/**
 * Server-only tipping configuration. Read from environment variables at
 * request time (Cloudflare Workers expose them on process.env with
 * nodejs_compat).
 *
 * Safety rails:
 *  - Tipping is OFF unless TIPPING_ENABLED=true.
 *  - Only Stripe TEST keys are accepted unless STRIPE_LIVE_MODE_APPROVED=true.
 *    Flipping that flag is a deliberate production decision for the owner.
 */

export class TippingUnavailableError extends Error {
  constructor(message = "Tipping is not available right now.") {
    super(message);
  }
}

export type TippingConfig = {
  secretKey: string;
  webhookSecrets: string[];
  liveModeAllowed: boolean;
  siteUrl: string | null;
  ipHashSalt: string;
};

const env = (name: string): string | undefined => {
  const v = typeof process !== "undefined" ? process.env?.[name] : undefined;
  return v && v.trim().length > 0 ? v.trim() : undefined;
};

export function isTippingEnabled(): boolean {
  return env("TIPPING_ENABLED") === "true";
}

export function isLiveKey(key: string): boolean {
  return key.startsWith("sk_live_") || key.startsWith("rk_live_");
}

export function isTestKey(key: string): boolean {
  return key.startsWith("sk_test_") || key.startsWith("rk_test_");
}

/** Returns config or throws TippingUnavailableError (never leaks key material). */
export function getTippingConfig(): TippingConfig {
  if (!isTippingEnabled()) throw new TippingUnavailableError();

  const secretKey = env("STRIPE_SECRET_KEY");
  if (!secretKey) throw new TippingUnavailableError("Payments are not configured.");

  const liveModeAllowed = env("STRIPE_LIVE_MODE_APPROVED") === "true";
  if (isLiveKey(secretKey) && !liveModeAllowed) {
    throw new TippingUnavailableError("Live payments are not approved.");
  }
  if (!isLiveKey(secretKey) && !isTestKey(secretKey)) {
    throw new TippingUnavailableError("Payments are misconfigured.");
  }

  const webhookSecrets = [
    env("STRIPE_WEBHOOK_SECRET"),
    env("STRIPE_CONNECT_WEBHOOK_SECRET"),
  ].filter((s): s is string => !!s);

  return {
    secretKey,
    webhookSecrets,
    liveModeAllowed,
    siteUrl: env("PUBLIC_SITE_URL")?.replace(/\/+$/, "") ?? null,
    ipHashSalt: env("TIP_IP_HASH_SALT") ?? secretKey,
  };
}
