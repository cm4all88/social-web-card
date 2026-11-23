import { MessageButton } from "@/components/messages/MessageButton";
import { captureReferrer } from "@/lib/marketing/attribution";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { linkDisplay } from "@/lib/platforms";
import { groupLinks, type LinkSection } from "@/lib/links/groups";
import { linkDisplayHost, safeLinkHref } from "@/lib/safe-url";
import {
  getTheme,
  isRewardTheme,
  fontFamilyFor,
  buttonRadiusFor,
  type ThemeTokens,
} from "@/lib/themes";
import { Gift, Heart, Share2, UserPlus } from "lucide-react";
import { trackedProfileUrl } from "@/lib/share/links";
import { recordShare } from "@/lib/share/track";
import { TipPanel, type PublicTipConfig } from "@/components/tipping/TipPanel";
import { CreatorPosts } from "@/components/creator/CreatorPosts";
import { readableTextOn } from "@/lib/contrast";
import { ReportLink } from "@/components/reports/ReportLink";
import { Toaster } from "@/components/ui/sonner";
import { getPublicTipConfig } from "@/lib/tipping/functions";
import { getPublicCreatorSubscription } from "@/lib/creator/subscription-functions";
import { formatUsd } from "@/lib/tipping/money";
import { loadPublicPlus, loadPublicSkinState, loadPublicThemeUnlocked } from "@/lib/billing/public";
import { SkinLayer } from "@/components/skins/SkinLayer";
import { findSkin, parseSkinState, resolveSkin, THEME_DEFAULT_SKIN } from "@/lib/skins";
import { backgroundScrim, safeBackgroundUrl } from "@/lib/backgrounds";
import { trackVisit } from "@/lib/analytics/track";

// The share sheet loads only when someone opens it, so the page stays light.
const ShareSheet = lazy(() =>
  import("@/components/share/ShareSheet").then((m) => ({ default: m.ShareSheet })),
);

