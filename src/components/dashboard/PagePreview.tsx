import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { profileBlocks } from "@/lib/profile-blocks";
import { ProfileWishlists, type WishlistSummary } from "@/components/profile/ProfileWishlists";
import { CreatorPosts } from "@/components/creator/CreatorPosts";
import {
  ProfileBody,
  ProfileCards,
  ProfileIdentity,
  ProfileSurface,
  type ProfileLink,
} from "@/components/profile/ProfilePresentation";
import { buttonRadiusFor, getTheme, type ThemeTokens } from "@/lib/themes";
import { safeBackgroundUrl } from "@/lib/backgrounds";
import { useSkinState } from "@/components/skins/SkinPicker";
import { resolveSkin } from "@/lib/skins";
import { themeForReward, type RewardKey } from "@/lib/rewards";
import type { LinkSection } from "@/lib/links/groups";

export function PagePreview({
  profile,
  qrUrl,
  links,
  sections,
  isPlus,
  rewards,
}: {
  qrUrl?: string;
  profile: {
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    avatar_gallery?: string[] | null;
    profile_blocks?: string[] | null;
    avatar_size?: number | null;
    skin_intensity?: string;
    bio_alignment?: string | null;
    bio?: string | null;
    theme: string | null;
    custom_theme: Partial<ThemeTokens> | null;
    skin?: string | null;
    background_url?: string | null;
  };
  links: ProfileLink[];
  sections: LinkSection[];
  isPlus: boolean;
  rewards: RewardKey[];
}) {
  const state = useSkinState(profile.user_id);
  const [wishlists, setWishlists] = useState<WishlistSummary[]>([]);
  const blocks = profileBlocks(profile.profile_blocks);
  const showWishlists = blocks.includes("wishlists");
  useEffect(() => {
    if (!showWishlists) return;
    let current = true;
    void supabase
      .from("wishlists")
      .select("id,slug,title,occasion")
      .eq("user_id", profile.user_id)
      .eq("visibility", "public")
      .eq("show_on_profile", true)
      .order("display_order", { ascending: true })
      .then(({ data }) => {
        if (current) setWishlists(data ?? []);
      });
    return () => {
      current = false;
    };
  }, [profile.user_id, showWishlists]);
  const unlocked = rewards.some((key) => themeForReward(key).key === profile.theme);
  const theme = getTheme(profile.theme, profile.custom_theme, { plus: isPlus, unlocked });
  const skin = resolveSkin({
    enabled: state.enabled,
    skin: profile.skin,
    theme: profile.theme,
    plus: isPlus,
    themeUnlocked: unlocked,
    skinUnlocked: state.unlocked,
  });
  return (
    <div
      aria-label="Preview of your page"
      className="w-44 overflow-hidden rounded-3xl border-4 border-black/70 shadow-xl"
    >
      <div className="max-h-80 overflow-auto">
        <div style={{ zoom: 0.42, width: 400 }}>
          <ProfileSurface
            theme={theme}
            skin={skin}
            motion={profile.skin_intensity}
            background={state.background ? safeBackgroundUrl(profile.background_url) : null}
            contained
          >
            <ProfileBody contained>
              <ProfileIdentity
                name={profile.display_name || profile.username}
                username={profile.username}
                avatar={profile.avatar_url}
                avatarGallery={profile.avatar_gallery}
                qrUrl={qrUrl}
                avatarSize={profile.avatar_size}
                bio={profile.bio}
                bioAlignment={profile.bio_alignment}
                theme={theme}
              />
              {blocks.map((block) => {
                if (block === "links")
                  return (
                    <ProfileCards
                      key={block}
                      links={links}
                      sections={sections}
                      theme={theme}
                      skin={skin}
                      preview
                    />
                  );
                if (block === "wishlists")
                  return (
                    <ProfileWishlists
                      key={block}
                      lists={wishlists}
                      username={profile.username}
                      theme={theme}
                    />
                  );
                return (
                  <CreatorPosts
                    key={block}
                    username={profile.username}
                    theme={theme}
                    radius={buttonRadiusFor(theme.buttonStyle)}
                    outline={theme.buttonStyle === "outline"}
                  />
                );
              })}
            </ProfileBody>
          </ProfileSurface>
        </div>
      </div>
    </div>
  );
}
