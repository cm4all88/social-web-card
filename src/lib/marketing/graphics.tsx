/**
 * Post graphics, drawn as SVG at each platform's size and downloadable as
 * PNG. Everything is drawn here (no outside images), so the download works
 * offline and nothing third-party is pulled in.
 *
 * Phones in the graphics are drawn from the real page code's numbers: the
 * page themes in themes.ts, the link buttons and icons in platforms.ts, and
 * the spacing of the profile and wishlist pages. They show only what the
 * live pages show, with no usernames: the page says "Yo, it's me." and the
 * address is yooits.me.
 */
import type { ReactNode } from "react";
import { Check, Gift, MessageCircle, ExternalLink, BarChart3 } from "lucide-react";
import { linkDisplay } from "@/lib/platforms";
import {
  buttonRadiusFor,
  findThemePreset,
  fontFamilyFor,
  isPremiumTheme,
  isRewardTheme,
  SEASONAL_THEME_PRESETS,
  THEME_PRESETS,
  type ThemeTokens,
} from "@/lib/themes";
import {
  BRAND,
  YO_MARK,
  parseBackground,
  parseColor,
  solid,
  twGradient,
  type Layer,
} from "./brand";
import type { GraphicSize } from "./platforms";
import type { GraphicLayout, GraphicSpec, GraphicTheme, MockLink, MockItem } from "./types";

export const FONT = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Break text into lines of at most `max` characters, on word boundaries. */
export function wrap(text: string, max: number, maxLines = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= max) line += " " + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

/** Rough width of a character at a weight, as a share of the font size. */
const CHAR = (weight: number) => (weight >= 800 ? 0.6 : weight >= 600 ? 0.56 : 0.52);
const charsFor = (width: number, size: number, weight: number) =>
  Math.max(4, Math.floor(width / (size * CHAR(weight))));

/** The largest size (down to `min`) at which the text fits in `maxLines`. */
function fitText(
  text: string,
  width: number,
  size: number,
  min: number,
  maxLines: number,
  weight = 800,
) {
  let s = size;
  while (s > min) {
    const lines = wrap(text.replace(/\*/g, ""), charsFor(width, s, weight), 99);
    if (lines.length <= maxLines) break;
    s -= 2;
  }
  return { size: s, lines: wrapMarked(text, charsFor(width, s, weight), maxLines) };
}

/** Wrap text that marks gradient words with *stars*, keeping the marks per line. */
function wrapMarked(text: string, max: number, maxLines: number): string[] {
  const plain = wrap(text.replace(/\*/g, ""), max, maxLines);
  if (!text.includes("*")) return plain;
  // Re-mark: words that were inside stars get stars again on their line.
  const marked = new Set<number>();
  let inside = false;
  let idx = 0;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const starts = w.startsWith("*");
    if (starts) inside = true;
    if (inside) marked.add(idx);
    if (w.replace(/[.,!?]+$/, "").endsWith("*")) inside = false;
    idx++;
  }
  let n = 0;
  return plain.map((line) =>
    line
      .split(" ")
      .map((w) => (marked.has(n++) ? `*${w}*` : w))
      .join(" ")
      .replace(/\*\s\*/g, " "),
  );
}

/** One line of text, with *marked* parts filled with the brand gradient. */
function Line({
  text,
  gradId,
  ...rest
}: { text: string; gradId: string } & Record<string, unknown>) {
  // Renderers drop spaces at the edge of a tspan, so the space at each join
  // becomes a shift (dx) on the part after it.
  const gap = Number(rest.fontSize ?? 16) * 0.26;
  const raw = text.split(/(\*[^*]+\*)/).filter(Boolean);
  const parts = raw.map((p, i) => ({
    text: p.trim(),
    grad: p.startsWith("*"),
    dx: i > 0 && (/^\s/.test(p) || /\s$/.test(raw[i - 1])) ? gap : 0,
  }));
  return (
    <text {...rest}>
      {parts.map((p, i) => (
        <tspan key={i} dx={p.dx || undefined} fill={p.grad ? `url(#${gradId})` : undefined}>
          {p.grad ? p.text.slice(1, -1) : p.text}
        </tspan>
      ))}
    </text>
  );
}

// ---------------------------------------------------------------------------
// Backdrops and brand pieces
// ---------------------------------------------------------------------------

type Palette = { text: string; sub: string; muted: string; chip: string; chipText: string };
const PALETTES: Record<GraphicTheme, Palette> = {
  brand: {
    text: "#ffffff",
    sub: "#dcd3ff",
    muted: "#a99fd6",
    chip: "rgba(255,255,255,0.1)",
    chipText: "#ffffff",
  },
  night: {
    text: "#ffffff",
    sub: "#e6d9ff",
    muted: "#b9a8e6",
    chip: "rgba(255,255,255,0.1)",
    chipText: "#ffffff",
  },
  snow: {
    text: "#ffffff",
    sub: "#e0f0ff",
    muted: "#bcd6f5",
    chip: "rgba(255,255,255,0.14)",
    chipText: "#ffffff",
  },
  warm: {
    text: "#fff8f0",
    sub: "#ffe2c9",
    muted: "#f3bfa0",
    chip: "rgba(255,255,255,0.12)",
    chipText: "#fff8f0",
  },
  light: {
    text: "#1a1033",
    sub: "#4b3f73",
    muted: "#7a6fa3",
    chip: "rgba(26,16,51,0.06)",
    chipText: "#1a1033",
  },
};

