// Theme system: presets + custom theme support
// Each theme defines CSS variables applied to the public profile page.

export type ThemeTokens = {
  background: string; // CSS color or gradient
  foreground: string;
  card: string; // background of link cards
  cardForeground: string;
  border: string;
  accent: string; // glow / button highlight
  buttonStyle: "rounded" | "pill" | "square" | "outline" | "soft";
  font: "sans" | "serif" | "mono" | "display";
};

export type ThemePreset = {
  key: string;
  label: string;
  preview: string; // gradient string for the preview chip
  tokens: ThemeTokens;
  /** Plus-only. Mirrors public.theme_is_premium() in the database. */
  premium?: boolean;
  /** Seasonal: can be picked only between these month-day dates (UTC, inclusive, may wrap the new year). */
  season?: { from: string; to: string };
  /** Earned: unlocked by this reward (or included with Plus). Mirrors public.theme_reward_key(). */
  reward?: string;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    key: "midnight",
    label: "Midnight",
    preview: "linear-gradient(135deg, #6d28d9, #db2777, #f59e0b)",
    tokens: {
      background: "linear-gradient(160deg, oklch(0.16 0.04 280), oklch(0.22 0.06 290))",
      foreground: "oklch(0.98 0.01 280)",
      card: "oklch(0.22 0.05 285 / 0.85)",
      cardForeground: "oklch(0.98 0.01 280)",
      border: "oklch(0.55 0.08 285 / 0.4)",
      accent: "oklch(0.7 0.22 320)",
      buttonStyle: "rounded",
      font: "sans",
    },
  },
  {
    key: "sunset",
    label: "Sunset",
    preview: "linear-gradient(135deg, #f97316, #ec4899, #8b5cf6)",
    tokens: {
      background: "linear-gradient(160deg, #f97316, #ec4899 50%, #8b5cf6)",
      foreground: "#fff8f0",
      card: "rgba(255,255,255,0.18)",
      cardForeground: "#fff8f0",
      border: "rgba(255,255,255,0.3)",
      accent: "#fff",
      buttonStyle: "pill",
      font: "sans",
    },
  },
  {
    key: "ocean",
    label: "Ocean",
    preview: "linear-gradient(135deg, #0ea5e9, #06b6d4, #14b8a6)",
    tokens: {
      background: "linear-gradient(160deg, #0c4a6e, #0ea5e9 60%, #14b8a6)",
      foreground: "#ecfeff",
      card: "rgba(255,255,255,0.12)",
      cardForeground: "#ecfeff",
      border: "rgba(255,255,255,0.25)",
      accent: "#7dd3fc",
      buttonStyle: "rounded",
      font: "sans",
    },
  },
  {
    key: "forest",
    label: "Forest",
    preview: "linear-gradient(135deg, #14532d, #16a34a, #84cc16)",
    tokens: {
      background: "linear-gradient(160deg, #052e16, #14532d 60%, #166534)",
      foreground: "#ecfdf5",
      card: "rgba(255,255,255,0.1)",
      cardForeground: "#ecfdf5",
      border: "rgba(255,255,255,0.22)",
      accent: "#86efac",
      buttonStyle: "rounded",
      font: "serif",
    },
  },
  {
    key: "neon",
    label: "Neon",
    preview: "linear-gradient(135deg, #000, #a855f7, #22d3ee)",
    tokens: {
      background: "#0a0a0a",
      foreground: "#e9d5ff",
      card: "rgba(168,85,247,0.12)",
      cardForeground: "#fff",
      border: "rgba(34,211,238,0.5)",
      accent: "#22d3ee",
      buttonStyle: "outline",
      font: "mono",
    },
  },
  {
    key: "mono",
    label: "Mono",
    preview: "linear-gradient(135deg, #fff, #e5e5e5, #000)",
    tokens: {
      background: "#fafafa",
      foreground: "#0a0a0a",
      card: "#ffffff",
      cardForeground: "#0a0a0a",
      border: "#e5e5e5",
      accent: "#000",
      buttonStyle: "square",
      font: "sans",
    },
  },
  {
    key: "noir",
    label: "Noir",
    preview: "linear-gradient(135deg, #000, #1f1f1f, #404040)",
    tokens: {
      background: "#000",
      foreground: "#fafafa",
      card: "#171717",
      cardForeground: "#fafafa",
      border: "#262626",
      accent: "#fafafa",
      buttonStyle: "square",
      font: "mono",
    },
  },
  {
    key: "candy",
    label: "Candy",
    preview: "linear-gradient(135deg, #fbcfe8, #fce7f3, #c7d2fe)",
    tokens: {
      background: "linear-gradient(160deg, #fbcfe8, #fce7f3 50%, #c7d2fe)",
      foreground: "#3b0764",
      card: "rgba(255,255,255,0.7)",
      cardForeground: "#3b0764",
      border: "rgba(124,58,237,0.2)",
      accent: "#a855f7",
      buttonStyle: "pill",
      font: "display",
    },
  },
  {
    key: "peach",
    label: "Peach",
    preview: "linear-gradient(135deg, #fed7aa, #fbbf24, #f87171)",
    tokens: {
      background: "linear-gradient(160deg, #fff7ed, #fed7aa 60%, #fdba74)",
      foreground: "#7c2d12",
      card: "rgba(255,255,255,0.65)",
      cardForeground: "#7c2d12",
      border: "rgba(124,45,18,0.15)",
      accent: "#ea580c",
      buttonStyle: "rounded",
      font: "serif",
    },
  },
  {
    key: "matrix",
    label: "Matrix",
    preview: "linear-gradient(135deg, #000, #052e16, #22c55e)",
    tokens: {
      background: "#000",
      foreground: "#22c55e",
      card: "rgba(34,197,94,0.08)",
      cardForeground: "#86efac",
      border: "rgba(34,197,94,0.4)",
      accent: "#22c55e",
      buttonStyle: "outline",
      font: "mono",
    },
  },
  {
    key: "royal",
    label: "Royal",
    preview: "linear-gradient(135deg, #1e1b4b, #4c1d95, #facc15)",
    tokens: {
      background: "linear-gradient(160deg, #1e1b4b, #4c1d95)",
      foreground: "#fef3c7",
      card: "rgba(250,204,21,0.1)",
      cardForeground: "#fef3c7",
      border: "rgba(250,204,21,0.35)",
      accent: "#facc15",
      buttonStyle: "rounded",
      font: "serif",
    },
  },
  {
    key: "vapor",
    label: "Vapor",
    preview: "linear-gradient(135deg, #f0abfc, #818cf8, #22d3ee)",
    tokens: {
      background: "linear-gradient(160deg, #f0abfc, #818cf8 50%, #22d3ee)",
      foreground: "#1e1b4b",
      card: "rgba(255,255,255,0.25)",
      cardForeground: "#1e1b4b",
      border: "rgba(255,255,255,0.5)",
      accent: "#fff",
      buttonStyle: "pill",
      font: "display",
    },
  },
];

