import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  createCreatorSubscriptionCheckout,
  getMyCreatorSubscriptionCheckout,
  getPublicCreatorSubscription,
  type PublicCreatorSubscription,
} from "@/lib/creator/subscription-functions";
import { formatUsd } from "@/lib/tipping/money";
import { readableTextOn } from "@/lib/contrast";
import { buttonRadiusFor, fontFamilyFor } from "@/lib/themes";
import { usePublicProfile } from "@/lib/use-public-profile";

const searchSchema = z.object({
  status: z.enum(["success", "cancelled"]).optional().catch(undefined),
  session_id: z.string().max(300).optional().catch(undefined),
});

/**
 * yooits.me/<username>/subscribe. Shows a subscription only when the server
 * says a checkout would work (getPublicCreatorSubscription), so nothing is
 * offered that can't be bought. Off on yooits.me until payments are approved.
 */
export const Route = createFileRoute("/$username_/subscribe")({
  validateSearch: searchSchema,
  component: SubscribePage,
  head: ({ params }) => ({
    meta: [
      { title: `Subscribe to @${params.username} — Yooits` },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type Offer = Extract<PublicCreatorSubscription, { available: true }>;
type Result =
  | { status: "active"; totalCents: number; priceCents: number; renewsAt: string | null }
  | { status: "processing" | "not_started" | "unknown" };

function SubscribePage() {
  const { username } = Route.useParams();
  const { status, session_id } = Route.useSearch();
  const { profile, state, theme, name } = usePublicProfile(username);
  const [offer, setOffer] = useState<Offer | null | "loading">("loading");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  useEffect(() => {
    if (state !== "ready" || !profile) return;
    getPublicCreatorSubscription({ data: { username: profile.username } })
      .then((o) => setOffer(o.available ? o : null))
      .catch(() => setOffer(null));
  }, [state, profile]);

  useEffect(() => {
    if (status !== "success" || !session_id || !signedIn) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      getMyCreatorSubscriptionCheckout({ data: { sessionId: session_id } })
        .then((r) => {
          setResult(r as Result);
          // The payment webhook usually lands within seconds.
          if (r.status === "processing" && tries++ < 8) timer = setTimeout(poll, 2000);
        })
        .catch(() => setResult({ status: "unknown" }));
    };
    poll();
    return () => clearTimeout(timer);
  }, [status, session_id, signedIn]);

  const radius = buttonRadiusFor(theme.buttonStyle);
  const handle = profile?.username ?? username;

  const subscribe = async () => {
    if (!signedIn) {
      window.location.assign(`/auth?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { url } = await createCreatorSubscriptionCheckout({
        data: { username: handle, adultConfirmed: true },
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  };

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
        <p className="mb-6 text-sm opacity-70">@{handle}</p>
        {children}
        <Link
          to="/$username"
          params={{ username: handle }}
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
    if (signedIn === false)
      return shell(<p className="text-center opacity-80">Sign in to see your subscription.</p>);
    if (!result) return shell(<Loader2 className="h-6 w-6 animate-spin" />);
    if (result.status === "active") {
      return shell(
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-12 w-12" style={{ color: theme.accent }} />
          <p className="mt-4 text-xl font-semibold">You're subscribed</p>
          <p className="mt-2 opacity-80">
            {formatUsd(result.totalCents)} a month, and {name} gets {formatUsd(result.priceCents)}{" "}
            of it.
            {result.renewsAt
              ? ` It renews on ${new Date(result.renewsAt).toLocaleDateString()}.`
              : ""}
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
        We couldn't confirm this subscription yet. Check your card statement before trying again.
      </p>,
    );
  }

  if (offer === "loading" || state === "loading")
    return shell(<Loader2 className="h-6 w-6 animate-spin" />);
  if (!offer)
    return shell(
      <p className="text-center opacity-80">{name} isn't taking subscriptions right now.</p>,
    );

  return shell(
    <div className="w-full space-y-4">
      {status === "cancelled" && (
        <p className="text-center text-sm opacity-80">Checkout cancelled. You weren't charged.</p>
      )}
      {offer.description && <p className="whitespace-pre-line opacity-90">{offer.description}</p>}
      <dl
        className="space-y-1 border p-4 text-sm"
        style={{ borderColor: `${theme.foreground}33`, borderRadius: radius }}
      >
        <div className="flex justify-between">
          <dt>Subscription to {offer.displayName}</dt>
          <dd>{formatUsd(offer.priceCents)}</dd>
        </div>
        <div className="flex justify-between opacity-80">
          <dt>Yooits service and processing fee</dt>
          <dd>{formatUsd(offer.serviceFeeCents)}</dd>
        </div>
        <div
          className="flex justify-between border-t pt-2 font-semibold"
          style={{ borderColor: `${theme.foreground}22` }}
        >
          <dt>Total each month</dt>
          <dd>{formatUsd(offer.totalCents)}</dd>
        </div>
      </dl>
      <p className="text-xs opacity-70">
        {offer.displayName} keeps the full {formatUsd(offer.priceCents)}. The fee covers Yooits and
        card processing. Cancel anytime; you keep access until the end of the month you paid for.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={adult}
          onChange={(e) => setAdult(e.target.checked)}
        />
        <span>I'm 18 or older.</span>
      </label>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        type="button"
        disabled={!adult || busy || signedIn === null}
        onClick={subscribe}
        className="flex w-full items-center justify-center gap-2 border p-4 font-semibold transition-all disabled:opacity-50"
        style={{
          background: theme.accent,
          color: readableTextOn(theme.accent),
          borderColor: theme.accent,
          borderRadius: radius,
        }}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {signedIn === false
          ? "Sign in to subscribe"
          : `Subscribe for ${formatUsd(offer.totalCents)}/month`}
      </button>
      <p className="text-center text-xs opacity-60">Secure checkout by Stripe.</p>
    </div>,
  );
}
