import { useCallback, useEffect, useState } from "react";
import { Check, Gift, Lock, Snowflake } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { refreshFeed } from "@/lib/notifications/feed";
import { seasonalThemesInSeason, type ThemePreset } from "@/lib/themes";
import {
  parseRewardClaim,
  REWARDS,
  rewardHint,
  themeForReward,
  type RewardKey,
  type RewardProgressInput,
} from "@/lib/rewards";

type Rpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};
const rpc = (fn: string) => (supabase as unknown as Rpc).rpc(fn);

/**
 * The signed-in creator's rewards. refresh() asks the database to record
 * anything newly earned; a toast names each new theme. While the feature
 * flag is off, enabled stays false and nothing shows.
 */
export function useThemeRewards() {
  const [enabled, setEnabled] = useState(false);
  const [unlocked, setUnlocked] = useState<RewardKey[]>([]);
  // Custom backgrounds (the "popular" reward) and the visitor count toward it.
  const [popular, setPopular] = useState(false);
  const [profileViews, setProfileViews] = useState(0);
  const [popularAt, setPopularAt] = useState<number | null>(null);

  const apply = useCallback((data: unknown) => {
    const r = parseRewardClaim(data);
    setEnabled(r.enabled);
    setUnlocked(r.unlocked);
    setPopular(r.popular);
    setProfileViews(r.profileViews);
    setPopularAt(r.popularAt);
    for (const k of r.newlyUnlocked)
      toast.success(`You unlocked the ${themeForReward(k).label} theme!`);
    if (r.newlyPopular) toast.success("You unlocked custom backgrounds!");
    // Each unlock also adds a bell notification; show it without a reload.
    if (r.newlyUnlocked.length > 0 || r.newlyPopular) void refreshFeed().catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await rpc("claim_theme_rewards");
      if (!error) apply(data);
    } catch {
      /* rewards are a bonus; never block the dashboard */
    }
  }, [apply]);

  const recordShare = useCallback(async () => {
    if (!enabled || unlocked.includes("first_share")) return;
    try {
      const { data, error } = await rpc("record_profile_share");
      if (!error && data === true) await refresh();
    } catch {
      /* ignore */
    }
  }, [enabled, unlocked, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { enabled, unlocked, popular, profileViews, popularAt, refresh, recordShare };
}

function ThemeTile({
  theme,
  active,
  locked,
  note,
  onPick,
}: {
  theme: ThemePreset;
  active: boolean;
  locked: boolean;
  note?: string | null;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      aria-label={locked ? `${theme.label} (locked)` : theme.label}
      className={`group relative overflow-hidden rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 ${
        active ? "border-primary ring-2 ring-primary" : "border-border"
      } ${locked ? "opacity-70" : ""}`}
    >
      <div className="h-20 rounded-lg" style={{ background: theme.preview }} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{theme.label}</span>
        {active ? (
          <Check className="h-4 w-4 shrink-0 text-primary" />
        ) : (
          locked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
      </div>
      {note && <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>}
    </button>
  );
}

/** Seasonal and earned themes for the dashboard's theme picker. */
export function ThemeRewardsPicker({
  enabled,
  unlocked,
  currentTheme,
  isPlus,
  plusAvailable,
  progress,
  onPick,
}: {
  enabled: boolean;
  unlocked: RewardKey[];
  currentTheme: string | null;
  isPlus: boolean;
  /** Plus can be bought right now (checkout open). */
  plusAvailable: boolean;
  progress: RewardProgressInput;
  onPick: (key: string) => void;
}) {
  if (!enabled) return null;
  // Plus-only seasonal themes show to non-Plus creators only while Plus can be bought.
  const seasonal = seasonalThemesInSeason().filter((t) => !t.premium || isPlus || plusAvailable);
  const earned = unlocked.length;

  return (
    <>
      {seasonal.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Snowflake className="h-4 w-4 text-primary" /> Seasonal themes
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {seasonal.map((t) => {
              const locked = !!t.premium && !isPlus;
              return (
                <ThemeTile
                  key={t.key}
                  theme={t}
                  active={currentTheme === t.key}
                  locked={locked}
                  note={t.premium ? "Plus, this season" : "Free this season"}
                  onPick={() => {
                    if (locked)
                      document.getElementById("plus")?.scrollIntoView({ behavior: "smooth" });
                    else onPick(t.key);
                  }}
                />
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Pick one while it's in season and it stays on your page after.
          </p>
        </div>
      )}

      <div className="mt-6">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Gift className="h-4 w-4 text-primary" /> Earned themes
          <span className="font-normal text-muted-foreground">
            {earned} of {REWARDS.length} unlocked
          </span>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {isPlus
            ? "All earned themes are included with Plus."
            : "Do these on Yooits to unlock a theme for each."}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {REWARDS.map((r) => {
            const t = themeForReward(r.key);
            const has = unlocked.includes(r.key);
            const locked = !has && !isPlus;
            const hint = rewardHint(r.key, progress);
            return (
              <ThemeTile
                key={r.key}
                theme={t}
                active={currentTheme === t.key}
                locked={locked}
                note={has ? `Earned: ${r.label}` : hint}
                onPick={() => {
                  if (locked) toast(`To unlock ${t.label}: ${hint}`);
                  else onPick(t.key);
                }}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