export function Backdrop({
  theme,
  w,
  h,
  uid,
}: {
  theme: GraphicTheme;
  w: number;
  h: number;
  uid: string;
}) {
  const u = Math.min(w, h) / 1080;
  const base: Record<GraphicTheme, [string, string]> = {
    brand: [BRAND.ink, "#1b1038"],
    night: ["#1a1240", "#3d1563"],
    snow: ["#0f2350", "#2f62b8"],
    warm: ["#2a0f1f", "#8a2d2a"],
    light: ["#fbf8ff", "#eee7ff"],
  };
  const [a, b] = base[theme] ?? base.brand;
  const glowA = theme === "light" ? 0.22 : theme === "warm" ? 0.3 : 0.5;
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
        <radialGradient id={`${uid}-glow1`}>
          <stop
            offset="0"
            stopColor={theme === "warm" ? "#ff8a3d" : BRAND.grad[0]}
            stopOpacity={glowA}
          />
          <stop offset="1" stopColor={BRAND.grad[0]} stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${uid}-glow2`}>
          <stop
            offset="0"
            stopColor={theme === "warm" ? "#ff4f8b" : BRAND.grad[2]}
            stopOpacity={glowA * 0.8}
          />
          <stop offset="1" stopColor={BRAND.grad[2]} stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#${uid}-bg)`} />
      <ellipse cx={w * 0.92} cy={h * 0.12} rx={620 * u} ry={620 * u} fill={`url(#${uid}-glow1)`} />
      <ellipse cx={w * 0.05} cy={h * 0.92} rx={700 * u} ry={700 * u} fill={`url(#${uid}-glow2)`} />
      {theme === "snow" && <Flakes w={w} h={h} n={70} seed={3} scale={u * 2.2} />}
    </g>
  );
}

/** Deterministic snowflakes (or stars) scattered over a box. */
function Flakes({
  w,
  h,
  n,
  seed,
  scale,
  color = "#ffffff",
  x = 0,
  y = 0,
}: {
  w: number;
  h: number;
  n: number;
  seed: number;
  scale: number;
  color?: string;
  x?: number;
  y?: number;
}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = i + seed * 31;
    const fx = ((k * 9973) % 1000) / 1000;
    const fy = ((k * 7919) % 1000) / 1000;
    const r = (1.2 + ((k * 13) % 5) * 0.7) * scale;
    out.push(
      <circle
        key={i}
        cx={x + fx * w}
        cy={y + fy * h}
        r={r}
        fill={color}
        opacity={0.35 + ((k * 7) % 5) * 0.12}
      />,
    );
  }
  return <g>{out}</g>;
}

export function BrandGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor={BRAND.grad[0]} />
      <stop offset="0.5" stopColor={BRAND.grad[1]} />
      <stop offset="1" stopColor={BRAND.grad[2]} />
    </linearGradient>
  );
}

/** The "Yo" mark, `width` wide, top-left at x, y. */
export function YoMark({
  x,
  y,
  width,
  uid,
  color,
}: {
  x: number;
  y: number;
  width: number;
  uid: string;
  color?: string;
}) {
  const s = width / YO_MARK.w;
  const gid = `${uid}-yo`;
  const paint = color ?? `url(#${gid})`;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {!color && (
        <defs>
          <linearGradient
            id={gid}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2={YO_MARK.w}
            y2={YO_MARK.h}
          >
            <stop offset="0" stopColor={BRAND.grad[0]} />
            <stop offset="0.55" stopColor={BRAND.grad[1]} />
            <stop offset="1" stopColor={BRAND.grad[2]} />
          </linearGradient>
        </defs>
      )}
      {YO_MARK.arms.map((a, i) => (
        <line key={i} {...a} stroke={paint} strokeWidth={YO_MARK.stroke} strokeLinecap="round" />
      ))}
      <circle
        {...YO_MARK.ring}
        r={YO_MARK.ring.r}
        fill="none"
        stroke={paint}
        strokeWidth={YO_MARK.ring.stroke}
      />
    </g>
  );
}

/** Mark plus "yooits.me", `h` tall. */
export function Lockup({
  x,
  y,
  h,
  uid,
  text,
}: {
  x: number;
  y: number;
  h: number;
  uid: string;
  text: string;
}) {
  const markW = (h * YO_MARK.w) / YO_MARK.h;
  return (
    <g>
      <YoMark x={x} y={y} width={markW} uid={`${uid}-lk`} />
      <text
        x={x + markW + h * 0.32}
        y={y + h * 0.78}
        fill={text}
        fontFamily={FONT}
        fontWeight={800}
        fontSize={h * 0.78}
        letterSpacing={-0.5}
      >
        yooits<tspan fill={`url(#${uid}-brand)`}>.me</tspan>
      </text>
    </g>
  );
}

