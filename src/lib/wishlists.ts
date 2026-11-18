export type Wishlist = {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  description: string | null;
  occasion: string | null;
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
