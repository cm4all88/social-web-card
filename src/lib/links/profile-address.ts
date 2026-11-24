import { normalizeLinkValue, safeLinkHref } from "@/lib/safe-url";

const profiles: Record<string, { base: string; handle: RegExp }> = {
  instagram: { base: "https://www.instagram.com/", handle: /^[\w.]{1,30}$/ },
  tiktok: { base: "https://www.tiktok.com/@", handle: /^[\w.]{1,24}$/ },
  snapchat: { base: "https://www.snapchat.com/add/", handle: /^[a-z][a-z0-9._-]{2,14}$/i },
  facebook: { base: "https://www.facebook.com/", handle: /^[a-z0-9.]{5,50}$/i },
  twitter: { base: "https://x.com/", handle: /^\w{1,15}$/ },
  youtube: { base: "https://www.youtube.com/@", handle: /^[\w.-]{3,30}$/ },
  twitch: { base: "https://www.twitch.tv/", handle: /^\w{1,25}$/ },
  linkedin: { base: "https://www.linkedin.com/in/", handle: /^[a-z0-9-]{3,100}$/i },
  pinterest: { base: "https://www.pinterest.com/", handle: /^\w{3,30}$/ },
  telegram: { base: "https://t.me/", handle: /^\w{1,32}$/ },
  patreon: { base: "https://www.patreon.com/", handle: /^[\w-]{1,50}$/ },
  buymeacoffee: { base: "https://buymeacoffee.com/", handle: /^\w{1,30}$/ },
  soundcloud: { base: "https://soundcloud.com/", handle: /^[\w-]{1,100}$/ },
  github: { base: "https://github.com/", handle: /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i },
};

export function acceptsProfileUsername(platform: string): boolean {
  return Object.hasOwn(profiles, platform);
}

/** Returns the full profile address only when the input is a recognizable username. */
export function expandProfileUsername(platform: string, value: string): string | undefined {
  if (!acceptsProfileUsername(platform)) return undefined;
  const input = value.trim();
  if (safeLinkHref(input)) return undefined;
  const config = profiles[platform];
  const handle = input.replace(/^@/, "");
  if (handle.endsWith(".") || !config.handle.test(handle)) return undefined;
  return config.base + handle;
}

export function normalizeProfileAddress(platform: string, value: string): string | null {
  const expanded = expandProfileUsername(platform, value);
  if (expanded) return expanded;
  const normalized = normalizeLinkValue(value);
  if (!normalized || !acceptsProfileUsername(platform)) return normalized;
  const href = safeLinkHref(normalized);
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.username || url.password ? null : normalized;
  } catch {
    return null;
  }
}
