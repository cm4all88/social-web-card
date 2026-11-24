/**
 * One username rule for signup, the profile editor and the database
 * (profiles.username_format). The database is the authority; this copy gives
 * people an early, friendly message.
 */
export const USERNAME_RE = /^[a-z0-9_-]{2,30}$/;

export const USERNAME_HELP = "2–30 characters: lowercase letters, numbers, _ or -";

/**
 * Mirror of public.reserved_usernames (Phase 0 migration). The database check
 * is what actually blocks a name; keep this list in step for nicer errors.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin", "administrator", "owner", "dashboard", "auth", "api",
  "login", "logout", "signin", "signup", "sign-in", "sign-up",
  "register", "reset-password", "password", "verify", "callback",
  "settings", "account", "accounts", "profile", "profiles",
  "user", "users", "me", "home", "index", "app", "www",
  "static", "assets", "public", "favicon", "robots", "sitemap",
  "webhook", "webhooks", "stripe", "tip", "tips", "wishlist",
  "wishlists", "revenue", "billing", "payments", "payment",
  "explore", "search", "null", "undefined", "root", "system",
  "yooits", "yooitsme", "yoo", "official", "staff", "team",
  "support", "help", "helpdesk", "contact", "about", "security",
  "abuse", "report", "moderator", "mod", "mods", "legal",
  "terms", "privacy", "status", "pricing", "pro", "premium",
  "verified", "mail", "email", "noreply", "no-reply", "blog",
  "news", "press", "jobs", "careers", "docs", "shop", "store",
]);

/**
 * Mirror of public.impersonation_terms and public.username_skeleton()
 * (20261122100000_username_impersonation migration). The database decides;
 * this copy lets signup say why before the form is sent.
 */
export const IMPERSONATION_TERMS: Readonly<Record<"contains" | "exact" | "affix", readonly string[]>> = {
  contains: [
  "paypal", "venmo", "cashapp", "coinbase", "binance", "metamask", "robinhood", "wellsfargo",
  "bankofamerica", "americanexpress", "mastercard", "applepay", "googlepay", "klarna", "afterpay",
  "instagram", "whatsapp", "tiktok", "snapchat", "facebook", "youtube", "twitter", "bluesky",
  "linkedin", "telegram", "discord", "twitch", "spotify", "netflix", "onlyfans", "patreon",
  "linktree", "pinterest", "reddit", "google", "gmail", "microsoft", "icloud", "appleid", "amazon",
  "walmart", "shopify", "openai", "chatgpt", "anthropic", "yooits", "tahoma",
  ],
  exact: [
  "zelle", "chase", "stripe", "visa", "amex", "messenger", "threads", "kofi", "meta", "outlook",
  "apple", "ebay",
  ],
  affix: [
  "admin", "administrator", "moderator", "support", "helpdesk", "security", "official", "verify",
  "verified", "customerservice", "trustandsafety",
  ],
};

/** A name's visible shape with common disguises undone ("Pay-Pa1" -> "paypal"). */
export function usernameSkeleton(value: string): string {
  const from = "0134579i";
  const to = "oleastgl";
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_.]/g, "")
    .replace(/[0134579i]/g, (c) => to[from.indexOf(c)])
    .replaceAll("rn", "m");
}

/** True when a name copies a major brand, Yooits.me or its staff. */
export function usernameIsImpersonation(value: string): boolean {
  const k = usernameSkeleton(value);
  if (!k) return false;
  for (const t of IMPERSONATION_TERMS.contains) if (k.includes(usernameSkeleton(t))) return true;
  for (const t of IMPERSONATION_TERMS.exact) if (k === usernameSkeleton(t)) return true;
  for (const t of IMPERSONATION_TERMS.affix) {
    const s = usernameSkeleton(t);
    if (k.startsWith(s) || k.endsWith(s)) return true;
  }
  for (const r of RESERVED_USERNAMES) if (usernameSkeleton(r) === k) return true;
  return false;
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** Returns an error message, or null when the username is acceptable. */
export function usernameError(value: string): string | null {
  const u = normalizeUsername(value);
  if (!USERNAME_RE.test(u)) return `Username: ${USERNAME_HELP}.`;
  if (RESERVED_USERNAMES.has(u)) return "That username is reserved. Please pick another.";
  if (usernameIsImpersonation(u)) {
    return "That username looks like an official or brand account. Please pick another.";
  }
  return null;
}
