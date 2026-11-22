/**
 * Rules for the URLs creators put on their page. Mirrors
 * public.link_url_is_allowed() in the Phase 0 migration, which is the
 * authority; these helpers give early errors and safe rendering.
 */

const ALLOWED_SCHEME = /^(https?:\/\/|mailto:|tel:|sms:)/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const BARE_DOMAIN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#][^\s]*)?$/i;
// "https://paypal.com@evil.example" opens evil.example: a classic phishing
// disguise. Refuse any web link with a user name or password before the host.
const USERINFO = /^https?:\/\/[^/?#]*@/i;

/** True when the database will accept this link value. */
export function isAllowedLinkValue(value: string): boolean {
  if (value.length > 2048) return false;
  if (value !== value.trim()) return false;
  if (CONTROL.test(value)) return false;
  if (value === "") return true;
  if (USERINFO.test(value)) return false;
  if (ALLOWED_SCHEME.test(value)) return true;
  return !ANY_SCHEME.test(value);
}

/**
 * Clean up what a creator typed: trim it, and add https:// to a bare domain.
 * Returns null when the value uses a scheme we don't allow.
 */
export function normalizeLinkValue(value: string): string | null {
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!v) return "";
  if (USERINFO.test(v)) return null;
  if (ALLOWED_SCHEME.test(v)) return v;
  if (ANY_SCHEME.test(v)) return null;
  if (BARE_DOMAIN.test(v) && !EMAIL.test(v)) return `https://${v}`;
  return v;
}

/**
 * The href to render on a public page, or undefined when the value isn't a
 * safe, clickable link (for example a Discord handle).
 */
export function safeLinkHref(value: string | null | undefined): string | undefined {
  const v = (value ?? "").trim();
  if (!v || CONTROL.test(v) || USERINFO.test(v)) return undefined;
  if (ALLOWED_SCHEME.test(v)) return v;
  if (ANY_SCHEME.test(v)) return undefined;
  if (EMAIL.test(v)) return `mailto:${v}`;
  if (BARE_DOMAIN.test(v)) return `https://${v}`;
  return undefined;
}

/**
 * The site a web link really opens ("paypal.com"), shown under each link on a
 * public page so a tile labelled with one brand can't hide another site.
 * Undefined for mailto:, tel:, sms: and anything that isn't a web link.
 */
export function linkDisplayHost(href: string | undefined): string | undefined {
  if (!href || !/^https?:\/\//i.test(href)) return undefined;
  try {
    return new URL(href).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}
