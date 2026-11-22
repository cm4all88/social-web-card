/**
 * Skins: animated effects (falling snow, autumn leaves, floating hearts,
 * twinkling stars) layered over a colour theme. A skin is separate from the
 * theme, so any skin can go with any theme it's allowed with.
 *
 * Skins have no unlock rules of their own: each one shares the rules of one
 * theme (Plus, season and earned), so picking a skin is allowed exactly when
 * picking that theme would be. The database enforces the same thing
 * (public.skin_theme() and public.profiles_enforce_plus_features()).
 *
 * profiles.skin: null = the theme's own effect (Snowfall brings snow),
 * 'none' = no effect, or a skin key.
 */
import { effectiveThemeKey, findThemePreset, inSeasonWindow } from "@/lib/themes";

export type EffectKind = "snow" | "leaves" | "hearts" | "stars";
export type SkinKey = EffectKind;

/** Styling a skin adds around the page's content. */
export type SkinFrame = {
  /** A fixed layer of light over the background (frost, glow). */
  overlay?: string;
  /** Extra backdrop filter for link cards (frosted glass). */
  cardBackdrop?: string;
  cardShadow?: string;
  cardBorder?: string;
};

export type Skin = {
  key: SkinKey;
  label: string;
  description: string;
  effect: EffectKind;
  /** The theme whose unlock rules this skin shares. */
  theme: string;
  frame: SkinFrame;
};

export const SKINS: readonly Skin[] = [
  {
    key: "snow",
    label: "Falling snow",
    description: "Snowflakes of every size drifting in a light wind, with frosted cards.",
    effect: "snow",
    theme: "snowfall",
    frame: {
      overlay:
        "radial-gradient(130% 30% at 50% 104%, rgba(255,255,255,0.5), rgba(255,255,255,0.12) 55%, transparent 75%), radial-gradient(90% 26% at 50% -4%, rgba(224,242,254,0.35), transparent 70%)",
      cardBackdrop: "blur(8px) saturate(1.15)",
      cardShadow:
        "inset 0 1px 0 rgba(255,255,255,0.55), inset 0 0 18px rgba(224,242,254,0.2), 0 10px 28px -14px rgba(15,23,42,0.55)",
      cardBorder: "rgba(255,255,255,0.55)",
    },
  },
  {
    key: "leaves",
    label: "Autumn leaves",
    description: "Leaves tumbling and turning on the breeze.",
    effect: "leaves",
    theme: "harvest",
    frame: {
      overlay: "radial-gradient(120% 35% at 50% 108%, rgba(234,88,12,0.28), transparent 70%)",
      cardBackdrop: "blur(4px)",
    },
  },
  {
    key: "hearts",
    label: "Floating hearts",
    description: "Hearts rising gently and swaying as they go.",
    effect: "hearts",
    theme: "sweetheart",
    frame: {
      overlay: "radial-gradient(110% 35% at 50% 108%, rgba(244,63,94,0.2), transparent 70%)",
      cardBackdrop: "blur(4px)",
    },
  },
  {
    key: "stars",
    label: "Twinkling stars",
    description: "A sky of twinkling stars with the odd shooting star.",
    effect: "stars",
    theme: "starlight",
    frame: {
      overlay: "radial-gradient(120% 80% at 50% 0%, transparent 55%, rgba(2,6,23,0.28))",
      cardBackdrop: "blur(3px)",
    },
  },
];

/** Themes that bring an effect when no skin is picked. */
export const THEME_DEFAULT_SKIN: Readonly<Record<string, SkinKey>> = {
  snowfall: "snow",
  holiday_lights: "snow",
  harvest: "leaves",
  sweetheart: "hearts",
  starlight: "stars",
};

export function findSkin(key: string | null | undefined): Skin | undefined {
  return key ? SKINS.find((s) => s.key === key) : undefined;
}

export type SkinBlock = "plus" | "season" | "earn";

/**
 * Why a creator can't pick a skin right now, or null when they can. Uses the
 * rules of the skin's theme. unlocked = they've earned that theme's reward.
 */
export function skinBlock(
  key: SkinKey,
  opts: { plus?: boolean; unlocked?: boolean; at?: Date } = {},
): SkinBlock | null {
  const t = findThemePreset(findSkin(key)?.theme);
  if (!t) return null;
  if (t.premium && !opts.plus) return "plus";
  if (t.season && !inSeasonWindow(t.season, opts.at ?? new Date())) return "season";
  if (t.reward && !opts.plus && !opts.unlocked) return "earn";
  return null;
}

/**
 * The skin a public page shows. An explicitly picked skin shows while its
 * theme's Plus or earned rule still holds (seasonal skins stay after their
 * season, like seasonal themes); otherwise the shown theme's own effect.
 */
export function resolveSkin(opts: {
  enabled: boolean;
  skin: string | null | undefined;
  theme: string | null | undefined;
  plus: boolean;
  /** The creator has earned the reward of the theme they picked. */
  themeUnlocked: boolean;
  /** The creator has earned the reward of the picked skin's theme. */
  skinUnlocked: boolean;
}): Skin | null {
  if (!opts.enabled || opts.skin === "none") return null;
  const picked = findSkin(opts.skin);
  if (picked) {
    const t = findThemePreset(picked.theme);
    if (t?.premium && !opts.plus) return null;
    if (t?.reward && !opts.plus && !opts.skinUnlocked) return null;
    return picked;
  }
  const shown = effectiveThemeKey(opts.theme, { plus: opts.plus, unlocked: opts.themeUnlocked });
  return findSkin(THEME_DEFAULT_SKIN[shown]) ?? null;
}

export type SkinState = {
  /** Effects are switched on for the site. */
  enabled: boolean;
  /** The creator has earned the theme their picked effect belongs to. */
  unlocked: boolean;
  /** Custom backgrounds are switched on for the site. */
  backgroundsOn: boolean;
  /** This creator's custom background may show (Plus or the popular reward). */
  background: boolean;
};

/** Reads public_profile_skin_state()'s answer; anything unexpected reads as off. */
export function parseSkinState(data: unknown): SkinState {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return {
    enabled: d.on === true,
    unlocked: d.unlocked === true,
    backgroundsOn: d.backgrounds_on === true,
    background: d.background === true,
  };
}
