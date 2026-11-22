/**
 * The canvas engine behind skins. One small particle system, four effects.
 *
 * Motion: every particle has a depth (far ones are small, faint and slow,
 * near ones big and quick), its own sway, and they all share a wind that
 * rises and falls in gusts. On a page, layers shift with scroll and with
 * device tilt (parallax by depth).
 *
 * Cost: sprites are drawn once and stamped with drawImage; the particle
 * count scales with the screen and drops if frames run slow; the pixel ratio
 * is capped; the loop stops while the tab is hidden or the layer is off
 * screen. With reduced motion it draws one still frame and never animates.
 */
import type { EffectKind } from "@/lib/skins";

export type Particle = {
  x: number;
  y: number;
  /** 0 (far) to 1 (near). */
  depth: number;
  size: number;
  speed: number;
  sway: number;
  freq: number;
  phase: number;
  rot: number;
  spin: number;
  sprite: number;
  alpha: number;
};

export type Rand = () => number;

type Spec = {
  /** Particles per 100,000 CSS px². */
  density: number;
  min: number;
  max: number;
  /** Particles at or above this depth are drawn on the front canvas. */
  frontDepth: number;
  /** How strongly the wind pushes (px/s at full depth). */
  windPush: number;
  sprites: (scale: number) => HTMLCanvasElement[];
  init: (p: Particle, w: number, h: number, rand: Rand, scatter: boolean) => void;
  step: (p: Particle, dt: number, wind: number, w: number, h: number, rand: Rand) => void;
  alpha?: (p: Particle, t: number, h: number) => number;
  /** Size of the stamped sprite relative to p.size. */
  drawScale?: (p: Particle) => number;
  /** Rotation and tumble (leaves): x scale. */
  tumble?: (p: Particle) => number;
};

const SPRITE = 64;

function sprite(draw: (c: CanvasRenderingContext2D, s: number) => void, scale: number) {
  const c = document.createElement("canvas");
  c.width = c.height = Math.round(SPRITE * scale);
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  draw(ctx, SPRITE);
  return c;
}

function softDot(color: string) {
  return (c: CanvasRenderingContext2D, s: number) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color.replace(/[\d.]+\)$/, "0.75)"));
    g.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  };
}

function crystal(c: CanvasRenderingContext2D, s: number) {
  c.translate(s / 2, s / 2);
  c.strokeStyle = "rgba(255,255,255,0.95)";
  c.lineCap = "round";
  c.shadowColor = "rgba(224,242,254,0.9)";
  c.shadowBlur = 4;
  const r = s * 0.42;
  for (let i = 0; i < 6; i++) {
    c.save();
    c.rotate((i * Math.PI) / 3);
    c.lineWidth = s * 0.045;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, -r);
    for (const at of [0.45, 0.7]) {
      const b = r * (at === 0.45 ? 0.28 : 0.2);
      c.moveTo(0, -r * at);
      c.lineTo(-b, -r * at - b);
      c.moveTo(0, -r * at);
      c.lineTo(b, -r * at - b);
    }
    c.stroke();
    c.restore();
  }
}

function leaf(color: string, vein: string) {
  return (c: CanvasRenderingContext2D, s: number) => {
    c.translate(s / 2, s / 2);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, -s * 0.44);
    c.bezierCurveTo(s * 0.34, -s * 0.3, s * 0.36, s * 0.18, 0, s * 0.4);
    c.bezierCurveTo(-s * 0.36, s * 0.18, -s * 0.34, -s * 0.3, 0, -s * 0.44);
    c.fill();
    c.strokeStyle = vein;
    c.lineWidth = s * 0.03;
    c.beginPath();
    c.moveTo(0, -s * 0.4);
    c.lineTo(0, s * 0.46);
    for (const y of [-0.18, 0, 0.18]) {
      c.moveTo(0, s * y);
      c.lineTo(s * 0.18, s * (y - 0.12));
      c.moveTo(0, s * y);
      c.lineTo(-s * 0.18, s * (y - 0.12));
    }
    c.stroke();
  };
}

function heart(color: string) {
  return (c: CanvasRenderingContext2D, s: number) => {
    c.translate(s / 2, s / 2 + s * 0.04);
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = s * 0.12;
    const k = s * 0.36;
    c.beginPath();
    c.moveTo(0, k * 0.9);
    c.bezierCurveTo(-k * 1.4, -k * 0.1, -k * 0.7, -k * 1.2, 0, -k * 0.45);
    c.bezierCurveTo(k * 0.7, -k * 1.2, k * 1.4, -k * 0.1, 0, k * 0.9);
    c.fill();
  };
}