/** Plus-only themes. The free themes and custom colors above stay free. */
export const PREMIUM_THEME_PRESETS: ThemePreset[] = [
  {
    key: "aurora",
    label: "Aurora",
    premium: true,
    preview: "linear-gradient(135deg, #022c22, #10b981, #6366f1, #ec4899)",
    tokens: {
      background:
        "radial-gradient(120% 80% at 10% 0%, #10b98155, transparent 60%), radial-gradient(120% 80% at 90% 10%, #6366f155, transparent 60%), radial-gradient(120% 90% at 50% 100%, #ec489944, transparent 60%), #020617",
      foreground: "#f0fdfa",
      card: "rgba(15,23,42,0.6)",
      cardForeground: "#f0fdfa",
      border: "rgba(94,234,212,0.35)",
      accent: "#5eead4",
      buttonStyle: "pill",
      font: "display",
    },
  },
  {
    key: "obsidian",
    label: "Obsidian",
    premium: true,
    preview: "linear-gradient(135deg, #09090b, #27272a, #a1a1aa)",
    tokens: {
      background: "linear-gradient(180deg, #18181b, #09090b 70%)",
      foreground: "#fafafa",
      card: "linear-gradient(180deg, #27272a, #18181b)",
      cardForeground: "#fafafa",
      border: "rgba(212,212,216,0.18)",
      accent: "#e4e4e7",
      buttonStyle: "soft",
      font: "sans",
    },
  },
  {
    key: "sakura",
    label: "Sakura",
    premium: true,
    preview: "linear-gradient(135deg, #fff1f2, #fda4af, #f9a8d4)",
    tokens: {
      background: "radial-gradient(100% 70% at 50% 0%, #ffe4e6, #fff1f2 60%, #fdf2f8)",
      foreground: "#4c0519",
      card: "rgba(255,255,255,0.8)",
      cardForeground: "#4c0519",
      border: "rgba(244,63,94,0.2)",
      accent: "#e11d48",
      buttonStyle: "pill",
      font: "serif",
    },
  },
  {
    key: "glacier",
    label: "Glacier",
    premium: true,
    preview: "linear-gradient(135deg, #f0f9ff, #bae6fd, #7dd3fc)",
    tokens: {
      background: "linear-gradient(170deg, #f8fafc, #e0f2fe 55%, #bae6fd)",
      foreground: "#0c4a6e",
      card: "rgba(255,255,255,0.6)",
      cardForeground: "#0c4a6e",
      border: "rgba(14,165,233,0.25)",
      accent: "#0284c7",
      buttonStyle: "soft",
      font: "sans",
    },
  },
  {
    key: "ember",
    label: "Ember",
    premium: true,
    preview: "linear-gradient(135deg, #1c0a00, #9a3412, #f59e0b)",
    tokens: {
      background: "radial-gradient(120% 70% at 50% 110%, #c2410c99, transparent 60%), linear-gradient(180deg, #1c0a00, #0c0400)",
      foreground: "#fff7ed",
      card: "rgba(67,20,7,0.65)",
      cardForeground: "#fff7ed",
      border: "rgba(251,146,60,0.4)",
      accent: "#fb923c",
      buttonStyle: "rounded",
      font: "display",
    },
  },
  {
    key: "gilded",
    label: "Gilded",
    premium: true,
    preview: "linear-gradient(135deg, #0a0a0a, #a16207, #fde68a)",
    tokens: {
      background: "linear-gradient(160deg, #0a0a0a, #1c1917 60%, #292524)",
      foreground: "#fef3c7",
      card: "rgba(28,25,23,0.9)",
      cardForeground: "#fde68a",
      border: "rgba(253,230,138,0.45)",
      accent: "#facc15",
      buttonStyle: "outline",
      font: "serif",
    },
  },
];

