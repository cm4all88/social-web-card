import { useEffect, useState } from "react";
import { rpc } from "@/components/marketing/api";
import { LEGAL_DETAILS } from "@/lib/legal/documents";

/**
 * What the site says about itself, set on Owner > Settings
 * (public_site_settings). The defaults are what the site showed before the
 * setting existed, so a failed read changes nothing visible.
 */
export type SocialPlatform = "instagram" | "tiktok" | "x" | "facebook" | "youtube" | "snapchat" | "threads";

export const SOCIAL_PLATFORMS: { id: SocialPlatform; label: string; example: string }[] = [
  { id: "instagram", label: "Instagram", example: "https://instagram.com/yooits" },
  { id: "tiktok", label: "TikTok", example: "https://tiktok.com/@yooits" },
  { id: "x", label: "X", example: "https://x.com/yooits" },
  { id: "facebook", label: "Facebook", example: "https://facebook.com/yooits" },
  { id: "youtube", label: "YouTube", example: "https://youtube.com/@yooits" },
  { id: "snapchat", label: "Snapchat", example: "https://snapchat.com/add/yooits" },
  { id: "threads", label: "Threads", example: "https://threads.net/@yooits" },
];

export type SiteSettings = {
  site_name: string;
  tagline: string;
  support_email: string;
  theme_color: string | null;
  socials: Partial<Record<SocialPlatform, string>>;
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  site_name: LEGAL_DETAILS.brand,
  tagline: "One link. All your socials.",
  support_email: LEGAL_DETAILS.contact,
  theme_color: null,
  socials: {},
};

/** Keeps only https links on a known platform, in the site's order. */
export function socialLinks(s: Pick<SiteSettings, "socials">): { id: SocialPlatform; label: string; url: string }[] {
  return SOCIAL_PLATFORMS.flatMap((p) => {
    const url = s.socials?.[p.id];
    return typeof url === "string" && /^https:\/\/[^\s]+$/.test(url) ? [{ id: p.id, label: p.label, url }] : [];
  });
}

export function asSiteSettings(v: unknown): SiteSettings {
  const o = (v ?? {}) as Partial<SiteSettings>;
  const str = (x: unknown, d: string) => (typeof x === "string" && x.trim() ? x : d);
  const siteName = str(o.site_name, DEFAULT_SITE_SETTINGS.site_name);
  return {
    site_name: /^yooits$/i.test(siteName.trim())
      ? DEFAULT_SITE_SETTINGS.site_name
      : siteName,
    tagline: str(o.tagline, DEFAULT_SITE_SETTINGS.tagline),
    support_email: str(o.support_email, DEFAULT_SITE_SETTINGS.support_email),
    theme_color: typeof o.theme_color === "string" && /^#[0-9a-f]{6}$/i.test(o.theme_color) ? o.theme_color : null,
    socials: o.socials && typeof o.socials === "object" ? o.socials : {},
  };
}

let cached: Promise<SiteSettings> | null = null;
export function loadSiteSettings(force = false): Promise<SiteSettings> {
  if (!cached || force)
    cached = rpc("public_site_settings").then(
      ({ data, error }) => (error ? DEFAULT_SITE_SETTINGS : asSiteSettings(data)),
      () => DEFAULT_SITE_SETTINGS,
    );
  return cached;
}

export function useSiteSettings(): SiteSettings {
  const [s, setS] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  useEffect(() => {
    let live = true;
    loadSiteSettings().then((v) => live && setS(v));
    return () => {
      live = false;
    };
  }, []);
  return s;
}

/** Sets the phone browser's bar colour once the owner picks one. */
export function useThemeColor() {
  const { theme_color } = useSiteSettings();
  useEffect(() => {
    if (!theme_color || typeof document === "undefined") return;
    let m = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!m) {
      m = document.createElement("meta");
      m.name = "theme-color";
      document.head.appendChild(m);
    }
    m.content = theme_color;
  }, [theme_color]);
}
