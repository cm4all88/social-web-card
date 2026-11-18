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

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** Returns an error message, or null when the username is acceptable. */
export function usernameError(value: string): string | null {
  const u = normalizeUsername(value);
  if (!USERNAME_RE.test(u)) return `Username: ${USERNAME_HELP}.`;
  if (RESERVED_USERNAMES.has(u)) return "That username is reserved. Please pick another.";
  return null;
}