function Cta({
  x,
  y,
  size,
  text,
  uid,
  anchor = "start",
}: {
  x: number;
  y: number;
  size: number;
  text: string;
  uid: string;
  anchor?: "start" | "middle";
}) {
  const label = `${text}  →`;
  const w = label.length * size * 0.56 + size * 2.2;
  const h = size * 2.4;
  const left = anchor === "middle" ? x - w / 2 : x;
  return (
    <g>
      <rect x={left} y={y} width={w} height={h} rx={h / 2} fill={`url(#${uid}-brand)`} />
      <text
        x={left + w / 2}
        y={y + h / 2 + size * 0.36}
        textAnchor="middle"
        fill="#ffffff"
        fontFamily={FONT}
        fontWeight={700}
        fontSize={size}
      >
        {label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Page backgrounds (theme CSS) as SVG
// ---------------------------------------------------------------------------

export function Paint({
  layers,
  x,
  y,
  w,
  h,
  rx = 0,
  uid,
}: {
  layers: Layer[];
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
  uid: string;
}) {
  return (
    <g>
      {layers.map((l, i) => {
        const id = `${uid}-p${i}`;
        if (l.type === "solid") {
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={w}
              height={h}
              rx={rx}
              fill={l.color}
              fillOpacity={l.opacity}
            />
          );
        }
        if (l.type === "linear") {
          return (
            <g key={i}>
              <defs>
                <linearGradient id={id} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}>
                  {l.stops.map((s, j) => (
                    <stop key={j} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
                  ))}
                </linearGradient>
              </defs>
              <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#${id})`} />
            </g>
          );
        }
        // Tiny px radial layers are the star dots some themes paint; draw them as dots.
        if (l.px) {
          const c = l.stops[0];
          return (
            <circle
              key={i}
              cx={x + l.cx * w}
              cy={y + l.cy * h}
              r={Math.max(1, l.rx * 0.8)}
              fill={c?.color ?? "#fff"}
              fillOpacity={c?.opacity ?? 0.8}
            />
          );
        }
        return (
          <g key={i}>
            <defs>
              <radialGradient
                id={id}
                cx={l.cx}
                cy={l.cy}
                r={0.5}
                gradientTransform={`translate(${l.cx} ${l.cy}) scale(${l.rx} ${l.ry}) translate(${-l.cx} ${-l.cy})`}
              >
                {l.stops.map((s, j) => (
                  <stop key={j} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
                ))}
              </radialGradient>
            </defs>
            <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#${id})`} />
          </g>
        );
      })}
    </g>
  );
}

export const fillOf = (css: string) => {
  const c = parseColor(css);
  return c ? { fill: c.hex, fillOpacity: c.a } : { fill: solid(css), fillOpacity: 1 };
};
const strokeOf = (css: string) => {
  const c = parseColor(css);
  return c ? { stroke: c.hex, strokeOpacity: c.a } : { stroke: solid(css), strokeOpacity: 1 };
};

/**
 * Page themes an ad may show: the free ones anyone can pick today. Plus and
 * earned themes stay out of ads until they're on sale and approved.
 */
export const AD_LOOKS: { key: string; label: string }[] = [
  ...THEME_PRESETS,
  ...SEASONAL_THEME_PRESETS,
]
  .filter((p) => !isPremiumTheme(p.key) && !isRewardTheme(p.key))
  .map((p) => ({ key: p.key, label: p.label }));

function themeOf(key?: string): { tokens: ThemeTokens; label: string; key: string } {
  const allowed = key && AD_LOOKS.some((l) => l.key === key) ? key : THEME_PRESETS[0].key;
  const p = findThemePreset(allowed) ?? THEME_PRESETS[0];
  return { tokens: p.tokens, label: p.label, key: p.key };
}

const radiusPx = (style: ThemeTokens["buttonStyle"], h: number) => {
  const r = buttonRadiusFor(style);
  return r === "9999px" ? h / 2 : parseFloat(r);
};

// ---------------------------------------------------------------------------
// Phone and its screens. Screens are drawn at 390 x 844 (a phone's CSS size)
// with the page's own spacing, then scaled into the frame.
// ---------------------------------------------------------------------------

export const SCREEN_W = 390;
export const SCREEN_H = 844;
const BEZEL = 14;
const PHONE_W = SCREEN_W + BEZEL * 2;
const PHONE_H = SCREEN_H + BEZEL * 2;
export const PHONE_RATIO = PHONE_H / PHONE_W;

export function Phone({
  x,
  y,
  w,
  uid,
  rotate = 0,
  children,
}: {
  x: number;
  y: number;
  w: number;
  uid: string;
  rotate?: number;
  children: ReactNode;
}) {
  const s = w / PHONE_W;
  const clip = `${uid}-clip`;
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${rotate} ${w / 2} ${(PHONE_H * s) / 2}) scale(${s})`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={BEZEL} y={BEZEL} width={SCREEN_W} height={SCREEN_H} rx={50} />
        </clipPath>
        <filter id={`${uid}-sh`} x="-30%" y="-20%" width="160%" height="150%">
          <feDropShadow dx="0" dy="30" stdDeviation="34" floodColor="#05010f" floodOpacity="0.55" />
        </filter>
      </defs>
      <rect width={PHONE_W} height={PHONE_H} rx={64} fill="#0b0b10" filter={`url(#${uid}-sh)`} />
      <rect
        x={2}
        y={2}
        width={PHONE_W - 4}
        height={PHONE_H - 4}
        rx={62}
        fill="none"
        stroke="#3a3548"
        strokeWidth={3}
      />
      <g clipPath={`url(#${clip})`}>
        <g transform={`translate(${BEZEL} ${BEZEL})`}>{children}</g>
      </g>
      <rect x={PHONE_W / 2 - 62} y={BEZEL + 11} width={124} height={34} rx={17} fill="#0b0b10" />
    </g>
  );
}

export function StatusBar({ color }: { color: string }) {
  return (
    <g fill={color}>
      <text x={34} y={33} fontFamily={FONT} fontWeight={600} fontSize={16}>
        9:41
      </text>
      <rect
        x={322}
        y={21}
        width={26}
        height={13}
        rx={4}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={0.9}
      />
      <rect x={325} y={24} width={19} height={7} rx={2} />
      <rect x={350} y={25} width={2.5} height={5} rx={1} opacity={0.6} />
    </g>
  );
}

function Effect({ kind, color }: { kind?: GraphicSpec["effect"]; color: string }) {
  if (!kind) return null;
  if (kind === "snow")
    return <Flakes w={SCREEN_W} h={SCREEN_H} n={46} seed={7} scale={1.6} color="#ffffff" />;
  if (kind === "stars")
    return <Flakes w={SCREEN_W} h={SCREEN_H} n={40} seed={11} scale={1} color="#fff7d6" />;
  const shape = kind === "hearts" ? "♥" : "❦";
  const fill = kind === "hearts" ? "#fb7185" : "#f59e0b";
  return (
    <g>
      {Array.from({ length: 14 }, (_, i) => (
        <text
          key={i}
          x={((i * 9973) % 360) + 10}
          y={((i * 7919) % 800) + 30}
          fontSize={14 + (i % 3) * 6}
          fill={fill}
          opacity={0.55}
          fontFamily={FONT}
        >
          {shape}
        </text>
      ))}
      <rect width={SCREEN_W} height={SCREEN_H} fill={color} opacity={0} />
    </g>
  );
}

const DEFAULT_LINKS: MockLink[] = [
  { label: "Instagram", icon: "instagram", host: "instagram.com" },
  { label: "TikTok", icon: "tiktok", host: "tiktok.com" },
  { label: "YouTube", icon: "youtube", host: "youtube.com" },
  { label: "Shop", icon: "shop", host: "etsy.com" },
  { label: "Spotify", icon: "spotify", host: "open.spotify.com" },
];

