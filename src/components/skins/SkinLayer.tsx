import { useEffect, useRef, useState } from "react";
import type { Skin } from "@/lib/skins";
import { startEffect } from "@/lib/skin-effects";

/** True when the visitor asked their device for reduced motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/**
 * The effect layer for a skin. "page" fills the screen behind the content
 * (with a few near particles in front of it) and follows scroll and tilt;
 * "contained" fills its positioned parent, for previews. It never takes
 * clicks or focus and is hidden from screen readers.
 *
 * The content over a page layer needs `relative z-10`.
 */
export function SkinLayer({
  skin,
  mode = "page",
  amount,
}: {
  skin: Skin | null;
  mode?: "page" | "contained";
  amount?: number;
}) {
  const back = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const kind = skin?.effect;

  useEffect(() => {
    if (!kind || !back.current) return;
    let handle: { stop: () => void } | null = null;
    try {
      handle = startEffect({
        kind,
        back: back.current,
        front: front.current,
        reducedMotion: reduced,
        parallax: mode === "page",
        amount: amount ?? (mode === "contained" ? 0.8 : 1),
      });
    } catch {
      /* an effect is decoration; never break the page */
    }
    return () => handle?.stop();
  }, [kind, reduced, mode, amount]);

  if (!skin) return null;
  const pos = mode === "page" ? "fixed" : "absolute";
  return (
    <>
      {skin.frame.overlay && (
        <div
          aria-hidden="true"
          data-skin-overlay={skin.key}
          className={`pointer-events-none ${pos} inset-0 z-0`}
          style={{ background: skin.frame.overlay }}
        />
      )}
      <canvas
        ref={back}
        aria-hidden="true"
        data-skin={skin.key}
        className={`pointer-events-none ${pos} inset-0 z-0 h-full w-full`}
      />
      <canvas
        ref={front}
        aria-hidden="true"
        data-skin-front={skin.key}
        className={`pointer-events-none ${pos} inset-0 z-20 h-full w-full`}
      />
    </>
  );
}
