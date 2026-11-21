/** Server functions for a person's own account. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AccountDeletionRefused, deleteAccount } from "./delete-account.server";

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator(z.object({ confirmUsername: z.string().max(40) }))
  .handler(async ({ context, data }) => {
    try {
      // supabaseAdmin is a lazy proxy; the cast keeps the helper's simple client type.
      await deleteAccount(supabaseAdmin as never, context.userId, data.confirmUsername);
      return { deleted: true as const };
    } catch (e) {
      if (e instanceof AccountDeletionRefused) throw new Error(e.message);
      console.error("[account] delete failed", e instanceof Error ? e.message : e);
      throw new Error("We couldn't delete your account. Please try again or contact us.");
    }
  });
