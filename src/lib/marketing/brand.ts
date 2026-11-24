/**
 * The Yooits.me brand for marketing graphics: the message, the logo's colors and
 * the "Yo" mark as vector shapes (measured from the logo file), plus the color
 * helpers that turn a page theme's CSS into SVG paint, so a phone in an ad
 * looks like the real page in that theme.
 */

export const BRAND = {
  name: "Yooits.me",
  site: "yooits.me",
  url: "https://yooits.me",
  message: "Yo, it's me.",
  tagline: "One link. Infinite personality.",
  /** The logo's own gradient, top left to bottom right. */
  grad: ["#c13cff", "#7b4ffa", "#14a8ff"] as const,
  ink: "#110c22",
  pink: "#ff5fd2",
};

/**
 * The "Yo" mark, in the logo's units (762 x 527): two round-capped strokes
 * for the Y and a ring for the o.
 */
export const YO_MARK = {
  w: 762,
  h: 527,
  stroke: 124,
  arms: [
    { x1: 64, y1: 61, x2: 200, y2: 318 },
    { x1: 355, y1: 61, x2: 143, y2: 465 },
  ],
  ring: { cx: 566.5, cy: 273, r: 136, stroke: 117 },
};

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export type Rgba = { hex: string; a: number };

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

export function oklchToHex(L: number, C: number, h: number): string {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const srgb = lin.map((x) => {
    const c = Math.max(0, Math.min(1, x));
    return 255 * (c > 0.0031308 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c);
  });
  return `#${srgb.map(hex2).join("")}`;
}

const NAMED: Record<string, Rgba> = {
  white: { hex: "#ffffff", a: 1 },
  black: { hex: "#000000", a: 1 },
  transparent: { hex: "#000000", a: 0 },
};

const num = (s: string, pctOf = 1) =>
  s.endsWith("%") ? (parseFloat(s) / 100) * pctOf : parseFloat(s);

/** A CSS color as hex plus alpha. Handles hex (3, 4, 6, 8), rgb(a), oklch and a few names. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      hex: `#${h.slice(0, 6)}`,
      a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1,
    };
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    return {
      hex: `#${p.slice(0, 3).map((v) => hex2(num(v, 255))).join("")}`,
      a: p[3] !== undefined ? num(p[3]) : 1,
    };
  }
  m = /^oklch\(([^)]+)\)$/.exec(s);
  if (m) {
    const [main, alpha] = m[1].split("/");
    const p = main.trim().split(/\s+/);
    if (p.length < 3) return null;
    return {
      hex: oklchToHex(num(p[0]), parseFloat(p[1]), parseFloat(p[2])),
      a: alpha !== undefined ? num(alpha.trim()) : 1,
    };
  }
  return null;
}

/** Hex for a color, ignoring alpha; falls back when unreadable. */
export function solid(input: string, fallback = "#8b5cf6"): string {
  return parseColor(input)?.hex ?? fallback;
}

// ---------------------------------------------------------------------------
// Backgrounds: CSS background strings to drawable layers
// ---------------------------------------------------------------------------

export type Stop = { offset: number; color: string; opacity: number };
export type Layer =
  | { type: "solid"; color: string; opacity: number }
  | { type: "linear"; x1: number; y1: number; x2: number; y2: number; stops: Stop[] }
  | {
      type: "radial";
      /** Centre and radii as fractions of the box, or px when `px` is set. */
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      px: boolean;
      stops: Stop[];
    };

/** Split on commas that aren't inside brackets. */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseStops(parts: string[]): Stop[] {
  const raw = parts
    .map((p) => {
      const m = /^(.*?)(?:\s+(-?[\d.]+%))?$/.exec(p.trim());
      if (!m) return null;
      const c = parseColor(m[1]);
      if (!c) return null;
      return { color: c.hex, opacity: c.a, offset: m[2] !== undefined ? num(m[2]) : NaN };
    })
    .filter((x): x is Stop => !!x);
  if (!raw.length) return [];
  if (Number.isNaN(raw[0].offset)) raw[0].offset = 0;
  if (Number.isNaN(raw[raw.length - 1].offset)) raw[raw.length - 1].offset = 1;
  // Spread stops that have no position evenly between their neighbours.
  for (let i = 1; i < raw.length - 1; i++) {
    if (!Number.isNaN(raw[i].offset)) continue;
    let j = i;
    while (Number.isNaN(raw[j].offset)) j++;
    const from = raw[i - 1].offset;
    const step = (raw[j].offset - from) / (j - i + 1);
    for (let k = i; k < j; k++) raw[k].offset = from + step * (k - i + 1);
  }
  return raw;
}

