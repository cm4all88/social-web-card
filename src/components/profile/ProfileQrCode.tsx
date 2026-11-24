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
  maskPattern?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  version?: number;
};

export function ProfileQrCode({
  url,
  size = 176,
  design = "signature",
  palette = SIGNATURE_PALETTE,
  shape = "square",
  maskPattern = 0,
  version,
}: Props) {
  const id = useId();
  const code = useMemo(() => {
    try {
      return createProfileMatrix(url, { version, maskPattern });
    } catch {
      return null;
    }
  }, [url, version, maskPattern]);
  const css = "block h-auto max-w-full";
  const dense = !!code && size / (code.modules.size + 8) < 2.25;
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
  const width = n * (design === "signature" ? 0.91 : 0.83);
  const scale = width / 96;
  const mark = {
    d: YO_MARK,
    transform: `translate(${(n - width) / 2} ${(n - 66 * scale) / 2}) scale(${scale})`,
  };
  const square = (x: number, y: number) => `M${x} ${y}h1v1h-1z`;
  let dataArea = "";
  let structure = "";
  let squares = "";
  let shaped = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const cell = square(x, y);
      if (modules.isReserved(y, x)) {
        if (modules.get(y, x)) structure += cell;
        continue;
      }
      dataArea += cell;
      if (!modules.get(y, x)) continue;
      squares += cell;
      if (shape !== "square") {
        shaped +=
          shape === "dot"
            ? `M${x + 0.08} ${y + 0.5}a.42 .42 0 1 0 .84 0a.42 .42 0 1 0 -.84 0z`
            : `M${x + 0.22} ${y + 0.06}h.56q.16 0 .16 .16v.56q0 .16 -.16 .16h-.56q-.16 0 -.16 -.16v-.56q0 -.16 .16 -.16z`;
      }
    }
  }
  const gradient = `url(#${id}-ink)`;
  const dotPath = shape === "square" ? squares : shaped;
  const edges = shape === "square" ? "crispEdges" : undefined;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Scan to open this profile"
      className={css}
      width={size}
      height={size}
      viewBox={`-4 -4 ${extent} ${extent}`}
      data-qr-design={design}
      data-qr-version={code.version}
      data-qr-mask={code.maskPattern}
    >
      <defs>
        <linearGradient
          id={`${id}-ink`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2={n}
          y2={n * 0.4}
        >
          <stop stopColor={palette.start} />
          <stop offset="1" stopColor={palette.end} />
        </linearGradient>
        <linearGradient
          id={`${id}-wash`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2={n}
          y2={n * 0.4}
        >
          <stop stopColor={palette.start} stopOpacity=".20" />
          <stop offset="1" stopColor={palette.end} stopOpacity=".20" />
        </linearGradient>
        <clipPath id={`${id}-mark`}>
          <path {...mark} />
        </clipPath>
        <clipPath id={`${id}-data`}>
          <path d={dataArea} />
        </clipPath>
        <mask id={`${id}-outline`} maskUnits="userSpaceOnUse" x="0" y="0" width={n} height={n}>
          <path
            {...mark}
            fill="none"
            stroke="white"
            strokeWidth={design === "negative" ? 5 : 7}
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <rect x="-4" y="-4" width={extent} height={extent} fill="#fff" />
      <g clipPath={`url(#${id}-data)`}>
        {design === "outline" && (
          <rect width={n} height={n} fill={`url(#${id}-wash)`} mask={`url(#${id}-outline)`} />
        )}
        {design === "negative" && (
          <>
            <rect width={n} height={n} fill="#e4d9f2" />
            <rect width={n} height={n} fill="white" mask={`url(#${id}-outline)`} />
          </>
        )}
        {design === "signature" && (
          <rect width={n} height={n} fill={`url(#${id}-wash)`} clipPath={`url(#${id}-mark)`} />
        )}
      </g>
      <path d={structure} fill={palette.ink} shapeRendering="crispEdges" />
      <path shapeRendering={edges} d={dotPath} fill={palette.ink} />
      {design === "outline" && (
        <path shapeRendering={edges} d={dotPath} fill={gradient} mask={`url(#${id}-outline)`} />
      )}
      {design === "gradient" && (
        <path shapeRendering={edges} d={dotPath} fill={gradient} clipPath={`url(#${id}-mark)`} />
      )}
      {design === "signature" && (
        <path shapeRendering={edges} d={dotPath} fill={gradient} clipPath={`url(#${id}-mark)`} />
      )}
    </svg>
  );
}
