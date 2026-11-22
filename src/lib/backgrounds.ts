/**
 * Custom backgrounds: a creator's own photo behind their page. Unlocked by
 * the "popular" reward (public.popular_view_threshold() profile views) or
 * included with Plus; the database checks this (public.background_allowed()).
 *
 * The photo lives in the creator's own folder of the avatars bucket, so it
 * has that bucket's limits and rules.
 */
import { readableTextOn } from "@/lib/contrast";

/** Image types a creator can pick. Anything else is refused before upload. */
export const BACKGROUND_INPUT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];
/** The biggest photo we'll try to shrink (phones take big ones). */
export const BACKGROUND_INPUT_MAX_BYTES = 25 * 1024 * 1024;
/** The bucket's own limit; what we upload must be under it. */
export const BACKGROUND_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** Longest side after shrinking: sharp on phones, light to load. */
export const BACKGROUND_MAX_SIDE = 1920;
/** Shown until the database says otherwise. */
export const DEFAULT_POPULAR_AT = 1000;

/** Width and height that fit inside max on the longest side, never larger than the original. */
export function fitWithin(width: number, height: number, max = BACKGROUND_MAX_SIDE) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** A fresh file name in the creator's own folder of the avatars bucket. */
export function backgroundPath(userId: string, ext: "webp" | "jpg", now = Date.now()) {
  return `${userId}/background-${now}.${ext}`;
}

/**
 * The storage path of a background photo this creator uploaded, from its
 * public address, or null when the address isn't one (so we never delete
 * anything else, like their profile photo).
 */
export function ownBackgroundPath(url: string | null | undefined, userId: string): string | null {
  if (!url) return null;
  const m = url.match(
    /\/storage\/v1\/object\/public\/avatars\/([0-9a-f-]{36})\/(background-[0-9]+\.(?:webp|jpg))$/,
  );
  return m && m[1] === userId ? `${m[1]}/${m[2]}` : null;
}

/**
 * A layer over the photo that keeps the page's text readable: dark under
 * light text, light under dark text, a little stronger at the top and bottom.
 */
export function backgroundScrim(foreground: string): string {
  const lightText = readableTextOn(foreground) !== "#ffffff";
  const c = lightText ? "0,0,0" : "255,255,255";
  const [a, b] = lightText ? [0.62, 0.48] : [0.72, 0.58];
  return `linear-gradient(180deg, rgba(${c},${a}) 0%, rgba(${c},${b}) 35%, rgba(${c},${b}) 65%, rgba(${c},${a}) 100%)`;
}

const n = (v: number) => v.toLocaleString("en-US");

/** One plain line on how to unlock it, with a count. */
export function popularHint(views: number, at = DEFAULT_POPULAR_AT): string {
  return `Get ${n(at)} views on your page to unlock it (${n(Math.min(views, at))} of ${n(at)} so far). Included with Plus.`;
}

/** The address to draw, or null unless it's a photo in the avatars bucket (as the database requires). */
export function safeBackgroundUrl(url: string | null | undefined): string | null {
  return url &&
    /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/avatars\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(
      url,
    )
    ? url
    : null;
}

/**
 * The storage path (in the avatars bucket) of any photo in this creator's
 * own folder, from its public address. Used to delete a removed background.
 */
export function storagePathInOwnFolder(
  url: string | null | undefined,
  userId: string,
): string | null {
  const m = safeBackgroundUrl(url)?.match(
    /\/object\/public\/avatars\/([0-9a-f-]{36})\/([A-Za-z0-9._-]+)$/,
  );
  if (!m || m[1] !== userId || m[2] === "." || m[2] === "..") return null;
  return `${m[1]}/${m[2]}`;
}
