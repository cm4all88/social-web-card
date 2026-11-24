import { createMiddleware, createStart } from "@tanstack/react-start";
import { previewGate } from "@/lib/preview/gate";
import { applySupabaseEnvFallbacks } from "@/lib/preview/env-fallbacks";

// Accept the Supabase–Vercel integration's variable names too (server only).
if (typeof process !== "undefined" && process.env) applySupabaseEnvFallbacks(process.env);

// Preview branch only: password-protect the preview site (see src/lib/preview/gate.ts).
const previewPassword = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
  const refused = previewGate(request, process.env.SITE_PASSWORD);
  if (refused) return refused;
  const result = await next();
  try {
    // Stop other sites framing Yooits.me pages (clickjacking) or the browser
    // guessing content types; keep the full URL out of outbound referrers.
    result.response.headers.set("X-Frame-Options", "SAMEORIGIN");
    result.response.headers.set("X-Content-Type-Options", "nosniff");
    result.response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  } catch {
    // Read-only headers on some responses; nothing to add there.
  }
  if (process.env.SITE_PASSWORD) {
    try {
      result.response.headers.set("X-Robots-Tag", "noindex, nofollow");
    } catch {
      // Some responses have read-only headers; the 401 page and robots rules still apply.
    }
  }
  return result;
});

export const startInstance = createStart(() => ({ requestMiddleware: [previewPassword] }));
