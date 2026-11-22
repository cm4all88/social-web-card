import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getTheme, type ThemeTokens } from "@/lib/themes";
import { loadPublicPlus } from "@/lib/billing/public";

export type PublicProfile = {
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  theme: string | null;
  custom_theme: Partial<ThemeTokens> | null;
};

/** Load a public profile by username, for pages outside the main profile route. */
export function usePublicProfile(username: string) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [plus, setPlus] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    supabase
      .from("profiles")
      .select("user_id, username, display_name, avatar_url, theme, custom_theme")
      .eq("username", username.toLowerCase())
      .maybeSingle()
      .then(async ({ data }) => {
        if (cancelled) return;
        if (!data) return setState("missing");
        const isPlus = await loadPublicPlus((data as PublicProfile).user_id);
        if (cancelled) return;
        setPlus(isPlus);
        setProfile(data as PublicProfile);
        setState("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  const theme = getTheme(profile?.theme, profile?.custom_theme, { plus });
  const name = profile?.display_name || profile?.username || username;
  return { profile, state, theme, name };
}
