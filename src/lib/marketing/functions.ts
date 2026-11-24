/** Server functions for the Marketing Center (owner only). */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aiAuthToken, aiRewrite } from "./ai.server";
import { FEATURE_IDS } from "./features";
import { PLATFORM_IDS } from "./platforms";
import { verifyAndRecord } from "./verify.server";

export const marketingVerifyPost = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(z.object({ postId: z.string().uuid(), url: z.string().url().max(500) }))
  .handler(async ({ context, data }) =>
    verifyAndRecord(
      context.supabase as never,
      supabaseAdmin as never,
      context.userId,
      data.postId,
      data.url,
    ),
  );

export const marketingAiRewrite = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(
    z.object({
      platform: z.enum(PLATFORM_IDS as [string, ...string[]]),
      caption: z.string().min(1).max(3000),
      features: z.array(z.enum(FEATURE_IDS as [string, ...string[]])).max(12),
      audience: z.string().max(40),
      kind: z.string().max(20),
    }),
  )
  .handler(async ({ context, data }) => {
    // Owner only: the state call refuses anyone who is not an admin.
    const check = await (
      context.supabase as never as {
        rpc: (f: string, a: object) => Promise<{ error: { code?: string } | null }>;
      }
    ).rpc("owner_marketing_state", {});
    if (check.error)
      return {
        ok: false as const,
        reason: "refused" as const,
        message: "Only Yooits.me admins can do this.",
      };
    const header = getRequest()?.headers.get("x-vercel-oidc-token");
    const token = aiAuthToken(process.env, header);
    return aiRewrite(data as never, token, process.env.MARKETING_AI_MODEL || undefined);
  });
