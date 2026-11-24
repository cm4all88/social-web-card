import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  QR_DESIGNS,
  SIGNATURE_PALETTE,
  validQrInk,
  type QrDesign,
  type QrPalette,
  type QrShape,
} from "@/lib/links/branded-qr";
import { ProfileQrCode } from "./ProfileQrCode";
import type { ThemeTokens } from "@/lib/themes";

function themeInk(value: string, fallback: string) {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return fallback;
  context.fillStyle = fallback;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const rgb = Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
  for (let step = 10; step >= 0; step--) {
    const hex =
      "#" +
      rgb
        .map((channel) =>
          Math.round((channel * step) / 10)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    if (validQrInk(hex)) return hex;
  }
  return fallback;
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ProfileQrStudio({
  url,
  username,
  theme,
  initialDesign = "signature",
}: {
  url: string;
  username: string;
  theme?: ThemeTokens;
  initialDesign?: QrDesign;
}) {
  const [design, setDesign] = useState<QrDesign>(initialDesign);
  const [shape, setShape] = useState<QrShape>("square");
  const [mode, setMode] = useState("signature");
  const [palette, setPalette] = useState<QrPalette>(SIGNATURE_PALETTE);
  const [dark, setDark] = useState(false);
  const [card, setCard] = useState(false);
  const [showName, setShowName] = useState(true);
  const [showUrl, setShowUrl] = useState(false);
  const [resolution, setResolution] = useState(1200);
  const preview = useRef<HTMLDivElement>(null);
  const valid = Object.values(palette).every(validQrInk);
  const label = "block text-sm font-medium";
  const select = "mt-1 w-full rounded-md border border-border bg-background p-2";
  const qr = <ProfileQrCode url={url} design={design} palette={palette} shape={shape} size={300} />;
  const footer = showUrl ? 70 : 48;
  const exportCode = async (format: "png" | "svg") => {
    const svg = preview.current?.querySelector("svg");
    if (!svg) return;
    const markup = new XMLSerializer().serializeToString(svg);
    const vector = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const filename = `yooits-${username}-${card ? "card" : "qr"}`;
    if (format === "svg") return save(vector, filename + ".svg");
    const imageUrl = URL.createObjectURL(vector);
    try {
      const img = new Image();
      img.src = imageUrl;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = resolution;
      canvas.height = Math.round((resolution * img.naturalHeight) / img.naturalWidth);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      // Use an integer number of pixels per module on code-only PNGs.
      const units = svg.viewBox.baseVal.width;
      const aligned = !card && units > 0 ? Math.floor(resolution / units) * units : resolution;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const inset = Math.floor((resolution - aligned) / 2);
      context.drawImage(img, inset, inset, aligned, card ? canvas.height : aligned);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) throw new Error("PNG unavailable");
      save(png, filename + ".png");
    } catch {
      toast.error("Could not export the PNG. Try downloading the SVG.");
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  };
  return (
    <>
      <DialogTitle>Share your profile</DialogTitle>
      <DialogDescription>Choose a design and download your profile QR code.</DialogDescription>
      <div className="grid min-w-0 gap-5 sm:grid-cols-[1fr_1fr]">
        <div
          ref={preview}
          className={`flex min-w-0 items-center justify-center rounded-xl p-3 ${dark ? "bg-[#211535]" : "bg-[#f3eefb]"}`}
        >
          {card ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-auto max-w-full"
              width="340"
              height={326 + footer}
              viewBox={`0 0 340 ${326 + footer}`}
            >
              <rect width="340" height={326 + footer} rx="18" fill={dark ? "#211535" : "#f3eefb"} />
              <g transform="translate(20 16)">{qr}</g>
              <text
                x="170"
                y="338"
                textAnchor="middle"
                fontFamily="system-ui,sans-serif"
                fontWeight="700"
                fontSize="14"
                fill={dark ? "white" : "#211535"}
              >
                {showName ? `@${username}` : "Yooits.me"}
              </text>
              {showUrl && (
                <text
                  x="170"
                  y="360"
                  textAnchor="middle"
                  fontFamily="system-ui,sans-serif"
                  fontSize="10"
                  fill={dark ? "white" : "#211535"}
                >
                  {url}
                </text>
              )}
            </svg>
          ) : (
            qr
          )}
        </div>
        <div className="grid gap-3">
          <label className={label}>
            Design
            <select
              className={select}
              aria-label="Design"
              value={design}
              onChange={(e) => setDesign(e.target.value as QrDesign)}
            >
              {Object.entries(QR_DESIGNS).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Color
            <select
              className={select}
              aria-label="Color"
              value={mode}
              onChange={(e) => {
                const next = e.target.value;
                setMode(next);
                if (next === "signature") setPalette(SIGNATURE_PALETTE);
                if (next === "theme" && theme)
                  setPalette({
                    start: themeInk(theme.accent, SIGNATURE_PALETTE.start),
                    end: themeInk(theme.cardForeground, SIGNATURE_PALETTE.end),
                    ink: themeInk(theme.foreground, SIGNATURE_PALETTE.ink),
                  });
              }}
            >
              <option value="signature">Yooits.me gradient</option>
              {theme && <option value="theme">Profile theme</option>}
              <option value="custom">Custom colors</option>
            </select>
          </label>
          {mode === "custom" && (
            <div className="flex flex-wrap gap-3">
              {(["start", "end", "ink"] as const).map((key) => (
                <label className="grid gap-1 text-xs" key={key}>
                  {key === "ink" ? "Pattern" : `Gradient ${key}`}
                  <input
                    type="color"
                    value={palette[key]}
                    onChange={(e) => setPalette({ ...palette, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          )}
          {!valid && (
            <p className="text-xs text-muted-foreground" role="status">
              These colors are too light to scan reliably. The preview and downloads use the
              standard QR code.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>
              Modules
              <select
                className={select}
                aria-label="Modules"
                value={shape}
                onChange={(e) => setShape(e.target.value as QrShape)}
              >
                <option value="square">Square</option>
                <option value="rounded">Rounded</option>
                <option value="dot">Dot</option>
              </select>
            </label>
            <label className={label}>
              Appearance
              <select
                className={select}
                aria-label="Appearance"
                value={dark ? "dark" : "light"}
                onChange={(e) => setDark(e.target.value === "dark")}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
          <label className={label}>
            Export
            <select
              className={select}
              aria-label="Export"
              value={card ? "card" : "qr"}
              onChange={(e) => setCard(e.target.value === "card")}
            >
              <option value="qr">QR code only</option>
              <option value="card">Sharing card</option>
            </select>
          </label>
          {card && (
            <div className="flex gap-3 text-sm">
              <label>
                <input
                  type="checkbox"
                  checked={showName}
                  onChange={(e) => setShowName(e.target.checked)}
                />{" "}
                Username
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showUrl}
                  onChange={(e) => setShowUrl(e.target.checked)}
                />{" "}
                Profile URL
              </label>
            </div>
          )}
          <label className={label}>
            PNG resolution
            <select
              className={select}
              aria-label="PNG resolution"
              value={resolution}
              onChange={(e) => setResolution(Number(e.target.value))}
            >
              <option value="1200">1,200 px</option>
              <option value="2400">2,400 px (print)</option>
            </select>
          </label>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast.success("Profile link copied");
            } catch {
              toast.error("Could not copy the profile link.");
            }
          }}
        >
          Copy profile link
        </Button>
        <Button variant="outline" onClick={() => void exportCode("svg")}>
          Download SVG
        </Button>
        <Button onClick={() => void exportCode("png")}>Download PNG</Button>
        {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
          <Button
            variant="outline"
            onClick={() =>
              void navigator.share({ title: `@${username} on Yooits.me`, url }).catch((error) => {
                if (error?.name !== "AbortError") toast.error("Could not open device sharing.");
              })
            }
          >
            Share profile
          </Button>
        )}
      </div>
    </>
  );
}
