/**
 * First-touch campaign attribution. When someone lands on yooits.me from a
 * campaign link (utm_*), or from someone's Yooits.me page, that's remembered in
 * this browser for 30 days and sent with their sign-up, so the Marketing
 * Center can count sign-ups, profile completions and paid upgrades per
 * campaign, platform and post. Nothing personal is stored: only the campaign
 * names from the link and the username of the page they came from.
 */
const KEY = "yooits_first_touch";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const clean = (v: string | null | undefined, max = 100) => {
  if (!v) return null;
  const s = v.trim().toLowerCase().slice(0, max);
  return /^[a-z0-9._-]+$/.test(s) ? s : null;
};

export type Touch = {
  campaign: string | null;
  source: string | null;
  medium: string | null;
  content: string | null;
  ref: string | null;
  at: number;
};

function read(): Touch | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Touch;
    if (!t || typeof t.at !== "number" || Date.now() - t.at > MAX_AGE_MS) return null;
    return t;
  } catch {
    return null;
  }
}

function write(t: Touch) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* private mode or storage blocked: attribution is best effort */
  }
}

/** Parse a touch from an address. Exported for tests. */
export function touchFromUrl(href: string, now = Date.now()): Touch | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const campaign = clean(u.searchParams.get("utm_campaign"));
  if (!campaign) return null;
  return {
    campaign,
    source: clean(u.searchParams.get("utm_source")),
    medium: clean(u.searchParams.get("utm_medium")),
    content: clean(u.searchParams.get("utm_content"), 16),
    ref: null,
    at: now,
  };
}

/** Call on every page load. Keeps the first campaign touch; a later one doesn't replace it. */
export function captureTouch() {
  if (typeof window === "undefined") return;
  const t = touchFromUrl(window.location.href);
  if (t && !read()) write(t);
}

/** Call when someone taps "made with Yooits.me" on a user's page, so the sign-up credits that page. */
export function captureReferrer(username: string) {
  if (typeof window === "undefined") return;
  const ref = clean(username, 30);
  if (!ref) return;
  const existing = read();
  if (existing) {
    if (!existing.ref) write({ ...existing, ref });
    return;
  }
  write({
    campaign: null,
    source: "yooits",
    medium: "profile",
    content: null,
    ref,
    at: Date.now(),
  });
}

/** Extra sign-up metadata (mkt_*). Empty object when there's nothing to credit. */
export function signupAttribution(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = read();
  if (!t) return {};
  const out: Record<string, string> = {};
  if (t.campaign) out.mkt_campaign = t.campaign;
  if (t.source) out.mkt_source = t.source;
  if (t.medium) out.mkt_medium = t.medium;
  if (t.content) out.mkt_content = t.content;
  if (t.ref) out.mkt_ref = t.ref;
  return out;
}
