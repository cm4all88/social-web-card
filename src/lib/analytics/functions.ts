/** Public analytics endpoint: the browser reports a view or a click; the server decides whether to count it. */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EVENT_KINDS, recordEvent, visitorHash } from "./record.server";
import { deviceFromUserAgent, isBot, optedOut } from "./source";
import { isShareChannel } from "@/lib/share/links";

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

const shareInput = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{1,30}$/),
  channel: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,24}$/),
});

/**
 * Counts one share of a page (profile_shares). Anyone may share a page; the
 * share counts as the owner's own only when the signed-in user owns it,
 * checked here from their token, never taken from the browser's word.
 */
export const trackShare = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator(shareInput)
  .handler(async ({ data }) => {
    try {
      if (!isShareChannel(data.channel)) return { status: "bad_channel" as const };
      const ua = getRequestHeader("user-agent") ?? null;
      if (optedOut({ dnt: getRequestHeader("dnt"), gpc: getRequestHeader("sec-gpc") }))
        return { status: "skipped" as const };
      if (isBot(ua)) return { status: "skipped" as const };
      const s = salt();
      const ip = getRequestHeader("x-real-ip") ?? getRequestIP({ xForwardedFor: true }) ?? null;
      const hash = s && ip && ip !== "unknown" && ua ? await visitorHash(ip, ua, s) : null;

      let actor: string | null = null;
      const auth = getRequestHeader("authorization");
      if (auth?.startsWith("Bearer ")) {
        const { data: u } = await supabaseAdmin.auth.getUser(auth.slice(7));
        actor = u.user?.id ?? null;
      }
      const { data: status, error } = await (
        supabaseAdmin as unknown as {
          rpc: (
            f: string,
            a: object,
          ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
        }
      ).rpc("record_profile_share_event", {
        _username: data.username,
        _channel: data.channel,
        _actor: actor,
        _device: deviceFromUserAgent(ua),
        _visitor_hash: hash,
      });
      if (error) throw new Error(error.message);
      return { status: String(status ?? "ok") };
    } catch (e) {
      console.error("[share]", e instanceof Error ? e.message : e);
      return { status: "error" as const };
    }
  });
