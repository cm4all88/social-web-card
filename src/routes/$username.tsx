import { PublicProducts } from "@/components/creator/DigitalProducts";
import { profileBlocks } from "@/lib/profile-blocks";
import { ProfileWishlists, type WishlistSummary } from "@/components/profile/ProfileWishlists";
import { MessageButton } from "@/components/messages/MessageButton";
import { captureReferrer } from "@/lib/marketing/attribution";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Fragment, lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ProfileBody,
  ProfileCards,
  ProfileIdentity,
  ProfileSurface,
  type ProfileLink,
} from "@/components/profile/ProfilePresentation";
import { type LinkSection } from "@/lib/links/groups";
import { getTheme, isRewardTheme, buttonRadiusFor, type ThemeTokens } from "@/lib/themes";
import { Heart, Share2, UserPlus } from "lucide-react";
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
import { findSkin, parseSkinState, resolveSkin, THEME_DEFAULT_SKIN } from "@/lib/skins";
import { safeBackgroundUrl } from "@/lib/backgrounds";
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
        { title: `${title} — Yooits.me` },
        { name: "description", content: description },
        { property: "og:title", content: `${title} on Yooits.me` },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        ...(og ? [{ property: "og:url", content: `https://yooits.me/${og.username}` }] : []),
        ...(image
          ? [
              { property: "og:image", content: image },
              { name: "twitter:image", content: image },
            ]
          : []),
        { name: "twitter:title", content: `${title} on Yooits.me` },
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
  avatar_gallery?: string[] | null;
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
  avatar_gallery?: string[] | null;
  profile_blocks?: string[] | null;
  theme: string | null;
  custom_theme: Partial<ThemeTokens> | null;
  hide_branding?: boolean | null;
  skin?: string | null;
  background_url?: string | null;
  avatar_size?: number | null;
  skin_intensity?: string;
  bio_alignment?: string | null;
};

function ProfilePage() {
  const { username } = Route.useParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [links, setLinks] = useState<ProfileLink[]>([]);
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
      setLinks((l ?? []) as ProfileLink[]);
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

  const name = profile?.display_name || profile?.username || username;
  const theme = getTheme(profile?.theme, profile?.custom_theme, { plus, unlocked });
  const showBranding = !(plus && profile?.hide_branding);
  const radius = buttonRadiusFor(theme.buttonStyle);
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
          title: `${name} on Yooits.me`,
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

  const blocks = profileBlocks(profile?.profile_blocks);
  const supportActions = (
    <>
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
    </>
  );

  return (
    <ProfileSurface theme={theme} skin={skin} background={bg} motion={profile?.skin_intensity}>
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
      <ProfileBody>
        <ProfileIdentity
          name={name}
          username={profile?.username ?? username}
          avatar={profile?.avatar_url}
          avatarGallery={profile?.avatar_gallery}
          qrUrl={
            profile
              ? `${typeof window === "undefined" ? "https://yooits.me" : window.location.origin}/${profile.username}`
              : undefined
          }
          bio={profile?.bio}
          avatarSize={profile?.avatar_size}
          bioAlignment={profile?.bio_alignment}
          theme={theme}
          interactive
        />
        {profile && (
          <MessageButton
            username={profile.username}
            className="mt-5 inline-flex items-center gap-2 border px-5 py-2 text-sm font-semibold transition-all hover:-translate-y-0.5"
            style={{ borderColor: theme.accent, color: theme.foreground, borderRadius: radius }}
          />
        )}

        {blocks.length === 0 && supportActions}
        {blocks.map((block, index) => (
          <Fragment key={block}>
            {block === "links" && (
              <ProfileCards
                links={links}
                sections={sections}
                loading={loading}
                theme={theme}
                skin={skin}
                onLinkClick={(linkId) =>
                  trackVisit("link_click", profile?.user_id, {
                    username: profile?.username,
                    linkId,
                  })
                }
              />
            )}
            {block === "wishlists" && (
              <ProfileWishlists
                lists={wishlists}
                username={profile?.username ?? username}
                theme={theme}
              />
            )}
            {block === "posts" && profile && (
              <CreatorPosts
                username={profile.username}
                theme={theme}
                radius={radius}
                outline={theme.buttonStyle === "outline"}
              />
            )}
            {block === "products" && profile && (
              <PublicProducts key={profile.user_id} sellerId={profile.user_id} username={profile.username} theme={theme} />
            )}
            {index === 0 && supportActions}
          </Fragment>
        ))}

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
            <UserPlus className="h-3 w-3" /> Create your free profile on Yooits.me
          </Link>
        )}
        {profile && (
          <div className={showBranding ? "mt-3" : "mt-10"}>
            <ReportLink username={profile.username} color={theme.foreground} />
          </div>
        )}
        <Toaster />
      </ProfileBody>
    </ProfileSurface>
  );
}