function parseLayer(css: string): Layer | null {
  const s = css.trim();
  let m = /^linear-gradient\((.*)\)$/i.exec(s);
  if (m) {
    const parts = splitTop(m[1]);
    let angle = 180;
    if (/^-?[\d.]+deg$/.test(parts[0])) angle = parseFloat(parts.shift()!);
    else if (/^to /.test(parts[0])) {
      const dir = parts.shift()!;
      angle = dir.includes("right") ? 90 : dir.includes("left") ? 270 : dir.includes("top") ? 0 : 180;
    }
    const r = (angle * Math.PI) / 180;
    const dx = Math.sin(r) / 2;
    const dy = -Math.cos(r) / 2;
    return {
      type: "linear",
      x1: 0.5 - dx,
      y1: 0.5 - dy,
      x2: 0.5 + dx,
      y2: 0.5 + dy,
      stops: parseStops(parts),
    };
  }
  m = /^radial-gradient\((.*)\)$/i.exec(s);
  if (m) {
    const parts = splitTop(m[1]);
    let cx = 0.5;
    let cy = 0.5;
    let rx = 0.7;
    let ry = 0.7;
    let px = false;
    if (!parseColor(parts[0].split(/\s+/)[0]) || / at /.test(parts[0])) {
      const shape = parts.shift()!;
      const [size, at] = shape.split(/\s*at\s*/);
      const dims = size.trim().split(/\s+/).filter((d) => /[\d.]+(px|%)$/.test(d));
      if (dims.length) {
        px = dims[0].endsWith("px");
        rx = px ? parseFloat(dims[0]) : num(dims[0]);
        ry = dims[1] ? (px ? parseFloat(dims[1]) : num(dims[1])) : rx;
      }
      if (at) {
        const [ax, ay] = at.trim().split(/\s+/);
        cx = ax?.endsWith("%") ? num(ax) : 0.5;
        cy = ay?.endsWith("%") ? num(ay) : 0.5;
      }
    }
    return { type: "radial", cx, cy, rx, ry, px, stops: parseStops(parts) };
  }
  const c = parseColor(s);
  return c ? { type: "solid", color: c.hex, opacity: c.a } : null;
}

/** CSS background (one or more comma-separated layers) as layers, bottom first. */
export function parseBackground(css: string): Layer[] {
  return splitTop(css)
    .map(parseLayer)
    .filter((l): l is Layer => !!l)
    .reverse();
}

// ---------------------------------------------------------------------------
// Tailwind gradient classes (link icons) to colors
// ---------------------------------------------------------------------------

const TW: Record<string, string> = {
  "pink-400": "#f472b6", "pink-500": "#ec4899", "fuchsia-400": "#e879f9",
  "fuchsia-500": "#d946ef", "fuchsia-600": "#c026d3", "orange-400": "#fb923c",
  "orange-500": "#f97316", "orange-600": "#ea580c", "yellow-300": "#fde047",
  "yellow-400": "#facc15", "yellow-500": "#eab308", "yellow-600": "#ca8a04",
  "amber-400": "#fbbf24", "amber-500": "#f59e0b", "amber-600": "#d97706",
  "blue-400": "#60a5fa", "blue-500": "#3b82f6", "blue-600": "#2563eb",
  "blue-700": "#1d4ed8", "blue-800": "#1e40af", "red-400": "#f87171",
  "red-500": "#ef4444", "red-600": "#dc2626", "red-700": "#b91c1c",
  "rose-600": "#e11d48", "rose-700": "#be123c", "slate-500": "#64748b",
  "slate-700": "#334155", "slate-800": "#1e293b", "slate-900": "#0f172a",
  "sky-400": "#38bdf8", "sky-600": "#0284c7", "sky-700": "#0369a1",
  "zinc-500": "#71717a", "zinc-600": "#52525b", "zinc-700": "#3f3f46",
  "zinc-800": "#27272a", "zinc-900": "#18181b", "cyan-400": "#22d3ee",
  "cyan-700": "#0e7490", "purple-500": "#a855f7", "purple-700": "#7e22ce",
  "purple-800": "#6b21a8", "violet-500": "#8b5cf6", "violet-700": "#6d28d9",
  "indigo-400": "#818cf8", "indigo-500": "#6366f1", "indigo-700": "#4338ca",
  "green-400": "#4ade80", "green-600": "#16a34a", "green-700": "#15803d",
  "emerald-400": "#34d399", "emerald-600": "#059669", "emerald-700": "#047857",
  "teal-400": "#2dd4bf", "teal-600": "#0d9488", black: "#000000",
};

/** "from-pink-500 via-fuchsia-500 to-orange-400" to two or three colors. */
export function twGradient(classes: string): string[] {
  const out = classes
    .split(/\s+/)
    .map((c) => /^(?:from|via|to)-(.+)$/.exec(c)?.[1])
    .filter((c): c is string => !!c)
    .map((c) => TW[c] ?? "#8b5cf6");
  return out.length ? out : ["#8b5cf6", "#d946ef"];
}
