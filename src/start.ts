import { createMiddleware, createStart } from "@tanstack/react-start";
import { previewGate } from "@/lib/preview/gate";

// Preview branch only: password-protect the preview site (see src/lib/preview/gate.ts).
const previewPassword = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
  const refused = previewGate(request, process.env.SITE_PASSWORD);
  if (refused) return refused;
  const result = await next();
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
