/** Public "report this page" submission. Anyone can report; limits live in the database. */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hashIp } from "@/lib/tipping/rate-limit.server";
import { REPORT_DETAILS_MAX, REPORT_REASON_IDS } from "./reasons";

const input = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{1,30}$/),
  wishlistSlug: z.string().trim().toLowerCase().max(80).nullable(),
  reason: z.enum(REPORT_REASON_IDS),
  details: z.string().max(REPORT_DETAILS_MAX).optional(),
  contact: z.string().trim().max(254).optional(),
  // Honeypot: a hidden field people never fill in.
  website: z.string().max(200).optional(),
});

function ipSalt(): string {
  const salt =
    process.env.REPORT_IP_HASH_SALT ||
    process.env.TIP_IP_HASH_SALT ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) throw new Error("No salt for hashing");
  return salt;
}

export const submitReport = createServerFn({ method: "POST" })
  .inputValidator(input)
  .handler(async ({ data }) => {
    if (data.website) return { status: "ok" as const };
    try {
      const ip =
        getRequestHeader("x-real-ip") ?? getRequestIP({ xForwardedFor: true }) ?? "unknown";
      const { data: result, error } = await (
        supabaseAdmin as unknown as {
          rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
        }
      ).rpc("record_abuse_report", {
        _username: data.username,
        _wishlist_slug: data.wishlistSlug,
        _reason: data.reason,
        _details: data.details ?? null,
        _contact: data.contact || null,
        _reporter_user_id: null,
        _ip_hash: await hashIp(ip, ipSalt()),
      });
      if (error) throw new Error(error.message);
      if (result === "rate_limited") throw new UserFacing("You've sent several reports recently. Please try again later.");
      if (result === "not_found") throw new UserFacing("We couldn't find that page.");
      return { status: "ok" as const };
    } catch (e) {
      if (e instanceof UserFacing) throw new Error(e.message);
      console.error("[reports]", e instanceof Error ? e.message : e);
      throw new Error("We couldn't send your report. Please try again.");
    }
  });

class UserFacing extends Error {}
