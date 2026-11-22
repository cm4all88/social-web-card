import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CATEGORIES = new Set(["messages", "activity", "marketing", "all"]);

/**
 * RFC 8058 one-click unsubscribe. Mail apps (Gmail, Outlook, Apple Mail)
 * POST here from the List-Unsubscribe header; no sign-in, the link token
 * identifies the person. A GET (someone opening the link) goes to the page.
 */
export const Route = createFileRoute("/api/email/unsubscribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("t") ?? "";
        const category = url.searchParams.get("c") ?? "marketing";
        if (!/^[a-f0-9]{48}$/.test(token) || !CATEGORIES.has(category)) {
          return new Response("bad request", { status: 400 });
        }
        const { error } = await (supabaseAdmin as unknown as SupabaseClient).rpc(
          "email_unsubscribe",
          {
            _token: token,
            _category: category,
          },
        );
        if (error) {
          console.error("[email] unsubscribe failed", error.message);
          return new Response("try again", { status: 500 });
        }
        return new Response("unsubscribed", { status: 200 });
      },
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const t = url.searchParams.get("t") ?? "";
        const c = url.searchParams.get("c") ?? "marketing";
        const to = new URL("/email/preferences", url.origin);
        to.searchParams.set("t", t);
        to.searchParams.set("unsubscribe", c);
        return Response.redirect(to.toString(), 303);
      },
    },
  },
});
