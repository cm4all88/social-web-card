/** Public analytics endpoint: the browser reports a view or a click; the server decides whether to count it. */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EVENT_KINDS, recordEvent, visitorHash } from "./record.server";

const input = z.object({
  kind: z.enum(EVENT_KINDS),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{1,30}$/)
    .nullable()
    .optional(),
  linkId: z.string().uuid().nullable().optional(),
  wishlistSlug: z.string().trim().toLowerCase().max(80).nullable().optional(),
  referrer: z.string().max(2048).nullable().optional(),
  utmSource: z.string().max(200).nullable().optional(),
  utmMedium: z.string().max(200).nullable().optional(),
  utmCampaign: z.string().max(200).nullable().optional(),
});

function salt(): string | null {
  return (
    process.env.ANALYTICS_HASH_SALT ||
    process.env.REPORT_IP_HASH_SALT ||
    process.env.TIP_IP_HASH_SALT ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    null
  );
}

export const trackEvent = createServerFn({ method: "POST" })
  .inputValidator(input)
  .handler(async ({ data }) => {
    // Analytics must never break a page: every failure is logged and swallowed.
    try {
      const s = salt();
      if (!s) return { status: "skipped" as const };
      const status = await recordEvent(
        supabaseAdmin as unknown as Parameters<typeof recordEvent>[0],
        data,
        {
          ip: getRequestHeader("x-real-ip") ?? getRequestIP({ xForwardedFor: true }) ?? null,
          userAgent: getRequestHeader("user-agent") ?? null,
          dnt: getRequestHeader("dnt") ?? null,
          gpc: getRequestHeader("sec-gpc") ?? null,
          country: getRequestHeader("x-vercel-ip-country") ?? null,
        },
        s,
      );
      return { status };
    } catch (e) {
      console.error("[analytics]", e instanceof Error ? e.message : e);
      return { status: "error" as const };
    }
  });

/**
 * Called from the dashboard: remembers today's visitor hash for the signed-in
 * creator's own browser, so a signed-out visit from it to their own page is
 * not counted as a qualifying visitor (public.creator_qualifying_visitors).
 */
export const markCreatorPresence = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const s = salt();
      const ip = getRequestHeader("x-real-ip") ?? getRequestIP({ xForwardedFor: true }) ?? null;
      const ua = getRequestHeader("user-agent") ?? null;
      if (!s || !ip || ip === "unknown" || !ua) return { status: "skipped" as const };
      const hash = await visitorHash(ip, ua, s);
      const { error } = await (
        supabaseAdmin as unknown as {
          rpc: (f: string, a: object) => PromiseLike<{ error: { message: string } | null }>;
        }
      ).rpc("record_creator_presence", { _user_id: context.userId, _visitor_hash: hash });
      if (error) throw new Error(error.message);
      return { status: "ok" as const };
    } catch (e) {
      console.error("[creator-presence]", e instanceof Error ? e.message : e);
      return { status: "error" as const };
    }
  });