/** A link button as the profile page draws it. Returns its height. */
export function LinkCard({
  link,
  y,
  t,
  uid,
  i,
}: {
  link: MockLink;
  y: number;
  t: ThemeTokens;
  uid: string;
  i: number;
}) {
  const featured = !!link.featured;
  const isWish = link.icon === "wishlist";
  const h = featured ? 88 : 80;
  const x = 24;
  const w = SCREEN_W - 48;
  const outline = t.buttonStyle === "outline";
  const r = radiusPx(t.buttonStyle, h);
  const meta = linkDisplay({
    platform: isWish ? "website" : link.icon,
    title: link.label,
    icon: isWish ? "gift" : link.icon,
  });
  const Icon = isWish ? Gift : meta.icon;
  const colors = twGradient(meta.color);
  const pad = featured ? 20 : 16;
  const gid = `${uid}-ic${i}`;
  const accent = solid(t.accent, "#ffffff");
  const cardFg = solid(t.cardForeground, "#ffffff");
  const pill = featured ? "Open →" : isWish ? "" : "Connect →";
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={Math.min(r, h / 2)}
        {...(outline ? { fill: "none" } : fillOf(t.card))}
        {...(featured
          ? { stroke: accent, strokeWidth: 2 }
          : { ...strokeOf(t.border), strokeWidth: 1 })}
      />
      {isWish ? (
        <Icon x={x + pad} y={y + (h - 24) / 2} width={24} height={24} color={accent} />
      ) : (
        <g>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              {colors.map((c, j) => (
                <stop
                  key={j}
                  offset={colors.length === 1 ? 0 : j / (colors.length - 1)}
                  stopColor={c}
                />
              ))}
            </linearGradient>
          </defs>
          <rect
            x={x + pad}
            y={y + (h - 48) / 2}
            width={48}
            height={48}
            rx={12}
            fill={`url(#${gid})`}
          />
          <Icon x={x + pad + 12} y={y + (h - 48) / 2 + 12} width={24} height={24} color="#ffffff" />
        </g>
      )}
      <text
        x={x + pad + (isWish ? 40 : 64)}
        y={y + h / 2 - (link.host ? 3 : -6)}
        fill={cardFg}
        fontFamily="inherit"
        fontWeight={600}
        fontSize={16}
      >
        {link.label.length > 22 ? link.label.slice(0, 21) + "…" : link.label}
      </text>
      {link.host && (
        <text
          x={x + pad + (isWish ? 40 : 64)}
          y={y + h / 2 + 16}
          fill={cardFg}
          opacity={0.7}
          fontFamily="inherit"
          fontSize={12}
        >
          {link.host}
        </text>
      )}
      {pill ? (
        <g>
          <rect
            x={x + w - pad - 86}
            y={y + h / 2 - 13}
            width={86}
            height={26}
            rx={13}
            fill={accent}
            fillOpacity={0.13}
          />
          <text
            x={x + w - pad - 43}
            y={y + h / 2 + 4.5}
            textAnchor="middle"
            fill={accent}
            fontFamily="inherit"
            fontWeight={500}
            fontSize={12}
          >
            {pill}
          </text>
        </g>
      ) : (
        <text
          x={x + w - pad}
          y={y + h / 2 + 4}
          textAnchor="end"
          fill={cardFg}
          opacity={0.7}
          fontFamily="inherit"
          fontSize={12}
        >
          View list →
        </text>
      )}
    </g>
  );
}

/** The public profile page, as yooits.me draws it. */
function ProfileScreen({ spec, look, uid }: { spec: GraphicSpec; look?: string; uid: string }) {
  const { tokens: t, key } = themeOf(look ?? spec.look);
  const fg = solid(t.foreground, "#ffffff");
  const accent = solid(t.accent, "#ffffff");
  const font = fontFamilyFor(t.font);
  const effect = spec.effect ?? (key === "snowfall" ? "snow" : undefined);
  const links = (spec.links?.length ? spec.links : DEFAULT_LINKS).slice(0, 6);
  const bio = wrap(spec.bio ?? "Everything I make, share and love. One link.", 38, 2);
  const radius = radiusPx(t.buttonStyle, 38);
  let y = 88;
  const avatarCy = y + 56;
  y += 112 + 20;
  const nameY = y + 26;
  const handleY = nameY + 26;
  const bioY = handleY + 30;
  const msgY = bioY + bio.length * 24 + 4;
  let linkY = msgY + 38 + 40;
  return (
    <g fontFamily={font}>
      <Paint
        layers={parseBackground(t.background)}
        x={0}
        y={0}
        w={SCREEN_W}
        h={SCREEN_H}
        uid={`${uid}-bgp`}
      />
      <Effect kind={effect} color={fg} />
      <StatusBar color={fg} />
      <circle cx={SCREEN_W / 2} cy={avatarCy} r={52} {...fillOf(t.card)} />
      <circle cx={SCREEN_W / 2} cy={avatarCy} r={54} fill="none" stroke={accent} strokeWidth={4} />
      <text
        x={SCREEN_W / 2}
        y={avatarCy + 13}
        textAnchor="middle"
        fill={fg}
        fontWeight={800}
        fontSize={40}
      >
        Y
      </text>
      <text
        x={SCREEN_W / 2}
        y={nameY}
        textAnchor="middle"
        fill={fg}
        fontWeight={700}
        fontSize={30}
        letterSpacing={-0.5}
      >
        {BRAND.message}
      </text>
      <text x={SCREEN_W / 2} y={handleY} textAnchor="middle" fill={fg} opacity={0.7} fontSize={14}>
        {BRAND.site}
      </text>
      {bio.map((line, i) => (
        <text
          key={i}
          x={SCREEN_W / 2}
          y={bioY + i * 24}
          textAnchor="middle"
          fill={fg}
          opacity={0.8}
          fontSize={16}
        >
          {line}
        </text>
      ))}
      <rect
        x={SCREEN_W / 2 - 64}
        y={msgY}
        width={128}
        height={38}
        rx={Math.min(radius, 19)}
        fill="none"
        stroke={accent}
        strokeWidth={1}
      />
      <MessageCircle x={SCREEN_W / 2 - 44} y={msgY + 11} width={16} height={16} color={fg} />
      <text
        x={SCREEN_W / 2 + 10}
        y={msgY + 24}
        textAnchor="middle"
        fill={fg}
        fontWeight={600}
        fontSize={14}
      >
        Message
      </text>
      {links.map((l, i) => {
        const node = <LinkCard key={i} link={l} y={linkY} t={t} uid={uid} i={i} />;
        linkY += (l.featured ? 88 : 80) + 12;
        return node;
      })}
      <text
        x={SCREEN_W / 2}
        y={linkY + 28}
        textAnchor="middle"
        fill={fg}
        opacity={0.6}
        fontSize={12}
      >
        Create your free profile on Yooits.me
      </text>
    </g>
  );
}

