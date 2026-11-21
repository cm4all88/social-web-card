/**
 * Founding Members helpers that don't touch the network, so they can be
 * tested on their own. The database is the authority on every rule here
 * (seats, single use, expiry); these only shape what people see.
 */

/** What the database says a code is worth (beta_code_state / redeem_beta_invite). */
export type BetaCodeState =
  "ok" | "used" | "expired" | "revoked" | "full" | "closed" | "invalid" | "already";

export const BETA_NAME = "Founding Members";

/** Codes look like fc-abcd234xyz. Accepts what people paste: spaces, capitals, a whole link. */
export function normalizeBetaCode(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  const m = s.match(/[?&]invite=([^&#\s]+)/i);
  if (m) s = decodeURIComponent(m[1]);
  s = s.toLowerCase().replace(/\s+/g, "");
  return /^fc-[a-z0-9]{10}$/.test(s) ? s : null;
}

/** The link a creator opens to join. */
export function betaInviteLink(code: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/auth?invite=${encodeURIComponent(code)}`;
}

/** One plain sentence for each state, shown on the sign-up page or dashboard. */
export function betaStateMessage(state: BetaCodeState): string {
  switch (state) {
    case "ok":
      return "You're invited to be a Founding Member: 3 months of Plus, free. No card needed, and nothing renews or charges when it ends.";
    case "already":
      return "Your account is already a Founding Member.";
    case "used":
      return "This invite has already been used. You can still create a free page.";
    case "expired":
      return "This invite has expired. You can still create a free page.";
    case "revoked":
    case "invalid":
      return "This invite isn't valid. You can still create a free page.";
    case "full":
      return "All Founding Member spots are taken. You can still create a free page.";
    case "closed":
      return "Founding Member invites aren't open yet. You can still create a free page.";
  }
}

export function isBetaCodeState(v: unknown): v is BetaCodeState {
  return (
    typeof v === "string" &&
    ["ok", "used", "expired", "revoked", "full", "closed", "invalid", "already"].includes(v)
  );
}

/** "Plus until March 3, 2027", or that it has ended. */
export function betaPlanLine(
  endsAt: string,
  revokedAt: string | null,
  now: Date = new Date(),
): string {
  if (revokedAt) return "Your founding Plus months have ended. You're on the free plan.";
  const end = new Date(endsAt);
  const date = end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  if (end.getTime() <= now.getTime()) {
    return `Your founding Plus months ended on ${date}. You're on the free plan, and nothing was charged.`;
  }
  return `Plus is free until ${date}. No card is on file, and when it ends you simply go back to the free plan.`;
}
