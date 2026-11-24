import { useLayoutEffect, useRef, useState } from "react";
import {
  ProfileBody,
  ProfileCards,
  ProfileIdentity,
  ProfileSurface,
} from "@/components/profile/ProfilePresentation";
import { findSkin, THEME_DEFAULT_SKIN } from "@/lib/skins";
import { findThemePreset, getTheme } from "@/lib/themes";
import { STUDIO_CANVASES, type DemoProfile, type StudioGraphicSpec } from "@/lib/marketing/studio";

export function StudioGraphic({
  profile,
  canvas,
  presentation,
  headline,
  cta,
}: {
  profile: DemoProfile;
  canvas: StudioGraphicSpec["canvas"];
  presentation: StudioGraphicSpec["presentation"];
  headline?: string;
  cta?: string;
}) {
  // Allow off-season themes in fictional examples while preserving their actual tokens.
  const theme = findThemePreset(profile.theme)?.tokens ?? getTheme(null, null);
  const skin = findSkin(profile.skin || THEME_DEFAULT_SKIN[profile.theme]) ?? null;
  const content = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const { width, height } = STUDIO_CANVASES[canvas];
  const decorated = presentation === "device";
  useLayoutEffect(() => {
    if (!content.current || !area.current) return;
    const fit = () => {
      if (!content.current || !area.current) return;
      setScale(
        Math.min(
          area.current.clientWidth / 400,
          area.current.clientHeight / content.current.offsetHeight,
          1.35,
        ),
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(area.current);
    observer.observe(content.current);
    fit();
    return () => observer.disconnect();
  }, []);
  const page = (
    <ProfileBody contained>
      <ProfileIdentity
        name={profile.name}
        username={profile.username}
        avatar={profile.avatar}
        avatarGallery={profile.avatarGallery}
        bio={profile.bio}
        avatarSize={profile.avatarSize}
        bioAlignment={profile.bioAlignment}
        theme={theme}
      />
      <ProfileCards
        theme={theme}
        skin={skin}
        preview
        links={profile.links.map((link, index) => ({
          ...link,
          id: String(index),
          display_order: index,
          enabled: true,
        }))}
      />
    </ProfileBody>
  );
  const graphic = (
    <div
      className="relative z-10 flex flex-col items-center overflow-hidden"
      style={{
        width: width / 2,
        height: height / 2,
        color: decorated ? "#fafafa" : theme.foreground,
        background: decorated ? "linear-gradient(135deg, #131326, #30234d)" : undefined,
        padding: decorated ? 24 : 0,
      }}
    >
      {headline && (
        <p
          data-studio-copy
          className="mb-3 max-w-full break-words text-center text-2xl font-semibold"
        >
          {headline}
        </p>
      )}
      <div ref={area} className="relative w-full min-h-0 flex-1">
        <div
          ref={content}
          className={`absolute left-1/2 top-1/2 w-[400px] overflow-hidden ${decorated ? "rounded-[32px] border-[8px] border-zinc-950" : ""}`}
          style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          {decorated ? (
            <ProfileSurface
              theme={theme}
              skin={skin}
              motion={profile.motion}
              background={profile.background}
              contained
            >
              {page}
            </ProfileSurface>
          ) : (
            page
          )}
        </div>
      </div>
      {cta && (
        <p
          data-studio-copy
          className="mt-3 max-w-full break-words text-center text-sm font-semibold"
        >
          {cta}
        </p>
      )}
      {decorated && (
        <p data-studio-copy className="mt-3 text-xs font-semibold tracking-wide">
          yooits.me
        </p>
      )}
    </div>
  );
  return decorated ? (
    graphic
  ) : (
    <ProfileSurface
      theme={theme}
      skin={skin}
      motion={profile.motion}
      background={profile.background}
      width={width / 2}
      contained
    >
      {graphic}
    </ProfileSurface>
  );
}
