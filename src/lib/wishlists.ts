export type Wishlist = {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  description: string | null;
  occasion: string | null;
  /** Who the list is for when it isn't the owner, e.g. a child's first name. */
  recipient_name: string | null;
  /** Owner can see which items are taken (never who took them). */
  reveal_claims: boolean;
  event_date: string | null;
  visibility: "public" | "private";
  show_on_profile: boolean;
  display_order: number;
};

export type WishlistItem = {
  id: string;
  wishlist_id: string;
  user_id: string;
  name: string;
  description: string | null;
  url: string | null;
  image_url: string | null;
  price_text: string | null;
  display_order: number;
};

export const OCCASIONS = [
  "Birthday",
  "Christmas",
  "Holidays",
  "Wedding",
  "Baby shower",
  "Graduation",
  "Housewarming",
  "Just because",
] as const;

/** URL-safe slug that satisfies the database check: a-z, 0-9 and inner hyphens, ≤ 50 chars. */
export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return s || "list";
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

/**
 * Only plain http(s) links to other sites may be saved or rendered. Mirrors
 * the database CHECK constraint; `requireHttps` is used for images to avoid
 * mixed content.
 */
export function isSafeExternalUrl(value: string, requireHttps = false): boolean {
  if (!value || value.length > 2048 || /\s/.test(value)) return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (requireHttps ? u.protocol !== "https:" : u.protocol !== "https:" && u.protocol !== "http:")
    return false;
  return u.hostname.includes(".") && !u.username && !u.password;
}

/** Turn "amazon.com/xyz" into "https://amazon.com/xyz"; returns null if still unsafe. */
export function normalizeExternalUrl(value: string, requireHttps = false): string | null {
  const v = value.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  return isSafeExternalUrl(withScheme, requireHttps) ? withScheme : null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** What wishlist_claim_status() tells a viewer. Never says who claimed. */
export type ClaimStatus = {
  enabled: boolean;
  is_owner: boolean;
  claims_on?: boolean;
  reveal_claims?: boolean;
  claimed: { item_id: string; mine: boolean }[];
};

export type ClaimResult =
  "claimed" | "taken" | "limit" | "own_list" | "unavailable" | "sign_in" | "off";

export const CLAIM_MESSAGES: Record<Exclude<ClaimResult, "claimed">, string> = {
  taken: "Someone already said they'll get this one.",
  limit: "You've claimed the most gifts allowed on this list.",
  own_list: "This is your own list.",
  unavailable: "This gift can't be claimed right now.",
  sign_in: "Sign in to claim a gift.",
  off: "Claiming gifts isn't available yet.",
};

/** "Mia's Christmas list" header line: "For Mia" when set. */
export function recipientLine(list: Pick<Wishlist, "recipient_name">): string | null {
  const n = list.recipient_name?.trim();
  return n ? `For ${n}` : null;
}

/** A gift the signed-in person said they'll buy (my_wishlist_claims()). */
export type MyClaim = {
  item_id: string;
  item_name: string;
  url: string | null;
  price_text: string | null;
  wishlist_title: string;
  wishlist_slug: string;
  recipient_name: string | null;
  username: string;
  claimed_at: string;
};
