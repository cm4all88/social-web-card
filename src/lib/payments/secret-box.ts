/**
 * Encrypts a webhook signing secret for storage with a key derived from the
 * Stripe secret key (AES-GCM, Web Crypto). The stored value is useless
 * without the Stripe key, and anyone who has the Stripe key can already make
 * a new webhook. Changing the Stripe key means pressing Set up again.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(stripeSecretKey: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    enc.encode(`yooits-webhook-secret-v1:${stripeSecretKey}`),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealSecret(
  secret: string,
  stripeSecretKey: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(stripeSecretKey);
  const out = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(secret)),
  );
  return { ciphertext: b64(out), iv: b64(iv) };
}

/** The secret, or null when it was sealed with another Stripe key or was altered. */
export async function openSecret(
  ciphertext: string,
  iv: string,
  stripeSecretKey: string,
): Promise<string | null> {
  try {
    const key = await keyFrom(stripeSecretKey);
    const out = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv) },
      key,
      unb64(ciphertext),
    );
    return dec.decode(out);
  } catch {
    return null;
  }
}
