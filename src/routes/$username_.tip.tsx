import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { TipPanel, type PublicTipConfig } from "@/components/tipping/TipPanel";
import { getPublicTipConfig, getTipCheckoutResult } from "@/lib/tipping/functions";
import { formatUsd } from "@/lib/tipping/money";
import { fontFamilyFor } from "@/lib/themes";
import { usePublicProfile } from "@/lib/use-public-profile";

const searchSchema = z.object({
  status: z.enum(["success", "cancelled"]).optional().catch(undefined),
  session_id: z.string().max(300).optional().catch(undefined),
});

/** Direct, shareable tip link: yooits.me/<username>/tip */
export const Route = createFileRoute("/$username_/tip")({
  validateSearch: searchSchema,
  component: TipPage,
  head: ({ params }) => ({
    meta: [
      { title: `Tip @${params.username} — Yooits.me` },
      {
        name: "description",
        content: `Send @${params.username} a tip. Secure checkout by Stripe.`,
      },
      { property: "og:title", content: `Tip @${params.username}` },
      { property: "og:description", content: `Send @${params.username} a tip on Yooits.me.` },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type Result =
  | { status: "paid"; tipCents: number; totalCents: number }
  | { status: "processing" | "not_paid" | "unknown" };

function TipPage() {
  const { username } = Route.useParams();
  const { status, session_id } = Route.useSearch();
  const { profile, state, theme, name } = usePublicProfile(username);
  const [config, setConfig] = useState<PublicTipConfig | null | "loading">("loading");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (state !== "ready" || !profile) return;
    getPublicTipConfig({ data: { username: profile.username } })
      .then((cfg) => setConfig(cfg.available ? cfg : null))
      .catch(() => setConfig(null));
  }, [state, profile]);

  useEffect(() => {
    if (status !== "success" || !session_id) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      getTipCheckoutResult({ data: { sessionId: session_id } })
        .then((r) => {
          setResult(r as Result);
          // Card payments settle in seconds; poll briefly while the webhook lands.
          if (r.status === "processing" && tries++ < 5) timer = setTimeout(poll, 2000);
        })
        .catch(() => setResult({ status: "unknown" }));
    };
    poll();
    return () => clearTimeout(timer);
  }, [status, session_id]);

  const shell = (children: React.ReactNode) => (
    <div
      className="min-h-screen"
      style={{
        background: theme.background,
        color: theme.foreground,
        fontFamily: fontFamilyFor(theme.font),
      }}
    >
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center px-5 py-12">
        {profile?.avatar_url && (
          <img
            src={profile.avatar_url}
            alt={name}
            className="mb-4 h-20 w-20 rounded-full object-cover"
          />
        )}
        <h1 className="text-center text-2xl font-bold">{name}</h1>
        <p className="mb-6 text-sm opacity-70">@{profile?.username ?? username}</p>
        {children}
        <Link
          to="/$username"
          params={{ username: profile?.username ?? username }}
          className="mt-8 text-sm opacity-70 hover:opacity-100"
        >
          ← Back to profile
        </Link>
      </main>
    </div>
  );

  if (state === "missing")
    return shell(<p className="opacity-80">No one has claimed this link yet.</p>);

  if (status === "success") {
    if (!result) return shell(<Loader2 className="h-6 w-6 animate-spin" />);
    if (result.status === "paid") {
      return shell(
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-12 w-12" style={{ color: theme.accent }} />
          <p className="mt-4 text-xl font-semibold">Thank you!</p>
          <p className="mt-2 opacity-80">
            Your {formatUsd(result.tipCents)} tip to {name} went through. You paid{" "}
            {formatUsd(result.totalCents)} including the Yooits.me service fee.
          </p>
        </div>,
      );
    }
    if (result.status === "processing") {
      return shell(
        <p className="text-center opacity-80">
          Your payment is still processing. Check back on this page in a minute.
        </p>,
      );
    }
    return shell(
      <p className="text-center opacity-80">
        We couldn't confirm this payment yet. Check your card statement before trying again.
      </p>,
    );
  }

  if (config === "loading" || state === "loading")
    return shell(<Loader2 className="h-6 w-6 animate-spin" />);
  if (!config)
    return shell(<p className="text-center opacity-80">{name} isn't accepting tips right now.</p>);

  return shell(
    <>
      {status === "cancelled" && (
        <p className="mb-4 w-full text-center text-sm opacity-80">
          Payment cancelled. You weren't charged.
        </p>
      )}
      <TipPanel config={config} theme={theme} source="link" />
    </>,
  );
}
