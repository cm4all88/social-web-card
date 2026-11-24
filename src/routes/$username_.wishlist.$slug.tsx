import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buttonRadiusFor, fontFamilyFor } from "@/lib/themes";
import { usePublicProfile } from "@/lib/use-public-profile";
import { trackVisit } from "@/lib/analytics/track";
import { ReportLink } from "@/components/reports/ReportLink";
import { Toaster } from "@/components/ui/sonner";
import {
  CLAIM_MESSAGES,
  hostOf,
  isSafeExternalUrl,
  recipientLine,
  type ClaimResult,
  type ClaimStatus,
  type Wishlist,
  type WishlistItem,
} from "@/lib/wishlists";

type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase as unknown as Rpc).rpc(fn, args);
const NO_CLAIMS: ClaimStatus = { enabled: false, is_owner: false, claimed: [] };

/** Public wishlist: yooits.me/<username>/wishlist/<slug>. Link-out only; nothing is sold here. */
export const Route = createFileRoute("/$username_/wishlist/$slug")({
  component: WishlistPage,
  head: ({ params }) => ({
    meta: [
      { title: `Wishlist by @${params.username} — Yooits.me` },
      { property: "og:title", content: `@${params.username}'s wishlist` },
      { property: "og:description", content: `See what @${params.username} is wishing for.` },
    ],
  }),
});

