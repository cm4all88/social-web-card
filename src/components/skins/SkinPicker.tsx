import { useEffect, useState } from "react";
import { Ban, Check, Heart, Leaf, Lock, Snowflake, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadPublicSkinState } from "@/lib/billing/public";
import { findThemePreset, type ThemeTokens } from "@/lib/themes";
import {
  findSkin,
  parseSkinState,
  resolveSkin,
  SKINS,
  skinBlock,
  THEME_DEFAULT_SKIN,
  type Skin,
  type SkinKey,
} from "@/lib/skins";
import { REWARDS, themeForReward, type RewardKey } from "@/lib/rewards";
import { SkinLayer, usePrefersReducedMotion } from "./SkinLayer";

const ICONS: Record<SkinKey, typeof Snowflake> = {
  snow: Snowflake,
  leaves: Leaf,
  hearts: Heart,
  stars: Sparkles,
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (md: string) => {
  const [m, d] = md.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

/** Whether skins are switched on for this site (and the creator's earned state). */
export function useSkinsEnabled(userId: string | null | undefined) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    loadPublicSkinState(userId).then((d) => live && setOn(parseSkinState(d).enabled));
    return () => {
      live = false;
    };
  }, [userId]);
  return on;
}

type Choice = "theme" | "none" | SkinKey;

/**
 * The Effects part of the appearance editor: a live preview on the creator's
 * own theme, then "theme's own", "no effect" and each skin. Tapping one
 * previews it; if the creator may use it, it's saved straight away, like a
 * theme. Locked ones say why and stay preview-only.
 */
