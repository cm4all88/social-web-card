/** Server function for the owner console: remove a creator's custom background. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { removeBackground } from "./remove-background.server";

export const ownerRemoveBackground = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(z.object({ userId: z.string().uuid(), reason: z.string().min(3).max(200) }))
  .handler(async ({ context, data }) =>
    removeBackground(context.supabase as never, supabaseAdmin as never, data.userId, data.reason),
  );