function sparkle(c: CanvasRenderingContext2D, s: number) {
  softDot("rgba(255,255,240,0.9)")(c, s);
  c.translate(s / 2, s / 2);
  c.fillStyle = "rgba(255,255,255,0.95)";
  for (const rot of [0, Math.PI / 2]) {
    c.save();
    c.rotate(rot);
    c.beginPath();
    c.moveTo(0, -s * 0.48);
    c.quadraticCurveTo(s * 0.05, 0, 0, s * 0.48);
    c.quadraticCurveTo(-s * 0.05, 0, 0, -s * 0.48);
    c.fill();
    c.restore();
  }
}

/** Far particles are more common than near ones, like real depth. */
const pickDepth = (rand: Rand, lo = 0.15) => lo + (1 - lo) * Math.pow(rand(), 1.7);

export const EFFECTS: Record<EffectKind, Spec> = {
  snow: {
    density: 22,
    min: 30,
    max: 170,
    frontDepth: 0.9,
    windPush: 38,
    sprites: (k) => [sprite(softDot("rgba(255,255,255,0.95)"), k), sprite(crystal, k)],
    init(p, w, h, rand, scatter) {
      p.depth = pickDepth(rand);
      p.size = 1.1 + p.depth * 4.6;
      p.speed = 16 + p.depth * 64 + rand() * 10;
      p.sway = 6 + p.depth * 22;
      p.freq = 0.35 + rand() * 0.8;
      p.phase = rand() * Math.PI * 2;
      p.rot = rand() * Math.PI;
      p.spin = (rand() - 0.5) * 0.8;
      p.sprite = p.depth > 0.78 && rand() < 0.55 ? 1 : 0;
      p.alpha = 0.3 + p.depth * 0.65;
      p.x = rand() * w;
      p.y = scatter ? rand() * h : -10 - rand() * 40;
    },
    step(p, dt, wind, w, h, rand) {
      p.phase += dt * p.freq;
      p.rot += dt * p.spin;
      p.y += p.speed * dt;
      p.x += (wind * (0.35 + p.depth) + Math.cos(p.phase) * p.sway) * dt;
      if (p.y > h + 12) this.init(p, w, h, rand, false);
    },
    drawScale: (p) => (p.sprite === 1 ? 3.4 : 2.4),
  },
  leaves: {
    density: 3.2,
    min: 10,
    max: 42,
    frontDepth: 0.88,
    windPush: 55,
    sprites: (k) => [
      sprite(leaf("#c2410c", "rgba(255,237,213,0.55)"), k),
      sprite(leaf("#ea580c", "rgba(255,237,213,0.55)"), k),
      sprite(leaf("#d97706", "rgba(255,247,237,0.55)"), k),
      sprite(leaf("#b91c1c", "rgba(254,226,226,0.5)"), k),
      sprite(leaf("#a16207", "rgba(254,249,195,0.5)"), k),
    ],
    init(p, w, h, rand, scatter) {
      p.depth = pickDepth(rand, 0.3);
      p.size = 7 + p.depth * 13;
      p.speed = 22 + p.depth * 48 + rand() * 10;
      p.sway = 24 + p.depth * 40;
      p.freq = 0.5 + rand() * 0.9;
      p.phase = rand() * Math.PI * 2;
      p.rot = rand() * Math.PI * 2;
      p.spin = (rand() - 0.5) * 2.4;
      p.sprite = Math.floor(rand() * 5);
      p.alpha = 0.55 + p.depth * 0.45;
      p.x = rand() * w;
      p.y = scatter ? rand() * h : -20 - rand() * 60;
    },
    step(p, dt, wind, w, h, rand) {
      p.phase += dt * p.freq;
      p.rot += dt * (p.spin + wind * 0.004);
      p.y += p.speed * dt * (0.8 + 0.3 * Math.sin(p.phase * 1.7));
      p.x += (wind * (0.4 + p.depth) + Math.sin(p.phase) * p.sway) * dt;
      if (p.y > h + 30) this.init(p, w, h, rand, false);
    },
    drawScale: () => 2,
    tumble: (p) => Math.cos(p.phase * 1.3),
  },
  hearts: {
    density: 2.6,
    min: 8,
    max: 32,
    frontDepth: 2,
    windPush: 14,
    sprites: (k) => [
      sprite(heart("#f43f5e"), k),
      sprite(heart("#fb7185"), k),
      sprite(heart("#ec4899"), k),
      sprite(heart("#fda4af"), k),
    ],
    init(p, w, h, rand, scatter) {
      p.depth = pickDepth(rand, 0.3);
      p.size = 6 + p.depth * 12;
      p.speed = 18 + p.depth * 34 + rand() * 8;
      p.sway = 12 + p.depth * 22;
      p.freq = 0.4 + rand() * 0.6;
      p.phase = rand() * Math.PI * 2;
      p.rot = (rand() - 0.5) * 0.5;
      p.spin = 0;
      p.sprite = Math.floor(rand() * 4);
      p.alpha = 0.45 + p.depth * 0.45;
      p.x = rand() * w;
      p.y = scatter ? rand() * h : h + 20 + rand() * 60;
    },
    step(p, dt, wind, w, h, rand) {
      p.phase += dt * p.freq;
      p.y -= p.speed * dt;
      p.x += (wind * (0.3 + p.depth) + Math.cos(p.phase) * p.sway) * dt;
      p.rot = Math.sin(p.phase) * 0.25;
      if (p.y < -30) this.init(p, w, h, rand, false);
    },
    // Fade in from the bottom and out near the top.
    alpha: (p, _t, h) =>
      p.alpha * Math.max(0, Math.min(1, p.y / (h * 0.22), (h + 20 - p.y) / (h * 0.15))),
    drawScale: () => 2,
  },
  stars: {
    density: 9,
    min: 30,
    max: 120,
    frontDepth: 2,
    windPush: 3,
    sprites: (k) => [sprite(softDot("rgba(255,255,240,0.95)"), k), sprite(sparkle, k)],
    init(p, w, h, rand) {
      p.depth = pickDepth(rand, 0.1);
      p.size = 0.6 + p.depth * 2.4;
      p.speed = 0;
      p.sway = 0;
      p.freq = 0.6 + rand() * 2.2;
      p.phase = rand() * Math.PI * 2;
      p.rot = 0;
      p.spin = 0;
      p.sprite = p.depth > 0.75 ? 1 : 0;
      p.alpha = 0.4 + p.depth * 0.6;
      p.x = rand() * w;
      p.y = rand() * h;
    },
    step(p, dt, wind, w) {
      p.phase += dt * p.freq;
      p.x += wind * p.depth * dt;
      if (p.x > w + 10) p.x = -10;
      if (p.x < -10) p.x = w + 10;
    },
    alpha: (p) => p.alpha * (0.5 + 0.5 * Math.sin(p.phase)),
    drawScale: (p) => (p.sprite === 1 ? 5 : 3),
  },
};

