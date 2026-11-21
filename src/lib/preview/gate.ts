/**
 * Preview-only password gate (exists only on the preview/yooits branch).
 * When SITE_PASSWORD is set on the server, every page asks for it with the
 * browser's own sign-in box. Stripe's webhook POSTs are let through because
 * Stripe signs those requests itself. Without SITE_PASSWORD it does nothing.
 */
const OPEN_PATHS = new Set(["/api/stripe/webhook"]);

/** Drops spaces, line breaks and one pair of quotes pasted around a value. */
function bare(value: string): string {
  const v = value.trim();
  const quoted = v.match(/^(['"])([\s\S]*)\1$/);
  return quoted ? quoted[2].trim() : v;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The password typed in the browser's box, or null. Any user name is accepted. */
export function suppliedPassword(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    // Basic credentials are UTF-8 bytes in base64; atob alone would garble
    // any non-ASCII character in the password.
    const bytes = Uint8Array.from(atob(header.slice(6).trim()), (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const i = decoded.indexOf(":");
    return i < 0 ? null : decoded.slice(i + 1);
  } catch {
    return null;
  }
}

/** Returns a 401 response when the request must be refused, otherwise null. */
export function previewGate(request: Request, password: string | undefined): Response | null {
  // Spaces, line breaks or quotes pasted around either copy don't count.
  password = password === undefined ? undefined : bare(password);
  if (!password) return null;
  // Only Stripe's POST gets through; opening the address in a browser still asks.
  if (request.method === "POST" && OPEN_PATHS.has(new URL(request.url).pathname)) return null;
  const given = suppliedPassword(request.headers.get("authorization"));
  if (given !== null && safeEqual(bare(given), password)) return null;
  return new Response("This Yooits preview is private.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Yooits preview", charset="UTF-8"',
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}
