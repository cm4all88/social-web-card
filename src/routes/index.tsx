import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight } from "lucide-react";
import logo from "@/assets/yooits-logo.png";
import { LegalLinks } from "@/components/legal/LegalPage";
import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Yooits — All your socials, one shareable link" },
      { name: "description", content: "Create your personal link page. Share every social account in one place." },
    ],
  }),
});

function Home() {
  useEffect(() => track("home_view"), []);
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/30 blur-3xl animate-pulse" />
        <div className="absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full bg-accent/30 blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-fuchsia-500/20 blur-3xl animate-pulse" style={{ animationDelay: "2s" }} />
      </div>

      <Link
        to="/auth"
        className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md transition hover:text-foreground"
      >
        Sign in
      </Link>

      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Sparkles className="h-3 w-3 text-accent" />
          One link. All your socials.
        </div>
        <img
          src={logo}
          alt="yooits.me"
          className="mb-6 w-72 max-w-full sm:w-96"
          style={{ filter: "drop-shadow(0 10px 40px oklch(0.6 0.25 310 / 0.45))" }}
        />
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Your socials, beautifully linked
        </h1>
        <p className="mt-4 max-w-md text-muted-foreground">
          Get your own page at <span className="font-semibold text-foreground">/yourname</span> and share all your accounts with a single link.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            onClick={() => track("signup_cta")}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            style={{ boxShadow: "var(--shadow-glow)" }}
          >
            Claim your link <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Free to join. Pick your username and go.
        </p>
        <LegalLinks className="mt-10" />
      </main>
    </div>
  );
}