/** How many particles for a layer of this size. */
export function particleCount(kind: EffectKind, w: number, h: number, factor = 1): number {
  const s = EFFECTS[kind];
  const n = Math.round(((s.density * w * h) / 100_000) * factor);
  return Math.max(s.min, Math.min(s.max, n));
}

/**
 * The shared wind: a slow swell with gusts on top, in -1..1 (times windPush).
 * Deterministic in t so every particle feels the same breeze.
 */
export function windAt(t: number): number {
  const swell = 0.45 + 0.35 * Math.sin(t * 0.11) + 0.2 * Math.sin(t * 0.31 + 1.3);
  const gust = Math.max(0, Math.sin(t * 0.23 + 0.7)) ** 6 * 0.9;
  return Math.max(-1, Math.min(1.4, swell + gust - 0.35));
}

export function makeParticles(kind: EffectKind, n: number, w: number, h: number, rand: Rand) {
  const out: Particle[] = [];
  for (let i = 0; i < n; i++) {
    const p = {} as Particle;
    EFFECTS[kind].init(p, w, h, rand, true);
    out.push(p);
  }
  return out;
}

/** Advances every particle by dt seconds (capped so a stalled tab doesn't jump). */
export function stepParticles(
  kind: EffectKind,
  ps: Particle[],
  dt: number,
  t: number,
  w: number,
  h: number,
  rand: Rand,
) {
  const s = EFFECTS[kind];
  const d = Math.min(dt, 0.05);
  const wind = windAt(t) * s.windPush;
  for (const p of ps) s.step.call(s, p, d, wind, w, h, rand);
}

export type EffectHandle = { stop: () => void };

/**
 * Runs an effect on a back canvas (behind the content) and an optional front
 * canvas (a few near particles over it). Both should have pointer-events:
 * none. parallax = follow scroll and tilt (page layers only).
 */