export const Route = createFileRoute("/$username")({
  component: ProfilePage,
  // Only for the link preview apps show when the page is shared (name, bio,
  // photo). The page itself still loads its data in the browser, and a slow
  // or failed read here just falls back to the plain preview.
  loader: async ({ params }) => ({ og: await loadPreview(params.username) }),
  head: ({ params, loaderData }) => {
    const og = loaderData?.og ?? null;
    const handle = `@${og?.username ?? params.username}`;
    const title = og?.display_name ? `${og.display_name} (${handle})` : handle;
    const description = og?.bio?.trim()
      ? og.bio.trim().slice(0, 200)
      : `Find ${og?.display_name || handle} on every platform, all in one link.`;
    const image = og?.avatar_url && /^https:\/\//i.test(og.avatar_url) ? og.avatar_url : null;
    return {
      meta: [
        { title: `${title} — Yooits` },
        { name: "description", content: description },
        { property: "og:title", content: `${title} on Yooits` },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        ...(og ? [{ property: "og:url", content: `https://yooits.me/${og.username}` }] : []),
        ...(image
          ? [
              { property: "og:image", content: image },
              { name: "twitter:image", content: image },
            ]
          : []),
        { name: "twitter:title", content: `${title} on Yooits` },
        { name: "twitter:description", content: description },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold">User not found</h1>
      <p className="mt-2 text-muted-foreground">No one has claimed this link yet.</p>
      <Link to="/" className="mt-6 text-primary hover:underline">
        ← Home
      </Link>
    </div>
  ),
});

type Preview = {
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
};

/** The public name, bio and photo for link previews; null when missing, slow or failing. */
async function loadPreview(username: string): Promise<Preview | null> {
  const name = username.toLowerCase();
  if (!/^[a-z0-9._-]{1,30}$/.test(name)) return null;
  try {
    const read = supabase
      .from("profiles")
      .select("username, display_name, bio, avatar_url")
      .eq("username", name)
      .maybeSingle()
      .then(({ data }) => (data as Preview | null) ?? null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500));
    return await Promise.race([read, timeout]);
  } catch {
    return null;
  }
}

type Profile = {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  theme: string | null;
  custom_theme: Partial<ThemeTokens> | null;
  hide_branding?: boolean | null;
  skin?: string | null;
  background_url?: string | null;
};
type SocialLink = {
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
type WishlistSummary = { id: string; slug: string; title: string; occasion: string | null };

function ProfilePage() {
  const { username } = Route.useParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [sections, setSections] = useState<LinkSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tipConfig, setTipConfig] = useState<PublicTipConfig | null>(null);
  const [subTotal, setSubTotal] = useState<number | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [wishlists, setWishlists] = useState<WishlistSummary[]>([]);
  // Plus settings (premium theme, hidden branding) count only while on Plus.
  const [plus, setPlus] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [skinState, setSkinState] = useState(() => parseSkinState(null));
  // ?effect=snow previews an effect on this page without saving anything.
  const [previewSkin, setPreviewSkin] = useState<string | null>(null);
  useEffect(() => {
    setPreviewSkin(new URLSearchParams(window.location.search).get("effect"));
  }, []);

  useEffect(() => {
    const run = async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("username", username.toLowerCase())
        .maybeSingle();
      if (!prof) {
        setMissing(true);
        setLoading(false);
        return;
      }
      const pickedSkin = (prof as { skin?: string | null }).skin;
      const wantsSkin =
        (!!pickedSkin && pickedSkin !== "none") ||
        !!(prof.theme && THEME_DEFAULT_SKIN[prof.theme]) ||
        !!(prof as { background_url?: string | null }).background_url;
      const [{ data: l }, { data: secs }, isPlus, isUnlocked, skinData] = await Promise.all([
        supabase
          .from("social_links")
          .select("*")
          .eq("user_id", prof.user_id)
          .eq("enabled", true)
          .order("display_order", { ascending: true }),
        // Sections are optional: if they can't be read, links still show, unsectioned.
        supabase
          .from("link_sections")
          .select("id, title, display_order")
          .eq("user_id", prof.user_id)
          .order("display_order", { ascending: true })
          .then((r) => (r.error ? { data: [] } : r)),
        loadPublicPlus(prof.user_id),
        isRewardTheme(prof.theme) ? loadPublicThemeUnlocked(prof.user_id) : Promise.resolve(false),
        wantsSkin ? loadPublicSkinState(prof.user_id) : Promise.resolve(null),
      ]);
      setSkinState(parseSkinState(skinData));
      setPlus(isPlus);
      setUnlocked(isUnlocked);
      setProfile(prof as Profile);
      setLinks((l ?? []) as SocialLink[]);
      setSections((secs ?? []) as LinkSection[]);
      setLoading(false);
      trackVisit("profile_view", prof.user_id, { username: prof.username });

      // Optional sections; failures here must never break the profile page.
      getPublicTipConfig({ data: { username: prof.username } })
        .then((cfg) => setTipConfig(cfg.available && cfg.showOnProfile ? cfg : null))
        .catch(() => setTipConfig(null));
      // Shown only where a subscription checkout would actually work.
      getPublicCreatorSubscription({ data: { username: prof.username } })
        .then((o) => setSubTotal(o.available ? o.totalCents : null))
        .catch(() => setSubTotal(null));
      supabase
        .from("wishlists")
        .select("id, slug, title, occasion")
        .eq("user_id", prof.user_id)
        .eq("visibility", "public")
        .eq("show_on_profile", true)
        .order("display_order", { ascending: true })
        .then(({ data }) => setWishlists((data ?? []) as WishlistSummary[]));
    };
    run();
  }, [username]);

  if (missing) {
    throw notFound();
  }

  const visible = links.filter((l) => l.url.trim().length > 0);
  // Featured first, then unsectioned links, then each section: the creator's saved order.
  const groups = groupLinks(visible, sections);
  const name = profile?.display_name || profile?.username || username;
  const theme = getTheme(profile?.theme, profile?.custom_theme, { plus, unlocked });
  const showBranding = !(plus && profile?.hide_branding);
  const radius = buttonRadiusFor(theme.buttonStyle);
  const font = fontFamilyFor(theme.font);
  const preview = findSkin(previewSkin);
  const resolvedSkin = resolveSkin({
    enabled: skinState.enabled,
    skin: profile?.skin,
    theme: profile?.theme,
    plus,
    themeUnlocked: unlocked,
    skinUnlocked: skinState.unlocked,
  });
  const skin = preview ?? resolvedSkin;
  const frame = skin?.frame;
  // The creator's own photo, while they have Plus or the popular reward.
  const bg = skinState.background ? safeBackgroundUrl(profile?.background_url) : null;

  // Phones open their own share sheet in one tap; elsewhere, ours.
  const sharePage = async () => {
    if (!profile) return;
    if (
      typeof navigator.share === "function" &&
      /Mobi|iPhone|iPad|Android/i.test(navigator.userAgent)
    ) {
      try {
        await navigator.share({
          title: `${name} on Yooits`,
          url: trackedProfileUrl(window.location.origin, profile.username, "native"),
        });
        recordShare(profile.username, "native");
      } catch {
        /* closed without sharing */
      }
      return;
    }
    setShareOpen(true);
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: theme.background, color: theme.foreground, fontFamily: font }}
    >
      {bg && (
        <>
          <div
            aria-hidden="true"
            data-background
            className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${bg}")` }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-0"
            style={{ background: backgroundScrim(theme.foreground) }}
          />
        </>
      )}
      <SkinLayer skin={skin} />
      {preview && (
        <div
          className="fixed left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white"
          role="status"
        >
          Previewing {preview.label}
        </div>
      )}
      {profile && (
        <button
          type="button"
          onClick={sharePage}
          aria-label={`Share ${name}'s page`}
          className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border transition hover:-translate-y-0.5"
          style={{ background: theme.card, color: theme.cardForeground, borderColor: theme.border }}
        >
          <Share2 className="h-4 w-4" />
        </button>
      )}
      {profile && shareOpen && (
        <Suspense fallback={null}>
          <ShareSheet
            open={shareOpen}
            onOpenChange={setShareOpen}
            username={profile.username}
            name={name}
            theme={theme}
            links={[]}
            showBranding={showBranding}
            own={false}
          />
        </Suspense>
      )}
      <main className="relative z-10 mx-auto flex min-h-screen max-w-xl flex-col items-center px-6 py-16">
        <div
          className="mb-5 h-28 w-28 rounded-full p-1"
          style={{ background: theme.accent, boxShadow: `0 10px 40px -10px ${theme.accent}` }}
        >
          <div
            className="flex h-full w-full items-center justify-center overflow-hidden rounded-full text-3xl font-bold"
            style={{ background: theme.card, color: theme.cardForeground }}
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt={name} className="h-full w-full object-cover" />
            ) : (
              name.slice(0, 1).toUpperCase()
            )}
          </div>
        </div>
        <h1 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
        <p className="mt-1 text-sm opacity-70">@{profile?.username ?? username}</p>
        {profile?.bio && <p className="mt-4 max-w-md text-center opacity-80">{profile.bio}</p>}
        {profile && (
          <MessageButton
            username={profile.username}
            className="mt-5 inline-flex items-center gap-2 border px-5 py-2 text-sm font-semibold transition-all hover:-translate-y-0.5"
            style={{ borderColor: theme.accent, color: theme.foreground, borderRadius: radius }}
          />
        )}

        <section className="mt-10 w-full space-y-3">
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
                  const featured = g.kind === "featured";
                  return (
                    <a
                      key={link.id}
                      href={href}
                      target={href ? "_blank" : undefined}
                      rel="noopener noreferrer nofollow ugc"
                      onClick={
                        href
                          ? () =>
                              trackVisit("link_click", profile?.user_id, {
                                username: profile?.username,
                                linkId: link.id,
                              })
                          : undefined
                      }
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
                        {host && <div className="truncate text-xs opacity-70">{host}</div>}
                      </div>
                      <div
                        className="rounded-full px-3 py-1 text-xs font-medium opacity-70 transition group-hover:opacity-100"
                        style={{ background: `${theme.accent}22`, color: theme.accent }}
                      >
                        {featured ? "Open →" : "Connect →"}
                      </div>
                    </a>
                  );
                })}
              </div>
            ))
          )}
        </section>

        {tipConfig && (
          <section className="mt-6 w-full">
            {tipOpen ? (
              <TipPanel config={tipConfig} theme={theme} source="profile" />
            ) : (
              <button
                type="button"
                onClick={() => setTipOpen(true)}
                className="flex w-full items-center justify-center gap-2 border p-4 font-semibold transition-all hover:-translate-y-0.5"
                style={{
                  background: theme.accent,
                  color: readableTextOn(theme.accent),
                  borderColor: theme.accent,
                  borderRadius: radius,
                }}
              >
                <Heart className="h-5 w-5" /> {tipConfig.buttonText}
              </button>
            )}
          </section>
        )}

        {subTotal !== null && (
          <section className="mt-6 w-full">
            <Link
              to="/$username/subscribe"
              params={{ username: profile?.username ?? username }}
              className="flex w-full items-center justify-center gap-2 border p-4 font-semibold transition-all hover:-translate-y-0.5"
              style={{ borderColor: theme.accent, color: theme.accent, borderRadius: radius }}
            >
              <UserPlus className="h-5 w-5" /> Subscribe · {formatUsd(subTotal)}/month
            </Link>
          </section>
        )}

        {wishlists.length > 0 && (
          <section className="mt-6 w-full space-y-3">
            {wishlists.map((w) => (
              <Link
                key={w.id}
                to="/$username/wishlist/$slug"
                params={{ username: profile?.username ?? username, slug: w.slug }}
                className="flex items-center gap-4 border p-4 transition-all hover:-translate-y-0.5"
                style={{
                  background: theme.buttonStyle === "outline" ? "transparent" : theme.card,
                  color: theme.cardForeground,
                  borderColor: theme.border,
                  borderRadius: radius,
                }}
              >
                <Gift className="h-6 w-6 shrink-0" style={{ color: theme.accent }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{w.title}</div>
                  {w.occasion && <div className="text-xs opacity-70">{w.occasion}</div>}
                </div>
                <span className="text-xs opacity-70">View list →</span>
              </Link>
            ))}
          </section>
        )}

        {profile && (
          <CreatorPosts
            username={profile.username}
            theme={theme}
            radius={radius}
            outline={theme.buttonStyle === "outline"}
          />
        )}

        {showBranding && (
          <Link
            to="/"
            onClick={() => {
              trackVisit("signup_cta", profile?.user_id, { username: profile?.username });
              if (profile?.username) captureReferrer(profile.username);
            }}
            className="mt-10 inline-flex items-center gap-2 text-xs opacity-60 hover:opacity-100"
            style={{ color: theme.foreground }}
          >
            <UserPlus className="h-3 w-3" /> Get your own Yooits
          </Link>
        )}
        {profile && (
          <div className={showBranding ? "mt-3" : "mt-10"}>
            <ReportLink username={profile.username} color={theme.foreground} />
          </div>
        )}
        <Toaster />
      </main>
    </div>
  );
}