const DEFAULT_LIST: NonNullable<GraphicSpec["list"]> = {
  title: "Holiday list",
  occasion: "Holidays",
  items: [
    { name: "Wireless earbuds", price: "$59", host: "amazon.com", taken: true },
    { name: "Cozy reading socks", price: "$18", host: "target.com" },
    { name: "Sketchbook set", price: "$24", host: "amazon.com" },
    { name: "Board game night pick", price: "$35", host: "target.com" },
  ],
};

/** A shared wishlist, as yooits.me draws it for a friend. */
function WishlistScreen({ spec, uid }: { spec: GraphicSpec; uid: string }) {
  const { tokens: t } = themeOf(spec.look ?? "candy");
  const list = spec.list ?? DEFAULT_LIST;
  const fg = solid(t.foreground, "#ffffff");
  const cardFg = solid(t.cardForeground, fg);
  const accent = solid(t.accent, "#ffffff");
  const font = fontFamilyFor(t.font);
  const r = Math.min(radiusPx(t.buttonStyle, 140), 24);
  let y = list.forLine ? 268 : 244;
  return (
    <g fontFamily={font}>
      <Paint
        layers={parseBackground(t.background)}
        x={0}
        y={0}
        w={SCREEN_W}
        h={SCREEN_H}
        uid={`${uid}-wbg`}
      />
      <StatusBar color={fg} />
      <Gift x={SCREEN_W / 2 - 20} y={92} width={40} height={40} color={accent} />
      <text x={SCREEN_W / 2} y={178} textAnchor="middle" fill={fg} fontWeight={700} fontSize={30}>
        {list.title.length > 20 ? list.title.slice(0, 19) + "…" : list.title}
      </text>
      {list.forLine && (
        <text
          x={SCREEN_W / 2}
          y={206}
          textAnchor="middle"
          fill={fg}
          opacity={0.9}
          fontWeight={500}
          fontSize={16}
        >
          {list.forLine}
        </text>
      )}
      {list.occasion && (
        <text
          x={SCREEN_W / 2}
          y={list.forLine ? 230 : 206}
          textAnchor="middle"
          fill={fg}
          opacity={0.7}
          fontSize={14}
        >
          {list.occasion}
        </text>
      )}
      {list.items.slice(0, 4).map((it: MockItem, i: number) => {
        const h = it.host ? 140 : 100;
        const top = y;
        y += h + 16;
        return (
          <g key={i} opacity={it.taken ? 0.6 : 1}>
            <rect
              x={24}
              y={top}
              width={SCREEN_W - 48}
              height={h}
              rx={r}
              {...fillOf(t.card)}
              {...strokeOf(t.border)}
              strokeWidth={1}
            />
            <text x={40} y={top + 30} fill={cardFg} fontWeight={600} fontSize={16}>
              {it.name.length > 26 ? it.name.slice(0, 25) + "…" : it.name}
            </text>
            {it.price && (
              <text
                x={SCREEN_W - 40}
                y={top + 30}
                textAnchor="end"
                fill={cardFg}
                opacity={0.8}
                fontSize={14}
              >
                {it.price}
              </text>
            )}
            {it.host && (
              <g>
                <rect
                  x={40}
                  y={top + 46}
                  width={it.host.length * 7.4 + 82}
                  height={30}
                  rx={15}
                  fill={accent}
                  fillOpacity={0.13}
                />
                <text x={52} y={top + 66} fill={accent} fontWeight={500} fontSize={14}>
                  View at {it.host}
                </text>
                <ExternalLink
                  x={52 + (8 + it.host.length) * 7.4 + 6}
                  y={top + 54}
                  width={14}
                  height={14}
                  color={accent}
                />
              </g>
            )}
            {it.taken ? (
              <g>
                <Check x={40} y={top + h - 32} width={16} height={16} color={cardFg} />
                <text x={62} y={top + h - 19} fill={cardFg} fontWeight={500} fontSize={14}>
                  Someone's getting this
                </text>
              </g>
            ) : (
              <g>
                <rect
                  x={40}
                  y={top + h - 42}
                  width={118}
                  height={30}
                  rx={15}
                  fill="none"
                  {...strokeOf(t.border)}
                  strokeWidth={1}
                />
                <Gift x={52} y={top + h - 34} width={14} height={14} color={cardFg} />
                <text x={72} y={top + h - 22} fill={cardFg} fontWeight={500} fontSize={14}>
                  I'll buy it
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** The dashboard's analytics card (app colors), with example numbers. */
function AnalyticsPanel({
  x,
  y,
  w,
  uid,
  pal,
}: {
  x: number;
  y: number;
  w: number;
  uid: string;
  pal: Palette;
}) {
  const s = w / 600;
  const card = "#38395c";
  const muted = "#b9b3da";
  const primary = "#df6df8";
  const accent = "#eb53c2";
  const bars = Array.from({ length: 30 }, (_, i) => {
    const v = 0.35 + 0.5 * Math.abs(Math.sin(i * 0.7 + 1)) + (i / 30) * 0.3;
    return { v: Math.min(1, v), c: Math.min(1, v * (0.28 + ((i * 7) % 5) * 0.03)) };
  });
  const stats = [
    { label: "VIEWS", value: "1,284" },
    { label: "CLICKS", value: "412" },
    { label: "CLICK RATE", value: "32%" },
  ];
  const ranks: [string, [string, string][]][] = [
    [
      "Clicks by link",
      [
        ["Instagram", "168"],
        ["Shop", "121"],
        ["YouTube", "74"],
      ],
    ],
    [
      "Where visitors came from",
      [
        ["Instagram", "540"],
        ["TikTok", "322"],
        ["Direct", "210"],
      ],
    ],
  ];
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fontFamily={FONT}>
      <defs>
        <filter id={`${uid}-ash`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="24" stdDeviation="28" floodColor="#05010f" floodOpacity="0.5" />
        </filter>
      </defs>
      <rect width={600} height={560} rx={28} fill={card} filter={`url(#${uid}-ash)`} />
      <rect width={600} height={560} rx={28} fill="none" stroke="#ffffff" strokeOpacity={0.08} />
      <BarChart3 x={32} y={30} width={24} height={24} color={primary} />
      <text x={66} y={49} fill="#ffffff" fontWeight={700} fontSize={22}>
        Analytics
      </text>
      <text x={568} y={49} textAnchor="end" fill={muted} fontSize={15}>
        Last 30 days
      </text>
      {stats.map((st, i) => (
        <g key={i}>
          <rect
            x={32 + i * 184}
            y={76}
            width={168}
            height={92}
            rx={16}
            fill="#ffffff"
            fillOpacity={0.05}
          />
          <text x={50 + i * 184} y={106} fill={muted} fontSize={12} letterSpacing={0.8}>
            {st.label}
          </text>
          <text x={50 + i * 184} y={148} fill="#ffffff" fontWeight={800} fontSize={34}>
            {st.value}
          </text>
        </g>
      ))}
      {bars.map((b, i) => (
        <g key={i}>
          <rect
            x={32 + i * 18}
            y={300 - b.v * 104}
            width={12}
            height={b.v * 104}
            rx={3}
            fill={primary}
            fillOpacity={0.7}
          />
          <rect
            x={32 + i * 18}
            y={300 - b.c * 104}
            width={12}
            height={b.c * 104}
            rx={3}
            fill={accent}
          />
        </g>
      ))}
      {ranks.map(([title, rows], c) => (
        <g key={c} transform={`translate(${32 + c * 280} 334)`}>
          <text fill="#ffffff" fontWeight={600} fontSize={15} y={16}>
            {title}
          </text>
          {rows.map(([label, val], r) => (
            <g key={r} transform={`translate(0 ${44 + r * 42})`}>
              <rect width={256} height={32} rx={8} fill="#ffffff" fillOpacity={0.05} />
              <rect
                width={(256 * Number(val)) / (c ? 560 : 180)}
                height={32}
                rx={8}
                fill={primary}
                fillOpacity={0.25}
              />
              <text x={12} y={21} fill="#ffffff" fontSize={14}>
                {label}
              </text>
              <text x={244} y={21} textAnchor="end" fill="#ffffff" fontWeight={600} fontSize={14}>
                {val}
              </text>
            </g>
          ))}
        </g>
      ))}
      <text x={568} y={540} textAnchor="end" fill={pal.muted} fontSize={12} opacity={0.9}>
        Example numbers
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

const LEGACY: Record<string, GraphicLayout> = {
  headline: "statement",
  list: "steps",
  steps: "steps",
  wishlist: "wishlist",
  profile: "profile",
};

export function layoutOf(spec: GraphicSpec): GraphicLayout {
  return spec.layout ?? LEGACY[spec.template ?? ""] ?? "statement";
}

export const LAYOUT_LABELS: Record<GraphicLayout, string> = {
  hero: "Brand hero (three phones)",
  profile: "Profile page on a phone",
  themes: "Theme lineup",
  wishlist: "Wishlist on a phone",
  analytics: "Analytics card",
  steps: "Numbered steps",
  statement: "Big statement",
  compare: "Before and after",
};

export const BACKDROP_LABELS: Record<GraphicTheme, string> = {
  brand: "Yooits.me dark",
  night: "Night purple",
  snow: "Winter blue",
  warm: "Warm",
  light: "Light",
};

type Box = { x: number; y: number; w: number; h: number };

export function PostGraphic({
  spec,
  size,
  id,
}: {
  spec: GraphicSpec;
  size: GraphicSize;
  id?: string;
}) {
  const { w, h } = size;
  const uid = (id ?? "g").replace(/[^a-zA-Z0-9_-]/g, "");
  const theme: GraphicTheme = PALETTES[spec.theme] ? spec.theme : "brand";
  const pal = PALETTES[theme];
  const layout = layoutOf(spec);
  const u = Math.min(w, h) / 1080;
  const tall = h / w > 1.5;
  // Wide canvases, and square ones showing a single phone, put text left and the visual right.
  const wide = w / h > 1.3 || (!tall && (layout === "profile" || layout === "wishlist"));
  const landscape = w / h > 1.3;
  const pad = (landscape ? 64 : 76) * u;
  const lockH = (landscape ? 46 : 48) * u;
  const statement = layout === "statement";

  // Text block: left column when wide, top band otherwise (centered for statements).
  const textW = wide ? w * (statement ? 0.86 : landscape ? 0.5 : 0.52) - pad : w - pad * 2;
  const center = statement && !wide;
  const headBase =
    (statement
      ? tall
        ? 150
        : landscape
          ? 120
          : 128
      : landscape
        ? 100
        : wide
          ? 88
          : tall
            ? 118
            : 92) * u;
  const head = fitText(
    spec.headline || BRAND.message,
    textW,
    headBase,
    headBase * 0.55,
    statement ? 4 : 3,
  );
  const subSize = (landscape ? 38 : wide ? 32 : tall ? 44 : 36) * u;
  const sub = spec.sub ? wrap(spec.sub, charsFor(textW, subSize, 500), wide ? 3 : 2) : [];
  const eyebrowSize = (landscape ? 26 : 24) * u;
  const ctaSize = (landscape ? 32 : wide ? 28 : tall ? 34 : 30) * u;
  const ctaText = spec.cta ?? "Make yours at yooits.me";
  const blockH =
    (spec.eyebrow ? eyebrowSize * 2.2 : 0) +
    head.lines.length * head.size * 1.06 +
    (sub.length ? subSize * 0.7 + sub.length * subSize * 1.3 : 0) +
    ctaSize * 1.2 +
    ctaSize * 2.4;
  const textTop = wide
    ? Math.max(pad + lockH + 30 * u, (h - blockH) / 2 + lockH * 0.4)
    : statement
      ? Math.max(pad + lockH + 60 * u, (h - blockH) / 2 - 40 * u)
      : pad + lockH + (tall ? 110 : 54) * u;
  const tx = center ? w / 2 : pad;
  const anchor = center ? "middle" : "start";
  let cy = textTop;
  const text: ReactNode[] = [];
  if (spec.eyebrow) {
    cy += eyebrowSize;
    text.push(
      <text
        key="eb"
        x={tx}
        y={cy}
        textAnchor={anchor}
        fill={`url(#${uid}-brand)`}
        fontFamily={FONT}
        fontWeight={800}
        fontSize={eyebrowSize}
        letterSpacing={eyebrowSize * 0.12}
      >
        {spec.eyebrow.toUpperCase()}
      </text>,
    );
    cy += eyebrowSize * 1.2;
  }
  head.lines.forEach((line, i) => {
    cy += head.size * (i === 0 ? 0.92 : 1.06);
    text.push(
      <Line
        key={`h${i}`}
        text={line}
        gradId={`${uid}-brand`}
        x={tx}
        y={cy}
        textAnchor={anchor}
        fill={pal.text}
        fontFamily={FONT}
        fontWeight={800}
        fontSize={head.size}
        letterSpacing={-head.size * 0.025}
      />,
    );
  });
  if (sub.length) cy += subSize * 0.5;
  sub.forEach((line, i) => {
    cy += subSize * 1.3;
    text.push(
      <text
        key={`s${i}`}
        x={tx}
        y={cy}
        textAnchor={anchor}
        fill={pal.sub}
        fontFamily={FONT}
        fontWeight={500}
        fontSize={subSize}
      >
        {line}
      </text>,
    );
  });
  cy += ctaSize * 1.3;
  text.push(
    <Cta
      key="cta"
      x={tx}
      y={cy}
      size={ctaSize}
      text={ctaText}
      uid={uid}
      anchor={center ? "middle" : "start"}
    />,
  );
  cy += ctaSize * 2.4;

  // Visual area.
  const vis: Box = wide
    ? { x: w * 0.53, y: pad * 0.6, w: w * 0.47 - pad * 0.4, h: h - pad * 0.6 }
    : { x: pad, y: cy + (tall ? 80 : 44) * u, w: w - pad * 2, h: h - cy - (tall ? 80 : 44) * u };

  return (
    <svg
      id={id}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      role="img"
      aria-label={spec.headline.replace(/\*/g, "")}
    >
      <defs>
        <BrandGradient id={`${uid}-brand`} />
      </defs>
      <Backdrop theme={theme} w={w} h={h} uid={uid} />
      {statement && (
        <g opacity={theme === "light" ? 0.08 : 0.1}>
          <YoMark
            x={w - 560 * u}
            y={h - 360 * u}
            width={760 * u}
            uid={`${uid}-wm`}
            color={pal.text}
          />
        </g>
      )}
      {!statement && (
        <Visual
          layout={layout}
          spec={spec}
          box={vis}
          wide={wide}
          landscape={landscape}
          tall={tall}
          u={u}
          uid={uid}
          pal={pal}
          canvas={{ w, h }}
        />
      )}
      <Lockup x={pad} y={pad * 0.9} h={lockH} uid={uid} text={pal.text} />
      {text}
    </svg>
  );
}

function Visual({
  layout,
  spec,
  box,
  wide,
  landscape,
  tall,
  u,
  uid,
  pal,
  canvas,
}: {
  layout: GraphicLayout;
  spec: GraphicSpec;
  box: Box;
  wide: boolean;
  landscape: boolean;
  tall: boolean;
  u: number;
  uid: string;
  pal: Palette;
  canvas: { w: number; h: number };
}) {
  // A single phone: as wide as fits, allowed to run off the bottom edge.
  const onePhone = (screen: ReactNode, rotate = 0) => {
    const pw = landscape
      ? Math.min(box.w * 0.62, (canvas.h * 1.05) / PHONE_RATIO)
      : wide
        ? box.w * 0.82
        : Math.min(box.w * (tall ? 0.7 : 0.5), 640 * u);
    const px = wide
      ? box.x + (box.w - pw) / 2
      : canvas.w / 2 - pw / 2 + (tall ? 0 : canvas.w * 0.14);
    const py = landscape ? canvas.h * 0.1 : wide ? canvas.h * 0.16 : box.y;
    return (
      <Phone x={px} y={py} w={pw} uid={`${uid}-ph`} rotate={rotate}>
        {screen}
      </Phone>
    );
  };

  switch (layout) {
    case "profile":
      return onePhone(<ProfileScreen spec={spec} uid={`${uid}-ps`} />, wide ? 0 : 4);
    case "wishlist":
      return onePhone(<WishlistScreen spec={spec} uid={`${uid}-ws`} />, wide ? 0 : -4);
    case "hero":
    case "themes": {
      const looks = (
        spec.looks?.length
          ? spec.looks
          : layout === "hero"
            ? ["snowfall", "midnight", "sunset"]
            : ["snowfall", "neon", "candy"]
      ).slice(0, 3);
      const n = looks.length;
      // Tall canvases fan the phones out big; there's no room to label them side by side.
      const fan = layout === "hero" || tall;
      if (tall && n === 3) {
        const pw = box.w * 0.5;
        const gap = pw * 0.5;
        const x0 = box.x + (box.w - (gap * 2 + pw)) / 2;
        const y0 = box.y + 40 * u;
        return (
          <g>
            {[0, 2, 1].map((i) => {
              const front = i === 1;
              const w2 = front ? pw : pw * 0.88;
              return (
                <Phone
                  key={i}
                  x={x0 + i * gap + (pw - w2) / 2}
                  y={y0 + (front ? 0 : pw * 0.16)}
                  w={w2}
                  uid={`${uid}-t${i}`}
                  rotate={(i - 1) * 8}
                >
                  <ProfileScreen spec={spec} look={looks[i]} uid={`${uid}-tp${i}`} />
                </Phone>
              );
            })}
          </g>
        );
      }
      const pw = wide
        ? Math.min(
            box.w / (fan ? (n - 1) * 0.72 + 1 : (n - 1) * 1.06 + 1),
            (canvas.h * 0.86) / PHONE_RATIO,
          )
        : Math.min((box.w / n) * (fan ? 1.18 : 0.96), (tall ? 470 : 380) * u);
      const gap = fan ? pw * 0.72 : pw * 1.06;
      const total = gap * (n - 1) + pw;
      const x0 = box.x + (box.w - total) / 2;
      const y0 = wide ? canvas.h * (fan ? 0.12 : 0.2) : box.y + (fan ? 30 * u : 70 * u);
      const order = fan && n === 3 ? [0, 2, 1] : looks.map((_, i) => i);
      return (
        <g>
          {order.map((i) => {
            const front = fan && i === 1;
            const scale = fan && !front ? 0.9 : 1;
            const w2 = pw * scale;
            const label = themeOf(looks[i]).label;
            return (
              <g key={i}>
                <Phone
                  x={x0 + i * gap + (pw - w2) / 2}
                  y={y0 + (front ? 0 : pw * 0.12)}
                  w={w2}
                  uid={`${uid}-t${i}`}
                  rotate={fan ? (i - 1) * 7 : 0}
                >
                  <ProfileScreen spec={spec} look={looks[i]} uid={`${uid}-tp${i}`} />
                </Phone>
                {!fan && (
                  <g>
                    <rect
                      x={x0 + i * gap + pw / 2 - 90 * u}
                      y={y0 - 64 * u}
                      width={180 * u}
                      height={46 * u}
                      rx={23 * u}
                      fill={pal.chip}
                    />
                    <text
                      x={x0 + i * gap + pw / 2}
                      y={y0 - 33 * u}
                      textAnchor="middle"
                      fill={pal.chipText}
                      fontFamily={FONT}
                      fontWeight={700}
                      fontSize={24 * u}
                    >
                      {label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      );
    }
    case "analytics": {
      const pw = wide ? box.w * 0.98 : Math.min(box.w, 900 * u);
      const px = wide ? box.x : canvas.w / 2 - pw / 2;
      const py = wide ? (canvas.h - (pw * 560) / 600) / 2 : box.y + 10 * u;
      return <AnalyticsPanel x={px} y={py} w={pw} uid={`${uid}-an`} pal={pal} />;
    }
    case "steps": {
      const items = (spec.items ?? []).slice(0, 4);
      const rowH = (wide ? 136 : tall ? 200 : 128) * u;
      const size = (wide ? 40 : tall ? 50 : 38) * u;
      const totalH = items.length * rowH;
      const y0 = wide
        ? (canvas.h - totalH) / 2
        : box.y +
          Math.max(
            0,
            (Math.min(box.h - 60 * u, tall ? box.h : 760 * u) - totalH) / (tall ? 2.4 : 2),
          );
      return (
        <g>
          {items.map((it, i) => {
            const y = y0 + i * rowH;
            const r = rowH * 0.32;
            return (
              <g key={i}>
                <rect
                  x={box.x}
                  y={y + rowH * 0.08}
                  width={box.w}
                  height={rowH * 0.84}
                  rx={rowH * 0.24}
                  fill={pal.chip}
                />
                <circle
                  cx={box.x + rowH * 0.5}
                  cy={y + rowH / 2}
                  r={r}
                  fill={`url(#${uid}-brand)`}
                />
                <text
                  x={box.x + rowH * 0.5}
                  y={y + rowH / 2 + size * 0.36}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontFamily={FONT}
                  fontWeight={800}
                  fontSize={size}
                >
                  {i + 1}
                </text>
                <text
                  x={box.x + rowH * 0.98}
                  y={y + rowH / 2 + size * 0.36}
                  fill={pal.text}
                  fontFamily={FONT}
                  fontWeight={700}
                  fontSize={size}
                >
                  {it.length > Math.floor((box.w - rowH) / (size * 0.56))
                    ? it.slice(0, Math.floor((box.w - rowH) / (size * 0.56)) - 1) + "…"
                    : it}
                </text>
              </g>
            );
          })}
        </g>
      );
    }
    case "compare": {
      const items = (
        spec.items?.length
          ? spec.items
          : ["Link in comments", "Check my other account", "DM me for the menu"]
      ).slice(0, 4);
      const colW = wide ? box.w * 0.5 : box.w * 0.46;
      const size = (wide ? 30 : tall ? 34 : 28) * u;
      const rowH = size * 2.6;
      const y0 = wide ? canvas.h * 0.2 : box.y + 20 * u;
      const pw = wide ? box.w * 0.44 : Math.min(box.w * 0.46, (tall ? 480 : 400) * u);
      return (
        <g>
          <text
            x={box.x}
            y={y0}
            fill={pal.muted}
            fontFamily={FONT}
            fontWeight={800}
            fontSize={size * 0.8}
            letterSpacing={size * 0.1}
          >
            BEFORE
          </text>
          {items.map((it, i) => (
            <g key={i}>
              <rect
                x={box.x}
                y={y0 + size * 0.9 + i * (rowH + 12 * u)}
                width={colW}
                height={rowH}
                rx={rowH / 2}
                fill={pal.chip}
              />
              <text
                x={box.x + rowH * 0.45}
                y={y0 + size * 0.9 + i * (rowH + 12 * u) + rowH / 2 + size * 0.36}
                fill={pal.muted}
                fontFamily={FONT}
                fontWeight={600}
                fontSize={size}
                textDecoration="line-through"
              >
                {it.length > Math.floor((colW - rowH * 0.6) / (size * 0.54))
                  ? it.slice(0, Math.floor((colW - rowH * 0.6) / (size * 0.54)) - 1) + "…"
                  : it}
              </text>
            </g>
          ))}
          <text
            x={box.x + box.w - pw}
            y={y0}
            fill={`url(#${uid}-brand)`}
            fontFamily={FONT}
            fontWeight={800}
            fontSize={size * 0.8}
            letterSpacing={size * 0.1}
          >
            WITH YOOITS.ME
          </text>
          <Phone x={box.x + box.w - pw} y={y0 + size * 0.9} w={pw} uid={`${uid}-cp`}>
            <ProfileScreen spec={spec} uid={`${uid}-cps`} />
          </Phone>
        </g>
      );
    }
    default:
      return null;
  }
}

/** Turn a rendered graphic (by element id) into a PNG download. */
/** SVG markup (with its size set) drawn to a PNG. Browser only. */
export async function svgToPng(xml: string, size: GraphicSize): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Couldn't draw the graphic."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, size.w, size.h);
    const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!png) throw new Error("Couldn't make the PNG.");
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Give rendered markup its pixel size (the on-screen version is width 100%). */
export function sizedSvg(markup: string, size: GraphicSize): string {
  return markup.replace(
    /^<svg([^>]*?) width="100%"/,
    `<svg$1 width="${size.w}" height="${size.h}"`,
  );
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function downloadGraphic(svgId: string, size: GraphicSize, filename: string) {
  const el = document.getElementById(svgId);
  if (!el) throw new Error("Graphic not on screen.");
  const clone = el.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(size.w));
  clone.setAttribute("height", String(size.h));
  const png = await svgToPng(new XMLSerializer().serializeToString(clone), size);
  saveBlob(png, filename.endsWith(".png") ? filename : `${filename}.png`);
}
