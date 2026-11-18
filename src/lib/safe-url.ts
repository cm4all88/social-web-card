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

/** True when the database will accept this link value. */
export function isAllowedLinkValue(value: string): boolean {
  if (value.length > 2048) return false;
  if (value !== value.trim()) return false;
  if (CONTROL.test(value)) return false;
  if (value === "") return true;
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
  if (!v || CONTROL.test(v)) return undefined;
  if (ALLOWED_SCHEME.test(v)) return v;
  if (ANY_SCHEME.test(v)) return undefined;
  if (EMAIL.test(v)) return `mailto:${v}`;
  if (BARE_DOMAIN.test(v)) return `https://${v}`;
  return undefined;
}
