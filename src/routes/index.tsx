import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getPlatform } from "@/lib/platforms";
import { Settings, UserPlus, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Connect with me — All my socials in one place" },
      { name: "description", content: "Find me on Instagram, Snapchat, Facebook and more. Add me as a friend across all platforms." },
    ],
  }),
});

type SocialLink = {
  id: string;
  platform: string;
  url: string;
  display_order: number;
  enabled: boolean;
};

function Home() {
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("social_links")
      .select("*")
      .eq("enabled", true)
      .order("display_order", { ascending: true })
      .then(({ data }) => {
        setLinks((data ?? []) as SocialLink[]);
        setLoading(false);
      });
  }, []);

  const visible = links.filter((l) => l.url.trim().length > 0);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Animated background blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/30 blur-3xl animate-pulse" />
        <div className="absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full bg-accent/30 blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-fuchsia-500/20 blur-3xl animate-pulse" style={{ animationDelay: "2s" }} />
      </div>

      <Link
        to="/admin"
        className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md transition hover:text-foreground"
      >
        <Settings className="h-3.5 w-3.5" />
        Manage
      </Link>

      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center px-6 py-16">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Sparkles className="h-3 w-3 text-accent" />
          Let's connect
        </div>
        <div
          className="mb-5 h-28 w-28 rounded-full p-1"
          style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}
        >
          <div className="flex h-full w-full items-center justify-center rounded-full bg-background text-4xl font-bold">
            <UserPlus className="h-10 w-10 text-foreground" />
          </div>
        </div>
        <h1 className="text-center text-4xl font-bold tracking-tight sm:text-5xl">
          Add me as a friend
        </h1>
        <p className="mt-3 max-w-md text-center text-muted-foreground">
          Pick any platform below and let's stay in touch.
        </p>

        <section className="mt-10 w-full space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-card/50" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
              No links yet. Sign in to <Link to="/admin" className="text-primary underline underline-offset-4">add yours</Link>.
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
      </main>
    </div>
  );
}