/**
 * Seasonal themes. Each can be picked only while in season (dates are
 * month-day, UTC, inclusive). A creator who picked one keeps it after the
 * season ends. Holiday Lights is also Plus-only. Mirrors
 * public.theme_season() in the database.
 */
export const SEASONAL_THEME_PRESETS: ThemePreset[] = [
  {
    key: "snowfall",
    label: "Snowfall",
    season: { from: "11-20", to: "02-28" },
    preview: "linear-gradient(135deg, #e0f2fe, #93c5fd, #1e3a8a)",
    tokens: {
      background:
        "radial-gradient(2px 2px at 20% 15%, #ffffffcc, transparent 60%), radial-gradient(2px 2px at 70% 30%, #ffffffaa, transparent 60%), radial-gradient(3px 3px at 40% 70%, #ffffff99, transparent 60%), radial-gradient(2px 2px at 85% 80%, #ffffffbb, transparent 60%), linear-gradient(180deg, #1e3a8a, #3b82f6 55%, #bfdbfe)",
      foreground: "#f8fafc",
      card: "rgba(255,255,255,0.16)",
      cardForeground: "#f8fafc",
      border: "rgba(255,255,255,0.4)",
      accent: "#e0f2fe",
      buttonStyle: "pill",
      font: "sans",
    },
  },
  {
    key: "holiday_lights",
    label: "Holiday Lights",
    premium: true,
    season: { from: "11-20", to: "01-06" },
    preview: "linear-gradient(135deg, #052e16, #b91c1c, #facc15)",
    tokens: {
      background:
        "radial-gradient(6px 6px at 10% 8%, #ef4444, transparent 70%), radial-gradient(6px 6px at 30% 5%, #facc15, transparent 70%), radial-gradient(6px 6px at 50% 9%, #22c55e, transparent 70%), radial-gradient(6px 6px at 70% 5%, #3b82f6, transparent 70%), radial-gradient(6px 6px at 90% 8%, #f97316, transparent 70%), linear-gradient(180deg, #052e16, #0b3d1f 60%, #14532d)",
      foreground: "#fef9c3",
      card: "rgba(127,29,29,0.55)",
      cardForeground: "#fef9c3",
      border: "rgba(250,204,21,0.45)",
      accent: "#facc15",
      buttonStyle: "rounded",
      font: "serif",
    },
  },
  {
    key: "sweetheart",
    label: "Sweetheart",
    season: { from: "02-01", to: "02-15" },
    preview: "linear-gradient(135deg, #fff1f2, #fb7185, #be123c)",
    tokens: {
      background: "linear-gradient(160deg, #fff1f2, #fecdd3 55%, #fda4af)",
      foreground: "#881337",
      card: "rgba(255,255,255,0.7)",
      cardForeground: "#881337",
      border: "rgba(190,18,60,0.25)",
      accent: "#e11d48",
      buttonStyle: "pill",
      font: "display",
    },
  },
  {
    key: "spring_bloom",
    label: "Spring Bloom",
    season: { from: "03-15", to: "05-31" },
    preview: "linear-gradient(135deg, #ecfccb, #86efac, #f9a8d4)",
    tokens: {
      background: "linear-gradient(170deg, #f7fee7, #dcfce7 50%, #fce7f3)",
      foreground: "#14532d",
      card: "rgba(255,255,255,0.75)",
      cardForeground: "#14532d",
      border: "rgba(22,163,74,0.25)",
      accent: "#db2777",
      buttonStyle: "soft",
      font: "serif",
    },
  },
  {
    key: "summer_sun",
    label: "Summer Sun",
    season: { from: "06-01", to: "08-31" },
    preview: "linear-gradient(135deg, #fde047, #fb923c, #06b6d4)",
    tokens: {
      background: "linear-gradient(180deg, #fde68a, #fdba74 45%, #67e8f9)",
      foreground: "#422006",
      card: "rgba(255,255,255,0.55)",
      cardForeground: "#422006",
      border: "rgba(66,32,6,0.18)",
      accent: "#ea580c",
      buttonStyle: "pill",
      font: "sans",
    },
  },
  {
    key: "harvest",
    label: "Harvest",
    season: { from: "09-15", to: "11-19" },
    preview: "linear-gradient(135deg, #7c2d12, #ea580c, #facc15)",
    tokens: {
      background: "linear-gradient(170deg, #431407, #7c2d12 55%, #9a3412)",
      foreground: "#ffedd5",
      card: "rgba(255,237,213,0.1)",
      cardForeground: "#ffedd5",
      border: "rgba(251,146,60,0.4)",
      accent: "#fb923c",
      buttonStyle: "rounded",
      font: "serif",
    },
  },
];

