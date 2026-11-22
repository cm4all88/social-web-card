import Stripe from "stripe";
import { getBillingConfig } from "./config.server";

let cached: { key: string; client: Stripe } | undefined;

/** Stripe client for Plus billing (fetch-based, works on Vercel and Workers). */
export function getBillingStripe(): Stripe {
  const { secretKey } = getBillingConfig();
  if (cached && cached.key === secretKey) return cached.client;
  const client = new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    appInfo: { name: "Yooits" },
  });
  cached = { key: secretKey, client };
  return client;
}
