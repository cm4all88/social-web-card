/**
 * Resend's HTTP API (https://resend.com/docs/api-reference). Server only:
 * the key is RESEND_API_KEY in the Vercel project, never in the browser.
 */
const API = "https://api.resend.com";

export function resendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export type SendInput = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  /** Resend ignores a repeat with the same key for 24 hours: retries never double-send. */
  idempotencyKey: string;
};

export type SendResult =
  { ok: true; id: string } | { ok: false; error: string; retryable: boolean };

type Fetch = typeof fetch;

export async function sendViaResend(input: SendInput, f: Fetch = fetch): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set", retryable: true };
  let res: Response;
  try {
    res = await f(`${API}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.headers && Object.keys(input.headers).length ? { headers: input.headers } : {}),
        ...(input.tags?.length ? { tags: input.tags } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return { ok: false, error: `network: ${(e as Error).message}`.slice(0, 300), retryable: true };
  }
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };
  if (res.ok && body.id) return { ok: true, id: body.id };
  // 429 (rate limit), 5xx and 409 (idempotent request still in flight) can be tried again.
  const retryable = res.status === 429 || res.status >= 500 || res.status === 409;
  return {
    ok: false,
    error: `${res.status} ${body.name ?? ""} ${body.message ?? ""}`.trim().slice(0, 300),
    retryable,
  };
}

/** Resend's latest event for a sent email, e.g. "delivered" or "bounced". */
export async function resendLastEvent(id: string, f: Fetch = fetch): Promise<string | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try {
    const res = await f(`${API}/emails/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { last_event?: string };
    return body.last_event ?? null;
  } catch {
    return null;
  }
}

/** Resend event names -> the statuses email_record_event knows. */
export function normalizeResendEvent(e: string | null | undefined): string | null {
  switch (e) {
    case "delivered":
    case "opened":
    case "clicked":
      return "delivered";
    case "delivery_delayed":
      return "delivery_delayed";
    case "bounced":
      return "bounced";
    case "complained":
      return "complained";
    case "failed":
    case "suppressed":
    case "canceled":
      return "failed";
    default:
      return null; // sent, queued, scheduled: nothing new yet
  }
}

/**
 * Verifies a Resend webhook (Svix signing): base64 HMAC-SHA256 of
 * "id.timestamp.body" with the secret after its "whsec_" prefix. Rejects
 * anything older than 5 minutes.
 */
export async function verifyResendWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );
  const expected = btoa(String.fromCharCode(...mac));
  return signature
    .split(" ")
    .map((part) => part.split(",")[1])
    .some((sig) => typeof sig === "string" && timingSafeEqual(sig, expected));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
