import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getPlatform } from "@/lib/platforms";
import { UserPlus } from "lucide-react";

export const Route = createFileRoute("/$username")({
  component: ProfilePage,
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} — LinkHub` },
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

type Profile = { id: string; user_id: string; username: string; display_name: string | null; bio: string | null };
type SocialLink = { id: string; platform: string; url: string; display_order: number; enabled: boolean };

function ProfilePage() {
  const { username } = Route.useParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

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
    };
    run();
  }, [username]);

  if (missing) {
    throw notFound();
  }

  const visible = links.filter((l) => l.url.trim().length > 0);
  const name = profile?.display_name || profile?.username || username;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/30 blur-3xl animate-pulse" />
        <div className="absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full bg-accent/30 blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-fuchsia-500/20 blur-3xl animate-pulse" style={{ animationDelay: "2s" }} />
      </div>

      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center px-6 py-16">
        <div
          className="mb-5 h-28 w-28 rounded-full p-1"
          style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}
        >
          <div className="flex h-full w-full items-center justify-center rounded-full bg-background text-3xl font-bold">
            {name.slice(0, 1).toUpperCase()}
          </div>
        </div>
        <h1 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">@{profile?.username ?? username}</p>
        {profile?.bio && (
          <p className="mt-4 max-w-md text-center text-muted-foreground">{profile.bio}</p>
        )}

        <section className="mt-10 w-full space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-card/50" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
              No links added yet.
            </div>
          ) : (
            visible.map((link) => {
              const meta = getPlatform(link.platform);
              const Icon = meta.icon;
              return (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50"
                  style={{ boxShadow: "var(--shadow-card)" }}
                >
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${meta.color} text-white shadow-lg`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{meta.label}</div>
                    <div className="truncate text-sm text-muted-foreground">{link.url}</div>
                  </div>
                  <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary opacity-0 transition group-hover:opacity-100">
                    Connect →
                  </div>
                </a>
              );
            })
          )}
        </section>

        <Link to="/" className="mt-10 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
          <UserPlus className="h-3 w-3" /> Get your own LinkHub
        </Link>
      </main>
    </div>
  );
}
