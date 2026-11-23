import type { PlatformId } from "./platforms";

/** Where campaign links point. */
export const SITE = "https://yooits.me";
/** Captions hold this token; it becomes the post's own campaign link when copied. */
export const LINK_TOKEN = "{link}";

export type LinkParts = {
  platform: PlatformId;
  campaign: string;
  code: string;
  landing?: string | null;
};

/** The campaign link for one post: utm_source = platform, utm_campaign = campaign slug, utm_content = post code. */
export function campaignLink({ platform, campaign, code, landing }: LinkParts): string {
  const path = landing && /^\/[A-Za-z0-9/_-]*$/.test(landing) ? landing : "/";
  const q = new URLSearchParams({
    utm_source: platform,
    utm_medium: "social",
    utm_campaign: campaign,
    utm_content: code,
  });
  return `${SITE}${path}?${q.toString()}`;
}

/** A short, readable version for captions where the platform shows the full text (e.g. X counts every link as 23 characters). */
export function displayLink(url: string): string {
  return url.replace(/^https:\/\//, "");
}

/** Caption with {link} swapped for the post's own link. */
export function fillCaption(caption: string, link: string): string {
  return caption.split(LINK_TOKEN).join(link);
}

/** Slug from a campaign name: lower case, dashes, 2 to 50 characters. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return s.length >= 2 ? s : `campaign-${s || "1"}`;
}

/** Characters a platform counts. X counts any link as 23. */
export function countedLength(platform: PlatformId, text: string): number {
  if (platform !== "x") return [...text].length;
  return [...text.replace(/https?:\/\/\S+/g, "x".repeat(23))].length;
}
