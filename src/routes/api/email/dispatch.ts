import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runDispatch } from "@/lib/email/dispatch.server";

/**
 * Sends queued email. Called by the database (pg_cron every minute, and
 * pg_net right after an email is queued) with the secret kept in Supabase
 * Vault in the x-email-dispatch-secret header. The secret is checked against
 * Vault, or against EMAIL_DISPATCH_SECRET when that is set in Vercel.
 */
export const Route = createFileRoute("/api/email/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const given = request.headers.get("x-email-dispatch-secret") ?? "";
        if (given.length < 32 || given.length > 200)
          return new Response("forbidden", { status: 403 });
        if (!(await authorized(given))) return new Response("forbidden", { status: 403 });
        try {
          return Response.json(await runDispatch({ limit: 25 }));
        } catch (e) {
          console.error("[email] dispatch failed", (e as Error).message);
          return new Response("dispatch failed", { status: 500 });
        }
      },
    },
  },
});

async function authorized(given: string): Promise<boolean> {
  const env = process.env.EMAIL_DISPATCH_SECRET;
  if (env) return safeEqual(given, env);
  const { data, error } = await (supabaseAdmin as unknown as SupabaseClient).rpc(
    "email_dispatch_token_ok",
    { _token: given },
  );
  return !error && data === true;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
