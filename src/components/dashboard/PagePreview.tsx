import {
  ProfileBody,
  ProfileCards,
  ProfileIdentity,
  ProfileSurface,
  type ProfileLink,
} from "@/components/profile/ProfilePresentation";
import { getTheme, type ThemeTokens } from "@/lib/themes";
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
              <ProfileCards links={links} sections={sections} theme={theme} skin={skin} preview />
            </ProfileBody>
          </ProfileSurface>
        </div>
      </div>
    </div>
  );
}