function WishlistPage() {
  const { username, slug } = Route.useParams();
  const { profile, state, theme, name } = usePublicProfile(username);
  const [list, setList] = useState<Wishlist | null>(null);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [claims, setClaims] = useState<ClaimStatus>(NO_CLAIMS);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadClaims = useCallback(async (wishlistId: string) => {
    const { data, error } = await rpc("wishlist_claim_status", { _wishlist_id: wishlistId });
    // Before the claims migration, or on any error, the page works as plain link-out.
    setClaims(!error && data ? (data as ClaimStatus) : NO_CLAIMS);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  useEffect(() => {
    if (state !== "ready" || !profile) return;
    (async () => {
      // RLS returns public lists to everyone and private lists only to their owner.
      const { data: w } = await supabase
        .from("wishlists")
        .select("*")
        .eq("user_id", profile.user_id)
        .eq("slug", slug.toLowerCase())
        .maybeSingle();
      setList((w as Wishlist | null) ?? null);
      if (w) {
        trackVisit("wishlist_view", profile.user_id, {
          username: profile.username,
          wishlistSlug: slug,
        });
        const { data: it } = await supabase
          .from("wishlist_items")
          .select("*")
          .eq("wishlist_id", w.id)
          .order("display_order", { ascending: true });
        setItems((it ?? []) as WishlistItem[]);
        await loadClaims(w.id);
      }
      setLoaded(true);
    })();
  }, [state, profile, slug, loadClaims]);

  const claimedBy = new Map(claims.claimed.map((c) => [c.item_id, c.mine]));

  const toggleClaim = async (item: WishlistItem) => {
    if (!list) return;
    if (!signedIn) {
      window.location.assign(`/auth?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setBusy(item.id);
    try {
      if (claimedBy.get(item.id) === true) {
        const { error } = await rpc("unclaim_wishlist_item", { _item_id: item.id });
        if (error) throw new Error(error.message);
        toast.success("Okay, it's free for someone else.");
      } else {
        const { data, error } = await rpc("claim_wishlist_item", { _item_id: item.id });
        if (error) throw new Error(error.message);
        const r = data as ClaimResult;
        if (r === "claimed") toast.success("Marked as yours. Only you can see it's you.");
        else toast.error(CLAIM_MESSAGES[r] ?? "Couldn't claim that gift.");
      }
      await loadClaims(list.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const radius = buttonRadiusFor(theme.buttonStyle);

  return (
    <div
      className="min-h-screen"
      style={{
        background: theme.background,
        color: theme.foreground,
        fontFamily: fontFamilyFor(theme.font),
      }}
    >
      <main className="mx-auto max-w-2xl px-5 py-12">
        <Link
          to="/$username"
          params={{ username: profile?.username ?? username }}
          className="text-sm opacity-70 hover:opacity-100"
        >
          ← {name}
        </Link>

        {state === "missing" || (loaded && !list) ? (
          <div className="mt-16 text-center">
            <h1 className="text-2xl font-bold">Wishlist not found</h1>
            <p className="mt-2 opacity-70">It may be private or no longer shared.</p>
          </div>
        ) : !loaded || !list ? (
          <Loader2 className="mx-auto mt-16 h-6 w-6 animate-spin" />
        ) : (
          <>
            <header className="mt-6 text-center">
              <Gift className="mx-auto h-10 w-10" style={{ color: theme.accent }} />
              <h1 className="mt-3 text-3xl font-bold">{list.title}</h1>
              {recipientLine(list) && (
                <p className="mt-1 text-base font-medium opacity-90">{recipientLine(list)}</p>
              )}
              <p className="mt-1 text-sm opacity-70">
                {[
                  list.occasion,
                  list.event_date &&
                    new Date(`${list.event_date}T12:00:00`).toLocaleDateString(undefined, {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {list.description && (
                <p className="mx-auto mt-4 max-w-md whitespace-pre-line opacity-80">
                  {list.description}
                </p>
              )}
              {list.visibility === "private" && (
                <p className="mt-3 text-xs opacity-70">
                  Only you can see this list. Make it public to share it.
                </p>
              )}
            </header>

            {items.length === 0 ? (
              <p className="mt-10 text-center opacity-70">Nothing on this list yet.</p>
            ) : (
              <ul className="mt-10 grid gap-4 sm:grid-cols-2">
                {items.map((item) => {
                  const href = item.url && isSafeExternalUrl(item.url) ? item.url : null;
                  const img =
                    item.image_url && isSafeExternalUrl(item.image_url, true)
                      ? item.image_url
                      : null;
                  const mine = claimedBy.get(item.id) === true;
                  const taken = claimedBy.has(item.id) && !mine;
                  return (
                    <li
                      key={item.id}
                      className={`flex flex-col overflow-hidden border ${taken ? "opacity-60" : ""}`}
                      style={{
                        background: theme.card,
                        color: theme.cardForeground,
                        borderColor: theme.border,
                        borderRadius: radius === "9999px" ? "1.5rem" : radius,
                      }}
                    >
                      {img && (
                        <img
                          src={img}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-44 w-full bg-white object-contain"
                        />
                      )}
                      <div className="flex flex-1 flex-col p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h2 className="font-semibold">{item.name}</h2>
                          {item.price_text && (
                            <span className="shrink-0 text-sm opacity-80">{item.price_text}</span>
                          )}
                        </div>
                        {item.description && (
                          <p className="mt-1 whitespace-pre-line text-sm opacity-80">
                            {item.description}
                          </p>
                        )}
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="mt-4 inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-sm font-medium"
                            style={{ background: `${theme.accent}22`, color: theme.accent }}
                          >
                            View at {hostOf(href)} <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {claims.is_owner && claims.reveal_claims && claimedBy.has(item.id) && (
                          <p className="mt-3 text-sm font-medium">Someone&apos;s getting this</p>
                        )}
                        {!claims.is_owner && taken && (
                          <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium">
                            <Check className="h-4 w-4" /> Someone&apos;s getting this
                          </p>
                        )}
                        {claims.enabled && !taken && (
                          <button
                            type="button"
                            disabled={busy === item.id}
                            onClick={() => toggleClaim(item)}
                            className="mt-3 inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-60"
                            style={{
                              border: `${mine ? 2 : 1}px solid ${mine ? theme.accent : theme.border}`,
                              color: theme.cardForeground,
                            }}
                          >
                            {busy === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : mine ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Gift className="h-3.5 w-3.5" />
                            )}
                            {mine ? "You're getting this · undo" : "I'll buy it"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-10 text-center text-xs opacity-60">
              Links go to other stores. Yooits.me doesn&apos;t sell these items or handle these
              purchases.
              {claims.enabled &&
                " Tap “I'll buy it” so others know it's covered. The list owner isn't told who."}
            </p>
            {profile && list && (
              <div className="mt-3 text-center">
                <ReportLink
                  username={profile.username}
                  wishlistSlug={list.slug}
                  color={theme.foreground}
                />
              </div>
            )}
          </>
        )}
        <Toaster />
      </main>
    </div>
  );
}
