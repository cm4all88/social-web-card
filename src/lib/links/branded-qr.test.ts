import { describe, expect, it } from "vitest";
import { createProfileMatrix, SIGNATURE_PALETTE, validQrInk } from "./branded-qr";

describe("profile QR matrix", () => {
  it("uses high error correction and keeps the three finder patterns reserved", () => {
    const code = createProfileMatrix("https://yooits.me/juleshope96");
    const n = code.modules.size;
    expect(code.errorCorrectionLevel.bit).toBe(2);
    for (const [top, left] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ]) {
      for (let row = 0; row < 7; row++) {
        for (let column = 0; column < 7; column++) {
          expect(code.modules.isReserved(top + row, left + column)).toBeTruthy();
        }
      }
    }
  });

  it("accepts the gradient and rejects light or invalid custom ink", () => {
    expect(Object.values(SIGNATURE_PALETTE).every(validQrInk)).toBe(true);
    expect(validQrInk("#fffddd")).toBe(false);
    expect(validQrInk("not a color")).toBe(false);
  });
});
