import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeResendEvent, verifyResendWebhook } from "@/lib/email/resend.server";

/**
 * Optional: Resend's delivery webhook (delivered, bounced, complained).
 * Without it the dispatcher still asks Resend for each email's status, so
 * this only makes the log update sooner. Needs RESEND_WEBHOOK_SECRET.
 */
export const Route = createFileRoute("/api/email/resend-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RESEND_WEBHOOK_SECRET;
        if (!secret) return new Response("not configured", { status: 503 });
        const body = await request.text();
        const ok = await verifyResendWebhook(
          secret,
          {
            id: request.headers.get("svix-id"),
            timestamp: request.headers.get("svix-timestamp"),
            signature: request.headers.get("svix-signature"),
          },
          body,
        );
        if (!ok) return new Response("invalid signature", { status: 400 });
        let event: {
          type?: string;
          created_at?: string;
          data?: { email_id?: string; bounce?: { message?: string } };
        };
        try {
          event = JSON.parse(body);
        } catch {
          return new Response("bad body", { status: 400 });
        }
        const raw = (event.type ?? "").replace(/^email\./, "");
        const type = normalizeResendEvent(raw);
        const id = event.data?.email_id;
        if (!type || !id) return Response.json({ received: true, outcome: "ignored" });
        const { error } = await (supabaseAdmin as unknown as SupabaseClient).rpc(
          "email_record_event",
          {
            _provider_id: id,
            _type: type,
            _at: event.created_at ?? new Date().toISOString(),
            _detail: event.data?.bounce?.message ?? raw,
          },
        );
        if (error) return new Response("retry", { status: 500 });
        return Response.json({ received: true });
      },
    },
  },
});
