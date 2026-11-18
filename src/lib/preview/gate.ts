/**
 * Preview-only password gate (exists only on the preview/yooits branch).
 * When PREVIEW_PASSWORD is set on the server, every page asks for it with the
 * browser's own sign-in box. Stripe's webhook is let through because Stripe
 * signs those requests itself. Without PREVIEW_PASSWORD it does nothing.
 */
const OPEN_PATHS = new Set(["/api/stripe/webhook"]);

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
    const decoded = atob(header.slice(6).trim());
    const i = decoded.indexOf(":");
    return i < 0 ? null : decoded.slice(i + 1);
  } catch {
    return null;
  }
}

/** Returns a 401 response when the request must be refused, otherwise null. */
export function previewGate(request: Request, password: string | undefined): Response | null {
  if (!password) return null;
  if (OPEN_PATHS.has(new URL(request.url).pathname)) return null;
  const given = suppliedPassword(request.headers.get("authorization"));
  if (given !== null && safeEqual(given, password)) return null;
  return new Response("This Yooits preview is private.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Yooits preview", charset="UTF-8"',
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}