/**
 * Earned themes. Each one unlocks with a reward (see src/lib/rewards.ts) and
 * is included with Plus. Mirrors public.theme_reward_key() in the database.
 */
export const REWARD_THEME_PRESETS: ThemePreset[] = [
  {
    key: "starlight",
    label: "Starlight",
    reward: "profile_complete",
    preview: "linear-gradient(135deg, #0f172a, #4338ca, #fde68a)",
    tokens: {
      background:
        "radial-gradient(1.5px 1.5px at 15% 20%, #fff, transparent 60%), radial-gradient(1.5px 1.5px at 60% 12%, #fff, transparent 60%), radial-gradient(2px 2px at 80% 45%, #fde68a, transparent 60%), radial-gradient(1.5px 1.5px at 30% 65%, #fff, transparent 60%), linear-gradient(180deg, #0f172a, #1e1b4b 60%, #312e81)",
      foreground: "#eef2ff",
      card: "rgba(49,46,129,0.55)",
      cardForeground: "#eef2ff",
      border: "rgba(253,230,138,0.35)",
      accent: "#fde68a",
      buttonStyle: "pill",
      font: "display",
    },
  },
  {
    key: "prism",
    label: "Prism",
    reward: "five_links",
    preview: "linear-gradient(135deg, #f43f5e, #f59e0b, #22c55e, #3b82f6, #a855f7)",
    tokens: {
      background: "linear-gradient(135deg, #fecdd3, #fde68a 25%, #bbf7d0 50%, #bfdbfe 75%, #e9d5ff)",
      foreground: "#1e1b4b",
      card: "rgba(255,255,255,0.7)",
      cardForeground: "#1e1b4b",
      border: "rgba(30,27,75,0.15)",
      accent: "#7c3aed",
      buttonStyle: "rounded",
      font: "sans",
    },
  },
  {
    key: "confetti",
    label: "Confetti",
    reward: "first_share",
    preview: "linear-gradient(135deg, #fef3c7, #f472b6, #38bdf8)",
    tokens: {
      background:
        "radial-gradient(4px 4px at 12% 18%, #f472b6, transparent 70%), radial-gradient(4px 4px at 78% 12%, #38bdf8, transparent 70%), radial-gradient(4px 4px at 40% 40%, #facc15, transparent 70%), radial-gradient(4px 4px at 88% 60%, #34d399, transparent 70%), radial-gradient(4px 4px at 20% 82%, #a78bfa, transparent 70%), #fffbeb",
      foreground: "#3f1d38",
      card: "rgba(255,255,255,0.85)",
      cardForeground: "#3f1d38",
      border: "rgba(244,114,182,0.35)",
      accent: "#db2777",
      buttonStyle: "pill",
      font: "display",
    },
  },
  {
    key: "lagoon",
    label: "Lagoon",
    reward: "first_wishlist",
    preview: "linear-gradient(135deg, #042f2e, #0d9488, #99f6e4)",
    tokens: {
      background: "linear-gradient(180deg, #042f2e, #115e59 55%, #0f766e)",
      foreground: "#f0fdfa",
      card: "rgba(153,246,228,0.12)",
      cardForeground: "#f0fdfa",
      border: "rgba(153,246,228,0.35)",
      accent: "#5eead4",
      buttonStyle: "soft",
      font: "sans",
    },
  },
  {
    key: "golden_hour",
    label: "Golden Hour",
    reward: "one_week",
    preview: "linear-gradient(135deg, #451a03, #d97706, #fef3c7)",
    tokens: {
      background: "linear-gradient(180deg, #78350f, #b45309 45%, #fbbf24)",
      foreground: "#fffbeb",
      card: "rgba(69,26,3,0.45)",
      cardForeground: "#fffbeb",
      border: "rgba(254,243,199,0.4)",
      accent: "#fde68a",
      buttonStyle: "rounded",
      font: "serif",
    },
  },
];