export function startEffect(opts: {
  kind: EffectKind;
  back: HTMLCanvasElement;
  front?: HTMLCanvasElement | null;
  reducedMotion: boolean;
  parallax: boolean;
  /** Scales the particle count (previews use fewer). */
  amount?: number;
}): EffectHandle {
  const { kind, back, front, reducedMotion, parallax } = opts;
  const spec = EFFECTS[kind];
  const rand = Math.random;
  const backCtx = back.getContext("2d");
  const frontCtx = front?.getContext("2d") ?? null;
  if (!backCtx) return { stop() {} };

  let w = 0;
  let h = 0;
  let dpr = 1;
  let sprites: HTMLCanvasElement[] = [];
  let ps: Particle[] = [];
  let factor = opts.amount ?? 1;
  const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
  if (lowPower) factor *= 0.7;

  const size = () => {
    const r = back.getBoundingClientRect();
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2);
    for (const c of [back, front]) {
      if (!c) continue;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    sprites = spec.sprites(Math.max(0.5, Math.min(1, dpr / 2)));
    const n = particleCount(kind, w, h, factor);
    if (ps.length === 0) ps = makeParticles(kind, n, w, h, rand);
    else if (ps.length > n) ps.length = n;
    else ps.push(...makeParticles(kind, n - ps.length, w, h, rand));
  };

  // Parallax: scroll moves near layers more; tilt nudges them sideways.
  let scrollY = 0;
  let tiltX = 0;
  let tiltTarget = 0;
  const onScroll = () => (scrollY = window.scrollY);
  const onTilt = (e: DeviceOrientationEvent) => {
    if (typeof e.gamma === "number") tiltTarget = Math.max(-30, Math.min(30, e.gamma)) / 30;
  };

  const draw = (t: number) => {
    for (const ctx of [backCtx, frontCtx]) {
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
    }
    const margin = 40;
    for (const p of ps) {
      const ctx = p.depth >= spec.frontDepth && frontCtx ? frontCtx : backCtx;
      const a = spec.alpha ? spec.alpha(p, t, h) : p.alpha;
      if (a <= 0.01) continue;
      // Parallax shift by depth, wrapped so the field stays full.
      const px = parallax ? tiltX * 24 * p.depth : 0;
      const py = parallax ? -scrollY * 0.18 * p.depth : 0;
      const x =
        ((((p.x + px + margin) % (w + 2 * margin)) + (w + 2 * margin)) % (w + 2 * margin)) - margin;
      const y =
        parallax && kind !== "hearts"
          ? ((((p.y + py + margin) % (h + 2 * margin)) + (h + 2 * margin)) % (h + 2 * margin)) -
            margin
          : p.y + py;
      const s = p.size * (spec.drawScale?.(p) ?? 2);
      const img = sprites[p.sprite] ?? sprites[0];
      ctx.globalAlpha = Math.min(1, a);
      if (p.rot || spec.tumble) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot);
        if (spec.tumble) ctx.scale(Math.max(0.15, Math.abs(spec.tumble(p))), 1);
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
      }
    }
    if (kind === "stars" && !reducedMotion) shootingStar(backCtx, t, w, h);
    backCtx.globalAlpha = 1;
    if (frontCtx) frontCtx.globalAlpha = 1;
  };

  size();
  if (parallax) scrollY = window.scrollY;

  if (reducedMotion) {
    draw(0);
    const onResize = () => {
      size();
      draw(0);
    };
    window.addEventListener("resize", onResize);
    return { stop: () => window.removeEventListener("resize", onResize) };
  }

  let raf = 0;
  let last = performance.now();
  let t = rand() * 100;
  let slow = 0;
  let running = true;
  let visible = true;

  const frame = (now: number) => {
    raf = 0;
    if (!running || !visible || document.hidden) return;
    const dt = (now - last) / 1000;
    last = now;
    t += Math.min(dt, 0.05);
    // Running slow for a couple of seconds: thin out the particles.
    if (dt > 0.028) slow++;
    else slow = Math.max(0, slow - 1);
    if (slow > 90 && ps.length > spec.min) {
      ps.length = Math.max(spec.min, Math.round(ps.length * 0.75));
      factor *= 0.75;
      slow = 0;
    }
    tiltX += (tiltTarget - tiltX) * Math.min(1, dt * 3);
    stepParticles(kind, ps, dt, t, w, h, rand);
    draw(t);
    raf = requestAnimationFrame(frame);
  };
  const resume = () => {
    if (!raf && running && visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  const onResize = () => size();
  const onVisibility = () => resume();
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  if (parallax) {
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("deviceorientation", onTilt);
  }
  // Pause while the layer is scrolled out of view (previews in a list).
  let io: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver(([e]) => {
      visible = e?.isIntersecting ?? true;
      resume();
    });
    io.observe(back);
  }
  resume();

  return {
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("deviceorientation", onTilt);
      io?.disconnect();
    },
  };
}

/** Every 9 seconds or so, a quick streak across the top of the sky. */
function shootingStar(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
  const period = 9;
  const k = (t % period) / 0.9; // the streak lasts 0.9 s
  if (k > 1) return;
  const n = Math.floor(t / period);
  const seed = Math.sin(n * 12.9898) * 43758.5453;
  const r = seed - Math.floor(seed);
  const x0 = w * (0.15 + r * 0.6);
  const y0 = h * (0.05 + r * 0.25);
  const len = Math.min(w, 600) * 0.35;
  const x = x0 + len * k;
  const y = y0 + len * 0.35 * k;
  const g = ctx.createLinearGradient(x - 90, y - 32, x, y);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(1, `rgba(255,255,255,${0.85 * (1 - k)})`);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = g;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 90, y - 32);
  ctx.lineTo(x, y);
  ctx.stroke();
}
