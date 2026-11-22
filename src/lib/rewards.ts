/**
 * Rewards: small things creators do on Yooits that unlock an earned theme.
 * The database decides what is earned (public.claim_theme_rewards()); this
 * file only describes each reward and shows progress in the dashboard.
 * Keys mirror public.user_rewards and public.theme_reward_key().
 */
import { REWARD_THEME_PRESETS, type ThemePreset } from "@/lib/themes";

export type RewardKey =
  "profile_complete" | "five_links" | "first_share" | "first_wishlist" | "one_week";

export type Reward = {
  key: RewardKey;
  label: string;
  /** What to do, shown before it's earned. */
  howTo: string;
};

export const REWARDS: readonly Reward[] = [
  {
    key: "profile_complete",
    label: "Complete your profile",
    howTo: "Add a display name, a bio and a photo.",
  },
  { key: "five_links", label: "Add 5 links", howTo: "Have 5 links switched on with an address." },
  {
    key: "first_share",
    label: "Share your page",
    howTo: "Copy your Yooits link from the dashboard.",
  },
  {
    key: "first_wishlist",
    label: "Make a wishlist",
    howTo: "Create a wishlist with at least one item.",
  },
  { key: "one_week", label: "One week on Yooits", howTo: "Keep a link on your page for 7 days." },
];

export const REWARD_KEYS: readonly RewardKey[] = REWARDS.map((r) => r.key);

export function isRewardKey(v: unknown): v is RewardKey {
  return typeof v === "string" && (REWARD_KEYS as readonly string[]).includes(v);
}

export function themeForReward(key: RewardKey): ThemePreset {
  return REWARD_THEME_PRESETS.find((t) => t.reward === key)!;
}

export type RewardProgressInput = {
  displayName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  links: { url: string; enabled: boolean }[];
};

/**
 * Progress for the dashboard, from what it already has loaded. Returns a
 * short "2 of 5" style hint, or null when there's nothing to count.
 */
export function rewardProgress(key: RewardKey, input: RewardProgressInput): string | null {
  if (key === "profile_complete") {
    const done = [input.displayName, input.bio, input.avatarUrl].filter(
      (v) => !!v && v.trim().length > 0,
    ).length;
    return `${done} of 3`;
  }
  if (key === "five_links") {
    const n = input.links.filter((l) => l.enabled && l.url.trim().length > 0).length;
    return `${Math.min(n, 5)} of 5`;
  }
  return null;
}

/** Parses claim_theme_rewards()'s answer; anything unexpected reads as nothing unlocked. */
export function parseRewardClaim(data: unknown): {
  unlocked: RewardKey[];
  newlyUnlocked: RewardKey[];
  enabled: boolean;
} {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isRewardKey) : []);
  return { unlocked: list(d.unlocked), newlyUnlocked: list(d.new), enabled: d.enabled === true };
}