const monthDay = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** Whether a seasonal window (month-day, inclusive, may wrap the new year) contains this date. */
export function inSeasonWindow(season: { from: string; to: string }, at: Date = new Date()): boolean {
  const md = monthDay(at);
  return season.from <= season.to ? md >= season.from && md <= season.to : md >= season.from || md <= season.to;
}

export function seasonalThemesInSeason(at: Date = new Date()): ThemePreset[] {
  return SEASONAL_THEME_PRESETS.filter((t) => t.season && inSeasonWindow(t.season, at));
}

export function findThemePreset(key: string | null | undefined): ThemePreset | undefined {
  if (!key) return undefined;
  return (
    THEME_PRESETS.find((p) => p.key === key) ??
    PREMIUM_THEME_PRESETS.find((p) => p.key === key) ??
    SEASONAL_THEME_PRESETS.find((p) => p.key === key) ??
    REWARD_THEME_PRESETS.find((p) => p.key === key)
  );
}

export function isRewardTheme(key: string | null | undefined): boolean {
  return !!key && REWARD_THEME_PRESETS.some((p) => p.key === key);
}

export const PREMIUM_THEME_KEYS: readonly string[] = [
  ...PREMIUM_THEME_PRESETS.map((p) => p.key),
  ...SEASONAL_THEME_PRESETS.filter((p) => p.premium).map((p) => p.key),
];

