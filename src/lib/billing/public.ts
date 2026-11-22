import { supabase } from "@/integrations/supabase/client";

/**
 * Whether a creator's Plus settings (premium theme, hidden branding) should
 * show on their public page. Any failure reads as "not Plus", so the page
 * falls back to the free look and the Yooits line, never the other way round.
 */
export async function loadPublicPlus(userId: string): Promise<boolean> {
  try {
    const { data, error } = await (
      supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      }
    ).rpc("public_profile_is_plus", { _user_id: userId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Whether a creator has earned the earned theme they picked. Any failure reads
 * as "not earned", so the page falls back to the default free theme.
 */
export async function loadPublicThemeUnlocked(userId: string): Promise<boolean> {
  try {
    const { data, error } = await (
      supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      }
    ).rpc("public_profile_theme_unlocked", { _user_id: userId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** For public pages: whether skins are on, and whether the creator earned their skin's theme. */
export async function loadPublicSkinState(userId: string): Promise<unknown> {
  try {
    const { data, error } = await (
      supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
      }
    ).rpc("public_profile_skin_state", { _user_id: userId });
    return error ? null : data;
  } catch {
    return null;
  }
}
