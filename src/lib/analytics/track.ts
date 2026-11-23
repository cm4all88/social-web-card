/**
 * Browser side of analytics. Fire-and-forget: nothing here may slow down or
 * break a page. Visitors who send Do Not Track or Global Privacy Control are
 * never reported (the server checks the headers again).
 */
import type { EventKind } from "./record.server";
import { trackEvent } from "./functions";

type Extra = { username?: string | null; linkId?: string | null; wishlistSlug?: string | null };

export function browserOptedOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const w =
    typeof window !== "undefined" ? (window as Window & { doNotTrack?: string }) : undefined;
  return (
    n.doNotTrack === "1" ||
    n.msDoNotTrack === "1" ||
    w?.doNotTrack === "1" ||
    n.globalPrivacyControl === true
  );
}

function utm(): { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null } {
  try {
    const q = new URLSearchParams(window.location.search);
    return {
      utmSource: q.get("utm_source"),
      utmMedium: q.get("utm_medium"),
      utmCampaign: q.get("utm_campaign"),
    };
  } catch {
    return { utmSource: null, utmMedium: null, utmCampaign: null };
  }
}

export function track(kind: EventKind, extra: Extra = {}): void {
  if (browserOptedOut()) return;
  try {
    const referrer = typeof document !== "undefined" ? document.referrer || null : null;
    void trackEvent({ data: { kind, ...extra, referrer, ...utm() } }).catch(() => {});
  } catch {
    // ignore
  }
}

/** Like track(), but never counts a page owner looking at their own page. */
export function trackVisit(
  kind: EventKind,
  ownerUserId: string | null | undefined,
  extra: Extra = {},
): void {
  if (browserOptedOut()) return;
  import("@/integrations/supabase/client")
    .then(({ supabase }) => supabase.auth.getSession())
    .then(({ data }) => {
      if (ownerUserId && data.session?.user.id === ownerUserId) return;
      track(kind, extra);
    })
    .catch(() => track(kind, extra));
}
