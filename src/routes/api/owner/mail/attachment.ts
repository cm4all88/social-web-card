import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAttachment } from "@/lib/mail/mailbox.server";
import { MailNotConnectedError, MailReconnectError } from "@/lib/mail/google.server";

/**
 * Downloads one file from a message in the owner's Gmail. The browser calls
 * this with the owner's Yooits sign-in token; files are always sent as a
 * download, never shown as a page.
 */
export const Route = createFileRoute("/api/owner/mail/attachment")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return new Response("unauthorized", { status: 401 });
        const db = supabaseAdmin as unknown as SupabaseClient;
        const { data: user, error } = await db.auth.getUser(token);
        if (error || !user?.user) return new Response("unauthorized", { status: 401 });
        const { data: admin } = await db.rpc("has_role", {
          _user_id: user.user.id,
          _role: "admin",
        });
        if (admin !== true) return new Response("forbidden", { status: 403 });
        const url = new URL(request.url);
        const m = url.searchParams.get("m") ?? "";
        const p = url.searchParams.get("p") ?? "";
        try {
          const file = await getAttachment(user.user.id, m, p);
          const name = file.filename.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "attachment";
          return new Response(Buffer.from(file.bytes), {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "private, no-store",
              "X-File-Type": file.mimeType.replace(/[^\w.+/-]/g, ""),
            },
          });
        } catch (e) {
          if (e instanceof MailReconnectError || e instanceof MailNotConnectedError)
            return new Response("reconnect", { status: 409 });
          return new Response(e instanceof Error ? e.message : "error", { status: 400 });
        }
      },
    },
  },
});
