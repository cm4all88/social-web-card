import { create, type QRCodeOptions } from "qrcode";

export const QR_DESIGNS = {
  signature: "Yo silhouette",
  standard: "Standard QR",
} as const;

export type QrDesign = keyof typeof QR_DESIGNS;
export type QrShape = "square" | "rounded" | "dot";
export type QrPalette = { start: string; end: string; ink: string };
export const SIGNATURE_PALETTE: QrPalette = { start: "#852bc8", end: "#1263b0", ink: "#211535" };

export function validQrInk(color: string) {
  if (!/^#[a-f\d]{6}$/i.test(color)) return false;
  const channels = [1, 3, 5].map((offset) => {
    const s = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 <= 0.125;
}

export function createProfileMatrix(
  url: string,
  options?: Pick<QRCodeOptions, "version" | "maskPattern">,
) {
  return create(url, { ...options, errorCorrectionLevel: "H" });
}
