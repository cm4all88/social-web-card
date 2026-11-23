/**
 * Post graphics, drawn as SVG at each platform's size and downloadable as
 * PNG. Text only (no outside images), so the download works offline and
 * nothing third-party is pulled in.
 */
import type { GraphicSize } from "./platforms";
import type { GraphicSpec, GraphicTheme } from "./types";

const THEMES: Record<
  GraphicTheme,
  {
    bg1: string;
    bg2: string;
    text: string;
    sub: string;
    accent: string;
    card: string;
    cardText: string;
  }
> = {
  night: {
    bg1: "#2a1f4a",
    bg2: "#6b1f6e",
    text: "#ffffff",
    sub: "#e6d9ff",
    accent: "#ff5fd2",
    card: "rgba(255,255,255,0.12)",
    cardText: "#ffffff",
  },
  snow: {
    bg1: "#1d3557",
    bg2: "#5a7bb5",
    text: "#ffffff",
    sub: "#dbe8ff",
    accent: "#bfe3ff",
    card: "rgba(255,255,255,0.16)",
    cardText: "#ffffff",
  },
  warm: {
    bg1: "#3b1f2b",
    bg2: "#c2513b",
    text: "#fff8f0",
    sub: "#ffe2c9",
    accent: "#ffb347",
    card: "rgba(255,255,255,0.14)",
    cardText: "#fff8f0",
  },
};

const FONT = "'Inter', 'Helvetica Neue', Arial, sans-serif";

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

function snowDots(w: number, h: number) {
  const dots = [];
  for (let i = 0; i < 40; i++) {
    const x = (i * 9973) % w;
    const y = (i * 7919) % h;
    const r = 2 + (i % 4);
    dots.push(
      <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" opacity={0.25 + (i % 3) * 0.15} />,
    );
  }
  return dots;
}

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
  const t = THEMES[spec.theme] ?? THEMES.night;
  const unit = Math.min(w, h) / 1080;
  const pad = 80 * unit;
  const tall = h / w > 1.5;
  const wide = w / h > 1.4;
  const headSize = (wide ? 64 : 84) * unit;
  const headChars = Math.max(12, Math.floor((w - pad * 2) / (headSize * 0.55)));
  const head = wrap(spec.headline, headChars, wide ? 2 : 3);
  const subSize = (wide ? 32 : 40) * unit;
  const sub = spec.sub ? wrap(spec.sub, Math.floor((w - pad * 2) / (subSize * 0.52)), 2) : [];
  const top = tall ? h * 0.2 : wide ? pad * 1.1 : h * 0.14;
  const headEnd = top + head.length * headSize * 1.12;
  const subEnd = headEnd + (sub.length ? subSize * 0.6 + sub.length * subSize * 1.3 : 0);
  const items = (spec.items ?? []).slice(0, wide ? 3 : 5);
  const rowH = (wide ? 62 : tall ? 110 : 92) * unit;
  const listTop = subEnd + 50 * unit;
  const itemSize = (wide ? 28 : 36) * unit;

  return (
    <svg
      id={id}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      role="img"
      aria-label={spec.headline}
    >
      <defs>
        <linearGradient id={`g-${id ?? "x"}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.bg1} />
          <stop offset="1" stopColor={t.bg2} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#g-${id ?? "x"})`} />
      {spec.theme === "snow" && snowDots(w, h)}
      <circle cx={w * 0.9} cy={h * 0.08} r={220 * unit} fill={t.accent} opacity={0.18} />
      <circle cx={w * 0.05} cy={h * 0.95} r={260 * unit} fill={t.accent} opacity={0.12} />
      {head.map((line, i) => (
        <text
          key={i}
          x={pad}
          y={top + (i + 1) * headSize * 1.05}
          fill={t.text}
          fontFamily={FONT}
          fontWeight={800}
          fontSize={headSize}
        >
          {line}
        </text>
      ))}
      {sub.map((line, i) => (
        <text
          key={i}
          x={pad}
          y={headEnd + subSize * 0.6 + (i + 1) * subSize * 1.2}
          fill={t.sub}
          fontFamily={FONT}
          fontWeight={500}
          fontSize={subSize}
        >
          {line}
        </text>
      ))}
      {items.map((item, i) => {
        const y = listTop + i * (rowH + 18 * unit);
        const label = item.length > 34 ? item.slice(0, 33) + "…" : item;
        const taken = /·\s*taken$/i.test(label);
        if (spec.template === "steps") {
          return (
            <g key={i}>
              <circle cx={pad + rowH / 2} cy={y + rowH / 2} r={rowH / 2.4} fill={t.accent} />
              <text
                x={pad + rowH / 2}
                y={y + rowH / 2 + itemSize * 0.36}
                textAnchor="middle"
                fill={t.bg1}
                fontFamily={FONT}
                fontWeight={800}
                fontSize={itemSize}
              >
                {i + 1}
              </text>
              <text
                x={pad + rowH * 1.2}
                y={y + rowH / 2 + itemSize * 0.36}
                fill={t.text}
                fontFamily={FONT}
                fontWeight={600}
                fontSize={itemSize}
              >
                {label}
              </text>
            </g>
          );
        }
        const boxW = spec.template === "profile" ? w - pad * 2 : w - pad * 2;
        return (
          <g key={i}>
            <rect
              x={pad}
              y={y}
              width={boxW}
              height={rowH}
              rx={rowH / 2}
              fill={t.card}
              stroke={t.accent}
              strokeOpacity={0.35}
            />
            <text
              x={spec.template === "profile" ? pad + boxW / 2 : pad + 40 * unit}
              y={y + rowH / 2 + itemSize * 0.36}
              textAnchor={spec.template === "profile" ? "middle" : "start"}
              fill={t.cardText}
              fontFamily={FONT}
              fontWeight={600}
              fontSize={itemSize}
              opacity={taken ? 0.6 : 1}
            >
              {spec.template === "list" ? `✓  ${label}` : label}
            </text>
            {spec.template === "wishlist" && (
              <text
                x={pad + boxW - 40 * unit}
                y={y + rowH / 2 + itemSize * 0.3}
                textAnchor="end"
                fill={t.accent}
                fontFamily={FONT}
                fontWeight={700}
                fontSize={itemSize * 0.75}
              >
                {taken ? "Taken" : "I'll buy it"}
              </text>
            )}
          </g>
        );
      })}
      <text
        x={pad}
        y={h - pad * 0.8}
        fill={t.text}
        fontFamily={FONT}
        fontWeight={800}
        fontSize={44 * unit}
      >
        yooits<tspan fill={t.accent}>.me</tspan>
      </text>
    </svg>
  );
}

/** Turn a rendered graphic (by element id) into a PNG download. */
export async function downloadGraphic(svgId: string, size: GraphicSize, filename: string) {
  const el = document.getElementById(svgId);
  if (!el) throw new Error("Graphic not on screen.");
  const clone = el.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(size.w));
  clone.setAttribute("height", String(size.h));
  const xml = new XMLSerializer().serializeToString(clone);
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(png);
    a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
