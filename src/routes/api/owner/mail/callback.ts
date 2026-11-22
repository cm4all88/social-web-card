import { createFileRoute } from "@tanstack/react-router";
import { dropState, finishConnect, googleConfigured } from "@/lib/mail/google.server";

/**
 * Google sends the owner back here after they allow Gmail access. The
 * one-time state ties this visit to the admin who pressed Connect; the code
 * is exchanged on the server and the refresh token goes straight to Vault.
 */
export const Route = createFileRoute("/api/owner/mail/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const back = (q: string) =>
          new Response(null, {
            status: 303,
            headers: {
              Location: `/owner/mail?${q}`,
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
            },
          });
        if (!googleConfigured()) return back("mail_error=not_configured");
        const state = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        if (url.searchParams.get("error")) {
          // The owner said no, or Google stopped it. Use up the state either way.
          if (state && state.length <= 200) await dropState(state).catch(() => null);
          return back("mail_error=denied");
        }
        if (!state || !code || state.length > 200 || code.length > 2000)
          return back("mail_error=missing");
        try {
          const r = await finishConnect(state, code, url.origin);
          return r.ok ? back("connected=1") : back(`mail_error=${r.reason}`);
        } catch {
          return back("mail_error=server");
        }
      },
    },
  },
});
