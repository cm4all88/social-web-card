import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getPlatform } from "@/lib/platforms";
import { safeLinkHref } from "@/lib/safe-url";
import { getTheme, fontFamilyFor, buttonRadiusFor, type ThemeTokens } from "@/lib/themes";
import { Gift, Heart, UserPlus } from "lucide-react";
import { TipPanel, type PublicTipConfig } from "@/components/tipping/TipPanel";
import { readableTextOn } from "@/lib/contrast";
import { getPublicTipConfig } from "@/lib/tipping/functions";

export const Route = createFileRoute("/$username")({
  component: ProfilePage,
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} — Yooits` },
      { name: "description", content: `Connect with @${params.username} across all their social platforms.` },
      { property: "og:title", content: `@${params.username}` },
      { property: "og:description", content: `Find @${params.username} on every platform.` },
    ],
  }),
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold">User not found</h1>
      <p className="mt-2 text-muted-foreground">No one has claimed this link yet.</p>
      <Link to="/" className="mt-6 text-primary hover:underline">← Home</Link>
    </div>
  ),
});

type Profile = {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  theme: string | null;
  custom_theme: Partial<ThemeTokens> | null;
};
type SocialLink = { id: string; platform: string; url: string; display_order: number; enabled: boolean };
type WishlistSummary = { id: string; slug: string; title: string; occasion: string | null };

function ProfilePage() {
  const { username } = Route.useParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tipConfig, setTipConfig] = useState<PublicTipConfig | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [wishlists, setWishlists] = useState<WishlistSummary[]>([]);

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
      setProfile(prof as Profile);
      const { data: l } = await supabase
        .from("social_links")
        .select("*")
        .eq("user_id", prof.user_id)
        .eq("enabled", true)
        .order("display_order", { ascending: true });
      setLinks((l ?? []) as SocialLink[]);
      setLoading(false);

      // Optional sections; failures here must never break the profile page.
      getPublicTipConfig({ data: { username: prof.username } })
        .then((cfg) => setTipConfig(cfg.available && cfg.showOnProfile ? cfg : null))
        .catch(() => setTipConfig(null));
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
  const name = profile?.display_name || profile?.username || username;
  const theme = getTheme(profile?.theme, profile?.custom_theme);
  const radius = buttonRadiusFor(theme.buttonStyle);
  const font = fontFamilyFor(theme.font);

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: theme.background, color: theme.foreground, fontFamily: font }}
    >
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center px-6 py-16">
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
        {profile?.bio && (
          <p className="mt-4 max-w-md text-center opacity-80">{profile.bio}</p>
        )}

        <section className="mt-10 w-full space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl opacity-30" style={{ background: theme.card }} />
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
            visible.map((link) => {
              const meta = getPlatform(link.platform);
              const Icon = meta.icon;
              const isOutline = theme.buttonStyle === "outline";
              const href = safeLinkHref(link.url);
              return (
                <a
                  key={link.id}
                  href={href}
                  target={href ? "_blank" : undefined}
                  rel="noreferrer noopener"
                  className="group relative flex items-center gap-4 overflow-hidden border p-4 transition-all hover:-translate-y-0.5"
                  style={{
                    background: isOutline ? "transparent" : theme.card,
                    color: theme.cardForeground,
                    borderColor: theme.border,
                    borderRadius: radius,
                    boxShadow: isOutline ? "none" : "0 8px 24px -12px rgba(0,0,0,0.3)",
                  }}
                >
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${meta.color} text-white shadow-lg`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{meta.label}</div>
                    {!href && <div className="truncate text-xs opacity-70">{link.url}</div>}
                  </div>
                  <div
                    className="rounded-full px-3 py-1 text-xs font-medium opacity-70 transition group-hover:opacity-100"
                    style={{ background: `${theme.accent}22`, color: theme.accent }}
                  >
                    Connect →
                  </div>
                </a>
              );
            })
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

        <Link to="/" className="mt-10 inline-flex items-center gap-2 text-xs opacity-60 hover:opacity-100" style={{ color: theme.foreground }}>
          <UserPlus className="h-3 w-3" /> Get your own Yooits
        </Link>
      </main>
    </div>
  );
}