export function isPremiumTheme(key: string | null | undefined): boolean {
  return !!key && PREMIUM_THEME_KEYS.includes(key);
}

export function getTheme(
  key: string | null | undefined,
  custom: Partial<ThemeTokens> | null | undefined,
  opts: { plus?: boolean; unlocked?: boolean } = {},
): ThemeTokens {
  if (key === "custom" && custom) {
    const base = THEME_PRESETS[0].tokens;
    return { ...base, ...sanitizeCustomTheme(custom) };
  }
  // A premium theme shows only while its creator is on Plus; otherwise the
  // page falls back to the default free theme (the setting itself is kept).
  if (isPremiumTheme(key)) {
    if (opts.plus) return findThemePreset(key)!.tokens;
    return THEME_PRESETS[0].tokens;
  }
  // An earned theme shows once its reward is unlocked, or with Plus.
  if (isRewardTheme(key)) {
    if (opts.plus || opts.unlocked) return findThemePreset(key)!.tokens;
    return THEME_PRESETS[0].tokens;
  }
  // Free seasonal themes keep showing after their season ends.
  const preset = findThemePreset(key) ?? THEME_PRESETS[0];
  return preset.tokens;
}

export function fontFamilyFor(font: ThemeTokens["font"]): string {
  switch (font) {
    case "serif":
      return "Georgia, 'Times New Roman', serif";
    case "mono":
      return "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
    case "display":
      return "'Bricolage Grotesque', 'Inter', system-ui, sans-serif";
    default:
      return "Inter, system-ui, -apple-system, Segoe UI, sans-serif";
  }
}

export function buttonRadiusFor(style: ThemeTokens["buttonStyle"]): string {
  switch (style) {
    case "pill":
      return "9999px";
    case "square":
      return "0px";
    case "soft":
      return "8px";
    case "outline":
      return "12px";
    default:
      return "16px";
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const COLOR_KEYS = ["background", "foreground", "card", "cardForeground", "border", "accent"] as const;
const BUTTON_STYLES = ["rounded", "pill", "square", "outline", "soft"] as const;
const FONTS = ["sans", "serif", "mono", "display"] as const;

/**
 * Keep only values a creator can actually pick in the editor (hex colors and
 * the listed styles), so a hand-written row can't inject other CSS such as
 * url(...) into visitors' pages. Mirrors public.custom_theme_is_valid().
 */
export function sanitizeCustomTheme(custom: unknown): Partial<ThemeTokens> {
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return {};
  const src = custom as Record<string, unknown>;
  const out: Partial<ThemeTokens> = {};
  for (const k of COLOR_KEYS) {
    const v = src[k];
    if (typeof v === "string" && HEX_COLOR.test(v)) out[k] = v;
  }
  if (BUTTON_STYLES.includes(src.buttonStyle as (typeof BUTTON_STYLES)[number])) {
    out.buttonStyle = src.buttonStyle as ThemeTokens["buttonStyle"];
  }
  if (FONTS.includes(src.font as (typeof FONTS)[number])) {
    out.font = src.font as ThemeTokens["font"];
  }
  return out;
}
