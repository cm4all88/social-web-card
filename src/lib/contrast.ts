/** Pick black or white text for a solid CSS color (hex, rgb(), oklch()). */
export function readableTextOn(color: string): string {
  const c = color.trim().toLowerCase();
  let lum: number | null = null;
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((x) => x + x)
            .join("")
        : hex[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const rgb = c.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
  if (rgb) lum = (0.2126 * +rgb[1] + 0.7152 * +rgb[2] + 0.0722 * +rgb[3]) / 255;
  const ok = c.match(/^oklch\(\s*([\d.]+)(%?)/);
  if (ok) lum = ok[2] === "%" ? +ok[1] / 100 : +ok[1];
  if (lum === null) return "#ffffff";
  return lum > 0.6 ? "#0b0b0f" : "#ffffff";
}
