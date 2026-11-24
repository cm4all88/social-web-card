/**
 * Invite codes and Promotions (migration 20261123020000_invites_promotions).
 * Pure helpers here are tested on their own; the database is the authority on
 * every rule (uses, expiry, caps, eligibility, who gets free Plus).
 */

export type CodeState =
  | "ok"
  | "invalid"
  | "used"
  | "expired"
  | "revoked"
  | "paused"
  | "not_started"
  | "ended"
  | "full"
  | "new_only"
  | "existing_only"
  | "already"
  | "paid_plus"
  | "closed";

export type CodeKind = "founding" | "promotion" | "invite" | "unknown";

export type CodeInfo = { kind: CodeKind; state: CodeState; plus_months?: number };

const STATES: CodeState[] = [
  "ok",
  "invalid",
  "used",
  "expired",
  "revoked",
  "paused",
  "not_started",
  "ended",
  "full",
  "new_only",
  "existing_only",
  "already",
  "paid_plus",
  "closed",
];

export function isCodeState(v: unknown): v is CodeState {
  return typeof v === "string" && (STATES as string[]).includes(v);
}

export function asCodeInfo(v: unknown): CodeInfo {
  const o = (v ?? {}) as Partial<CodeInfo>;
  return {
    kind: (["founding", "promotion", "invite"] as const).includes(o.kind as never)
      ? (o.kind as CodeKind)
      : "unknown",
    state: isCodeState(o.state) ? o.state : "invalid",
    plus_months: typeof o.plus_months === "number" ? o.plus_months : 0,
  };
}

/** Accepts what people paste: spaces, capitals, a whole yooits.me/auth?invite= link. */
export function normalizeCode(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  const m = s.match(/[?&]invite=([^&#\s]+)/i);
  if (m) {
    try {
      s = decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  }
  s = s.toLowerCase().replace(/\s+/g, "");
  return /^[a-z0-9][a-z0-9-]{3,39}$/.test(s) ? s : null;
}

/** The link someone opens to join with a code. */
export function codeLink(code: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/auth?invite=${encodeURIComponent(code)}`;
}

const months = (n: number) => (n === 1 ? "1 month" : `${n} months`);

/** One plain sentence for a non-founding code, shown on sign-up. */
export function codeStateMessage(info: CodeInfo): string {
  const plus = info.plus_months ?? 0;
  switch (info.state) {
    case "ok":
      return plus > 0
        ? `This code gives you ${months(plus)} of Yooits.me Plus, free. No card needed, and nothing renews or charges when it ends.`
        : "Your invite code is ready. It's applied when you create your account.";
    case "already":
      return "Your account has already used this code.";
    case "used":
      return "This code has been used up. You can still create a free page.";
    case "expired":
    case "ended":
      return "This code has expired. You can still create a free page.";
    case "paused":
    case "not_started":
      return "This code isn't active right now. You can still create a free page.";
    case "full":
      return "This promotion is fully claimed. You can still create a free page.";
    case "new_only":
      return "This code is for new accounts only.";
    case "existing_only":
      return "This code is for people who already have a Yooits.me account. Sign in to use it.";
    case "paid_plus":
      return "You already have Yooits.me Plus, so this code isn't needed.";
    case "closed":
    case "revoked":
    case "invalid":
      return "This code isn't valid. You can still create a free page.";
  }
}

// ---------------------------------------------------------------------------
// Owner console shapes
// ---------------------------------------------------------------------------
export type InviteChannel = "email" | "dm" | "in_person" | "social" | "other";

export const CHANNEL_LABELS: Record<InviteChannel, string> = {
  email: "Email",
  dm: "DM",
  in_person: "In person",
  social: "Social post",
  other: "Other",
};

export type InviteRow = {
  id: string;
  code: string;
  label: string | null;
  channel: InviteChannel | null;
  status: "open" | "used_up" | "expired" | "revoked";
  promotion_id: string | null;
  promotion_name: string | null;
  max_uses: number;
  use_count: number;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  last_used_at: string | null;
  last_used_by_username: string | null;
};

export type RedemptionRow = {
  redeemed_at: string;
  user_id: string;
  username: string | null;
  code: string;
  invite_id: string;
  promotion_id: string | null;
  promotion_name: string | null;
  via_signup: boolean;
  plus_until: string | null;
  plan: "free" | "plus";
};

export type PromotionStatus = "draft" | "active" | "paused" | "ended";
export type Eligibility = "anyone" | "new_accounts" | "existing_accounts";

export type Promotion = {
  id: string;
  name: string;
  description: string | null;
  status: PromotionStatus;
  state: "live" | "scheduled" | "ended" | "draft" | "paused";
  starts_at: string | null;
  ends_at: string | null;
  plus_months: number;
  eligibility: Eligibility;
  max_redemptions: number | null;
  campaign_id: string | null;
  campaign_name: string | null;
  created_at: string;
  codes: number;
  codes_open: number;
  redemptions: number;
  redemptions_7d: number;
  signups: number;
  plus_now: number;
  paying_now: number;
};

export type PromotionReport = {
  promotion: Promotion;
  daily: { day: string; redemptions: number; signups: number }[];
  codes: {
    id: string;
    code: string;
    label: string | null;
    status: InviteRow["status"];
    use_count: number;
    max_uses: number;
    expires_at: string | null;
  }[];
};

export const ELIGIBILITY_LABELS: Record<Eligibility, string> = {
  anyone: "Anyone",
  new_accounts: "New accounts only (used while signing up)",
  existing_accounts: "Existing accounts only (signed in)",
};

export const INVITE_STATUS_LABELS: Record<InviteRow["status"], string> = {
  open: "Open",
  used_up: "Used up",
  expired: "Expired",
  revoked: "Revoked",
};

/** "3 of 10 used", "Used", "Unused". */
export function usesLine(r: Pick<InviteRow, "use_count" | "max_uses">): string {
  if (r.max_uses === 1) return r.use_count >= 1 ? "Used" : "Unused";
  return `${r.use_count} of ${r.max_uses.toLocaleString("en-US")} used`;
}

/** What a promotion gives, in a few words. */
export function promotionOffer(p: Pick<Promotion, "plus_months">): string {
  return p.plus_months > 0 ? `${months(p.plus_months)} of Plus free` : "Tracking only, no reward";
}
