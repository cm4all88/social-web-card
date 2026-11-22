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
  /** Short name, shown once it's earned ("Earned: ..."). */
  label: string;
};

export const REWARDS: readonly Reward[] = [
  { key: "profile_complete", label: "Completed your profile" },
  { key: "five_links", label: "5 links on your page" },
  { key: "first_share", label: "Shared your page" },
  { key: "first_wishlist", label: "Made a wishlist" },
  { key: "one_week", label: "A week on Yooits" },
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
  /** When the profile was made (profiles.created_at). */
  createdAt?: string | null;
};

const filled = (v?: string | null) => !!v && v.trim().length > 0;

/**
 * One plain line saying exactly what to do to earn a reward, with a count
 * where there is one. Mirrors the checks in public.claim_theme_rewards().
 */
export function rewardHint(
  key: RewardKey,
  input: RewardProgressInput,
  now: Date = new Date(),
): string {
  const visibleLinks = input.links.filter((l) => l.enabled && filled(l.url)).length;
  switch (key) {
    case "profile_complete": {
      const done = [input.displayName, input.bio, input.avatarUrl].filter(filled).length;
      return `Add a display name, a bio and a photo to your profile (${done} of 3 done).`;
    }
    case "five_links":
      return `Add 5 links to your page and keep them Visible (${Math.min(visibleLinks, 5)} of 5 so far).`;
    case "first_share":
      return "Tap Copy link at the top of your dashboard.";
    case "first_wishlist":
      return "Make a wishlist and add one item to it.";
    case "one_week": {
      const made = input.createdAt ? Date.parse(input.createdAt) : NaN;
      const days = Number.isFinite(made)
        ? Math.min(7, Math.max(0, Math.floor((now.getTime() - made) / 86_400_000)))
        : null;
      const count = days === null ? "" : ` (day ${days} of 7)`;
      return visibleLinks > 0
        ? `Keep at least one Visible link on your page until it's a week old${count}.`
        : `Add a Visible link and keep your page for a week${count}.`;
    }
  }
}

/**
 * Parses claim_theme_rewards()'s answer; anything unexpected reads as nothing
 * unlocked. "popular" (custom backgrounds) unlocks a feature, not a theme, so
 * it's reported on its own with the view count toward it.
 */
export function parseRewardClaim(data: unknown): {
  unlocked: RewardKey[];
  newlyUnlocked: RewardKey[];
  enabled: boolean;
  popular: boolean;
  newlyPopular: boolean;
  profileViews: number;
  popularAt: number | null;
} {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isRewardKey) : []);
  const has = (v: unknown) => Array.isArray(v) && v.includes("popular");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    unlocked: list(d.unlocked),
    newlyUnlocked: list(d.new),
    enabled: d.enabled === true,
    popular: has(d.unlocked),
    newlyPopular: has(d.new),
    profileViews: num(d.profile_views) ?? 0,
    popularAt: num(d.popular_at),
  };
}
