import { useId, useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  createProfileMatrix,
  SIGNATURE_PALETTE,
  validQrInk,
  type QrDesign,
  type QrPalette,
  type QrShape,
} from "@/lib/links/branded-qr";
import { YO_MARK } from "@/lib/links/yo-mark";

type Props = {
  url: string;
  size?: number;
  design?: QrDesign;
  palette?: QrPalette;
  shape?: QrShape;
};

const square = (x: number, y: number) => `M${x} ${y}h1v1h-1z`;
const circle = (x: number, y: number, r: number) =>
  `M${x + 0.5 - r} ${y + 0.5}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0z`;

function styleModule(x: number, y: number, shape: QrShape) {
  if (shape === "dot") return circle(x, y, 0.42);
  if (shape === "rounded")
    return `M${x + 0.22} ${y + 0.06}h.56q.16 0 .16 .16v.56q0 .16 -.16 .16h-.56q-.16 0 -.16 -.16v-.56q0 -.16 .16 -.16z`;
  return square(x, y);
}

export function ProfileQrCode({
  url,
  size = 176,
  design = "signature",
  palette = SIGNATURE_PALETTE,
  shape = "square",
}: Props) {
  const id = useId();
  const code = useMemo(() => {
    try {
      return createProfileMatrix(url, { maskPattern: 0 });
    } catch {
      return null;
    }
  }, [url]);
  const css = "block h-auto max-w-full";
  const dense = !!code && size / (code.modules.size + 8) < 3;
  if (design === "standard" || !code || dense || !Object.values(palette).every(validQrInk)) {
    return (
      <QRCodeSVG
        value={url}
        size={size}
        level={dense ? "M" : "H"}
        boostLevel={!dense}
        data-qr-design="standard"
        shapeRendering="crispEdges"
        marginSize={4}
        title="Scan to open this profile"
        className={css}
      />
    );
  }

  const modules = code.modules;
  const n = modules.size;
  const extent = n + 8;
  const scale = (n * 0.98) / 96;
  const finderArea = `M0 0h8v8h-8zM${n - 8} 0h8v8h-8zM0 ${n - 8}h8v8h-8z`;
  let finderInk = "";
  let mutedStructure = "";
  let mutedDots = "";
  let yoInk = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules.get(y, x)) continue;
      const finder = (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
      if (finder) {
        finderInk += square(x, y);
      } else if (modules.isReserved(y, x)) {
        mutedStructure += square(x, y);
        yoInk += square(x, y);
      } else {
        mutedDots += circle(x, y, 0.37);
        yoInk += styleModule(x, y, shape);
      }
    }
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Scan to open this profile"
      className={css}
      width={size}
      height={size}
      viewBox={`-4 -4 ${extent} ${extent}`}
      data-qr-design="signature"
      data-qr-version={code.version}
      data-qr-mask={code.maskPattern}
    >
      <defs>
        <linearGradient id={`${id}-ink`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={n} y2="0">
          <stop stopColor={palette.start} />
          <stop offset="1" stopColor={palette.end} />
        </linearGradient>
        <linearGradient
          id={`${id}-wash`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2={n}
          y2="0"
        >
          <stop stopColor="#e9cafb" />
          <stop offset="1" stopColor="#c1e2ff" />
        </linearGradient>
        <clipPath id={`${id}-mark`}>
          <path
            d={YO_MARK}
            transform={`translate(${n * 0.01} ${(n - 66 * scale) / 2 + 1}) scale(${scale})`}
          />
        </clipPath>
      </defs>
      <rect x="-4" y="-4" width={extent} height={extent} fill="#fff" />
      <path d={mutedStructure} fill="#8c819f" />
      <path d={mutedDots} fill="#8c819f" />
      <g clipPath={`url(#${id}-mark)`}>
        <rect width={n} height={n} fill={`url(#${id}-wash)`} />
        <path d={yoInk} fill={`url(#${id}-ink)`} />
      </g>
      <path d={finderArea} fill="#fff" />
      <path d={finderInk} fill={palette.ink} />
    </svg>
  );
}
