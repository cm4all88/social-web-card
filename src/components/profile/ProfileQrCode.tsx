import { QRCodeSVG } from "qrcode.react";

export function ProfileQrCode({ url, size = 176 }: { url: string; size?: number }) {
  return (
    <QRCodeSVG
      value={url}
      title="Scan to open this profile"
      size={size}
      level="H"
      marginSize={4}
      fgColor="#211535"
      className="block h-auto max-w-full rounded-lg"
      imageSettings={{
        src: "/yooits-qr-mark.png",
        width: size * 0.18,
        height: size * 0.124,
        excavate: true,
      }}
    />
  );
}