export function SkinPicker({
  userId,
  username,
  skin,
  themeKey,
  tokens,
  isPlus,
  unlocked,
  onSaved,
}: {
  userId: string;
  username: string;
  skin: string | null | undefined;
  themeKey: string | null | undefined;
  /** The page's theme as it shows now, for the preview. */
  tokens: ThemeTokens;
  isPlus: boolean;
  /** Rewards the creator has earned. */
  unlocked: RewardKey[];
  onSaved: (skin: string | null) => void;
}) {
  const enabled = useSkinsEnabled(userId);
  const reduced = usePrefersReducedMotion();
  const saved: Choice = skin === "none" ? "none" : (findSkin(skin)?.key ?? "theme");
  const [preview, setPreview] = useState<Choice>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setPreview(saved), [saved]);

  if (!enabled) return null;

  const themeDefault = findSkin(THEME_DEFAULT_SKIN[themeKey ?? ""]);
  const earned = (k: SkinKey) => {
    const reward = findThemePreset(findSkin(k)?.theme)?.reward as RewardKey | undefined;
    return !!reward && unlocked.includes(reward);
  };
  const blockOf = (k: SkinKey) => skinBlock(k, { plus: isPlus, unlocked: earned(k) });
  const why = (k: SkinKey): string | null => {
    const b = blockOf(k);
    const t = findThemePreset(findSkin(k)?.theme);
    if (b === "plus") return "Part of Plus.";
    if (b === "season" && t?.season)
      return `In season from ${day(t.season.from)} to ${day(t.season.to)}.`;
    if (b === "earn" && t?.reward) {
      const r = REWARDS.find((x) => x.key === t.reward);
      return `Unlocks with the ${themeForReward(t.reward as RewardKey).label} theme${r ? ` (${r.label.toLowerCase()})` : ""}.`;
    }
    return null;
  };
  const noteFor = (k: SkinKey) => {
    const t = findThemePreset(findSkin(k)?.theme);
    if (blockOf(k))
      return t?.season ? `From ${day(t.season.from)}` : t?.premium ? "Plus" : "Earn it";
    if (t?.season) return "Free this season";
    if (t?.reward) return isPlus && !earned(k) ? "With Plus" : "Earned";
    return "Free";
  };

  const shown: Skin | null =
    preview === "none"
      ? null
      : preview === "theme"
        ? (themeDefault ?? null)
        : (findSkin(preview) ?? null);
  // What the public page will show for the saved choice (same rules as the page).
  const live = resolveSkin({
    enabled: true,
    skin,
    theme: themeKey,
    plus: isPlus,
    themeUnlocked: true,
    skinUnlocked: !!findSkin(skin) && earned(findSkin(skin)!.key),
  });
  const previewWhy = preview !== "theme" && preview !== "none" ? why(preview) : null;

  const save = async (c: Choice) => {
    setPreview(c);
    if (c !== "theme" && c !== "none") {
      const w = why(c);
      if (w) {
        toast(`${findSkin(c)!.label}: ${w} You're seeing a preview.`);
        return;
      }
    }
    if (c === saved) return;
    const value = c === "theme" ? null : c;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ skin: value } as never)
      .eq("user_id", userId);
    setSaving(false);
    if (error) {
      toast.error(
        /part of Plus/i.test(error.message)
          ? "That effect is part of Plus."
          : /out of season/i.test(error.message)
            ? "That effect is out of season."
            : /Earn this effect/i.test(error.message)
              ? "Earn that effect first."
              : error.message,
      );
      setPreview(saved);
      return;
    }
    onSaved(value);
    toast.success(
      c === "none"
        ? "Effects turned off"
        : `Effect set to ${c === "theme" ? (themeDefault?.label ?? "your theme's own") : findSkin(c)!.label}`,
    );
  };

  const options: {
    key: Choice;
    label: string;
    note: string;
    Icon: typeof Snowflake;
    locked: boolean;
  }[] = [
    {
      key: "theme",
      label: "Theme's own",
      note: themeDefault ? themeDefault.label : "None for this theme",
      Icon: Wand2,
      locked: false,
    },
    { key: "none", label: "No effect", note: "Just the theme", Icon: Ban, locked: false },
    ...SKINS.map((s) => ({
      key: s.key as Choice,
      label: s.label,
      note: noteFor(s.key),
      Icon: ICONS[s.key],
      locked: !!blockOf(s.key),
    })),
  ];

  return (
    <div className="mt-6" id="effects">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-primary" /> Effects
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Moving effects over your theme. Tap one to preview it; it saves if it's yours to use.
      </p>

      <div
        className="relative h-56 overflow-hidden rounded-xl border border-border"
        style={{ background: tokens.background, color: tokens.foreground }}
        data-testid="skin-preview"
      >
        <SkinLayer skin={shown} mode="contained" />
        <div className="relative z-10 flex h-full flex-col items-center justify-center gap-2 px-6">
          {["Your links", "Look like this"].map((label) => (
            <div
              key={label}
              className="w-full max-w-xs border px-4 py-3 text-center text-sm font-semibold"
              style={{
                background: tokens.card,
                color: tokens.cardForeground,
                borderColor: shown?.frame.cardBorder ?? tokens.border,
                borderRadius: 16,
                boxShadow: shown?.frame.cardShadow,
                backdropFilter: shown?.frame.cardBackdrop,
                WebkitBackdropFilter: shown?.frame.cardBackdrop,
              }}
            >
              {label}
            </div>
          ))}
        </div>
        {(previewWhy || reduced) && (
          <div className="absolute inset-x-0 bottom-0 z-30 bg-black/55 px-3 py-1.5 text-center text-xs text-white">
            {previewWhy
              ? `Preview only. ${previewWhy}`
              : "Your device asks for less motion, so effects show still."}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map(({ key, label, note, Icon, locked }) => {
          const active = saved === key;
          const previewing = preview === key && !active;
          return (
            <button
              key={key}
              type="button"
              disabled={saving}
              onClick={() => save(key)}
              aria-pressed={active}
              aria-label={locked ? `${label} (locked, preview only)` : label}
              className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-all hover:-translate-y-0.5 ${
                active
                  ? "border-primary ring-2 ring-primary"
                  : previewing
                    ? "border-primary/60"
                    : "border-border"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{label}</span>
                <span className="block truncate text-xs text-muted-foreground">{note}</span>
              </span>
              {active ? (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                locked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
            </button>
          );
        })}
      </div>
      {shown && (
        <a
          href={`/${username}?effect=${shown.key}`}
          target="_blank"
          rel="noopener"
          className="mt-2 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          See {shown.label.toLowerCase()} on your page
        </a>
      )}
      {!!findSkin(skin) && !live && (
        <p className="mt-2 text-xs text-muted-foreground">
          Your page shows no effect right now: the picked effect needs Plus or its earned theme.
        </p>
      )}
    </div>
  );
}
