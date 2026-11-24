import Stripe from "stripe";
import { getTippingConfig } from "./config.server";

let cached: { key: string; client: Stripe } | undefined;

/**
 * Stripe client for the Cloudflare Workers runtime (fetch-based HTTP client).
 * The API version is the one pinned by the installed stripe package.
 */
export function getStripe(): Stripe {
  const { secretKey } = getTippingConfig();
  if (cached && cached.key === secretKey) return cached.client;
  const client = new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    appInfo: { name: "Yooits.me" },
  });
  cached = { key: secretKey, client };
  return client;
}
