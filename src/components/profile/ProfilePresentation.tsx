import { useId, useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { ProfileAvatars } from "./ProfileAvatars";
import { SkinLayer } from "@/components/skins/SkinLayer";
import { backgroundScrim } from "@/lib/backgrounds";
import { groupLinks, type LinkSection } from "@/lib/links/groups";
import { linkDisplay } from "@/lib/platforms";
import { linkDisplayHost, safeLinkHref } from "@/lib/safe-url";
import { bioLength, limitBio, skinAmount } from "@/lib/profile-presentation";
import { socialHandle } from "@/lib/links/social-handle";
import type { Skin } from "@/lib/skins";
import { buttonRadiusFor, fontFamilyFor, type ThemeTokens } from "@/lib/themes";

export type ProfileLink = {
  id: string;
  platform: string;
  url: string;
  display_order: number;
  enabled: boolean;
  title?: string | null;
  icon?: string | null;
  featured?: boolean | null;
  section_id?: string | null;
};

export function ProfileSurface({
  theme,
  skin,
  background,
  contained,
  width,
  motion,
  children,
}: {
  theme: ThemeTokens;
  skin: Skin | null;
  background?: string | null;
  contained?: boolean;
  width?: number;
  motion?: string | null;
  children: ReactNode;
}) {
  const position = contained ? "absolute" : "fixed";
  return (
    <div
      data-profile-surface
      className={`relative isolate overflow-hidden ${contained ? "min-h-full" : "min-h-screen"}`}
      style={{
        width,
        background: theme.background,
        color: theme.foreground,
        fontFamily: fontFamilyFor(theme.font),
      }}
    >
      {background && (
        <>
          <div
            aria-hidden="true"
            data-background
            className={`pointer-events-none ${position} inset-0 z-0 bg-cover bg-center`}
            style={{ backgroundImage: `url("${background}")` }}
          />
          <div
            aria-hidden="true"
            data-background-scrim
            className={`pointer-events-none ${position} inset-0 z-0`}
            style={{ background: backgroundScrim(theme.foreground) }}
          />
        </>
      )}
      <SkinLayer skin={skin} mode={contained ? "contained" : "page"} amount={skinAmount(motion)} />
      {children}
    </div>
  );
}

export function ProfileBody({ children, contained }: { children: ReactNode; contained?: boolean }) {
  return (
    <main
      className={`relative z-10 mx-auto flex max-w-xl flex-col items-center px-6 py-16 ${contained ? "" : "min-h-screen"}`}
    >
      {children}
    </main>
  );
}

export function ProfileIdentity({
  name,
  username,
  avatar,
  avatarGallery,
  qrUrl,
  bio,
  avatarSize,
  bioAlignment,
  theme,
  interactive,
}: {
  name: string;
  username: string;
  avatar?: string | null;
  avatarGallery?: string[] | null;
  qrUrl?: string;
  bio?: string | null;
  avatarSize?: number | null;
  bioAlignment?: string | null;
  theme: ThemeTokens;
  interactive?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const bioId = useId();
  const size = avatarSize === 112 || avatarSize === 176 ? avatarSize : 144;
  const longBio = !!bio && (bioLength(bio) > 320 || bio.split("\n").length > 5);
  return (
    <>
      <ProfileAvatars
        avatar={avatar}
        gallery={avatarGallery}
        qrUrl={qrUrl}
        name={name}
        size={size}
        theme={theme}
        interactive={interactive}
      />
      <h1 className="max-w-full break-words text-center text-3xl font-bold tracking-tight sm:text-4xl">
        {name}
      </h1>
      <p className="mt-1 max-w-full break-words text-sm opacity-70">@{username}</p>
      {bio && (
        <div
          className={`mt-4 w-full max-w-md ${bioAlignment === "left" ? "text-left" : "text-center"}`}
        >
          <p id={bioId} className="whitespace-pre-wrap break-words opacity-80">
            {longBio && !expanded
              ? limitBio(bio.split("\n").slice(0, 5).join("\n"), 320).trimEnd() + "…"
              : bio}
          </p>
          {longBio && (
            <button
              type="button"
              className="mt-2 text-sm underline underline-offset-4"
              aria-expanded={expanded}
              aria-controls={bioId}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Read less" : "Read more"}
            </button>
          )}
        </div>
      )}
    </>
  );
}

export function ProfileCards({
  links,
  sections = [],
  loading,
  theme,
  skin,
  onLinkClick,
  preview,
}: {
  links: ProfileLink[];
  sections?: LinkSection[];
  loading?: boolean;
  theme: ThemeTokens;
  skin: Skin | null;
  onLinkClick?: (id: string) => void;
  preview?: boolean;
}) {
  const visible = links.filter((link) => link.enabled && link.url.trim());
  const groups = groupLinks(visible, sections);
  const radius = buttonRadiusFor(theme.buttonStyle);
  const frame = skin?.frame;
  return (
    <section aria-label="Links" className="mt-10 w-full space-y-3">
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-2xl opacity-30"
              style={{ background: theme.card }}
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed p-8 text-center opacity-70"
          style={{ borderColor: theme.border }}
        >
          No links added yet.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="space-y-3">
            {g.section && (
              <h2 className="pt-3 text-center text-xs font-semibold uppercase tracking-widest opacity-70">
                {g.section.title}
              </h2>
            )}
            {g.links.map((link) => {
              const meta = linkDisplay(link);
              const Icon = meta.icon;
              const isOutline = theme.buttonStyle === "outline";
              const href = safeLinkHref(link.url);
              const host = linkDisplayHost(href);
              const handle = socialHandle(href);
              const featured = g.kind === "featured";
              return (
                <a
                  key={link.id}
                  href={preview ? undefined : href}
                  target={href && !preview ? "_blank" : undefined}
                  rel="noopener noreferrer nofollow ugc"
                  onClick={href ? () => onLinkClick?.(link.id) : undefined}
                  data-featured={featured || undefined}
                  className={`group relative flex items-center gap-4 overflow-hidden border transition-all hover:-translate-y-0.5 ${
                    featured ? "border-2 p-5" : "p-4"
                  }`}
                  style={{
                    background: isOutline ? "transparent" : theme.card,
                    color: theme.cardForeground,
                    borderColor: featured ? theme.accent : (frame?.cardBorder ?? theme.border),
                    borderRadius: radius,
                    boxShadow: featured
                      ? `0 10px 30px -12px ${theme.accent}`
                      : isOutline
                        ? "none"
                        : (frame?.cardShadow ?? "0 8px 24px -12px rgba(0,0,0,0.3)"),
                    backdropFilter: isOutline ? undefined : frame?.cardBackdrop,
                    WebkitBackdropFilter: isOutline ? undefined : frame?.cardBackdrop,
                  }}
                >
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${meta.color} text-white shadow-lg`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-semibold">{meta.label}</div>
                    {!href && <div className="truncate text-xs opacity-70">{link.url}</div>}
                    {host && (
                      <div className="text-xs opacity-80">
                        {handle && <div className="truncate">{handle}</div>}
                        <div className="break-all">{host}</div>
                      </div>
                    )}
                  </div>
                  {href && (
                    <ArrowUpRight
                      aria-hidden="true"
                      className="size-4 shrink-0 opacity-60 transition group-hover:opacity-100"
                    />
                  )}
                </a>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}
