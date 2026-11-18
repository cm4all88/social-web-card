import Stripe from "stripe";

/**
 * Verify a Stripe webhook against each configured signing secret (the platform
 * endpoint and the connected-accounts endpoint each have their own). Returns
 * null when no secret verifies. Requires the raw request body.
 */
export async function verifyStripeWebhook(
  stripe: Stripe,
  rawBody: string,
  signature: string | null,
  secrets: string[],
): Promise<Stripe.Event | null> {
  if (!signature) return null;
  const crypto = Stripe.createSubtleCryptoProvider();
  for (const secret of secrets) {
    try {
      return await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        secret,
        undefined,
        crypto,
      );
    } catch {
      // try the next secret
    }
  }
  return null;
}
