/**
 * What each social network takes, how a post goes out today (by hand, from
 * the Marketing Center), and what an API connection would need. The API notes
 * come from each platform's own developer docs, checked Nov 22, 2026
 * (/mnt/project-files/yooits/marketing/PLATFORM_API_RULES.md).
 */
export type PlatformId = "instagram" | "tiktok" | "x" | "facebook" | "youtube" | "snapchat";
export type PostFormat = "post" | "carousel" | "reel" | "story" | "short" | "video" | "thread";

export type GraphicSize = { w: number; h: number; label: string };

export type PlatformSpec = {
  id: PlatformId;
  label: string;
  formats: PostFormat[];
  /** Hard caption limit on the platform. */
  captionMax: number;
  /** Where the caption gets cut off behind "more". Keep the hook above it. */
  foldAt: number;
  hashtagsMax: number;
  /** Links in captions are clickable on this platform. */
  linksClickable: boolean;
  /** Graphic size per format (first entry is the default). */
  sizes: Partial<Record<PostFormat, GraphicSize>> & { default: GraphicSize };
  /** Where the owner opens the app to post by hand. */
  composeUrl: string;
  /** Public oEmbed check of a live post's address, when the platform has one without a token. */
  oembed: ((url: string) => string) | null;
  manualSteps: string[];
  api: {
    status: "possible" | "restricted" | "manual_only";
    summary: string;
    needs: string[];
    cost: string;
  };
};

const SQUARE: GraphicSize = { w: 1080, h: 1080, label: "Square 1080×1080" };
const PORTRAIT: GraphicSize = { w: 1080, h: 1350, label: "Portrait 1080×1350" };
const VERTICAL: GraphicSize = { w: 1080, h: 1920, label: "Vertical 1080×1920" };
const WIDE: GraphicSize = { w: 1200, h: 675, label: "Wide 1200×675" };
const LINK: GraphicSize = { w: 1200, h: 630, label: "Link card 1200×630" };

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  instagram: {
    id: "instagram",
    label: "Instagram",
    formats: ["post", "carousel", "reel", "story"],
    captionMax: 2200,
    foldAt: 125,
    hashtagsMax: 5,
    linksClickable: false,
    sizes: {
      default: PORTRAIT,
      post: PORTRAIT,
      carousel: PORTRAIT,
      reel: VERTICAL,
      story: VERTICAL,
    },
    composeUrl: "https://www.instagram.com/",
    oembed: null,
    manualSteps: [
      "Download the graphic (or record the video from the script).",
      "Open Instagram, tap +, pick the graphic and paste the caption.",
      "Put the campaign link in your bio or a link sticker; caption links aren't clickable.",
      "Share it, open the post, tap ⋯ > Copy link, and paste that link here.",
    ],
    api: {
      status: "possible",
      summary:
        "Instagram's API can publish photos, carousels and Reels to a professional account. An app used only for your own account needs no app review.",
      needs: [
        "Switch @yooits to a professional (creator or business) account",
        "Create a Meta developer app with Instagram Login and give yourself a role on it",
        "Add the app's ID and secret to Vercel as INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET",
      ],
      cost: "No fee listed by Meta.",
    },
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    formats: ["video"],
    captionMax: 2200,
    foldAt: 100,
    hashtagsMax: 5,
    linksClickable: false,
    sizes: { default: VERTICAL, video: VERTICAL },
    composeUrl: "https://www.tiktok.com/upload",
    oembed: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
    manualSteps: [
      "Film the video from the script (the graphic works as the cover or first frame).",
      "Open TikTok, tap +, add the video and paste the caption.",
      "Your bio link is where people tap through; captions don't link.",
      "Post it, tap Share > Copy link, and paste that link here. Yooits.me checks it with TikTok.",
    ],
    api: {
      status: "restricted",
      summary:
        "TikTok's Content Posting API only posts privately (only you can see it) until TikTok audits the app, and its review rules say apps must not be for private use, so an owner-only tool may not pass.",
      needs: [
        "A TikTok developer app with the Content Posting API",
        "TikTok's audit before posts can be public",
      ],
      cost: "No fee listed by TikTok.",
    },
  },
  x: {
    id: "x",
    label: "X",
    formats: ["post", "thread"],
    captionMax: 280,
    foldAt: 280,
    hashtagsMax: 2,
    linksClickable: true,
    sizes: { default: WIDE, post: WIDE, thread: WIDE },
    composeUrl: "https://x.com/compose/post",
    oembed: (u) =>
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(u)}&omit_script=true`,
    manualSteps: [
      "Download the graphic if the post has one.",
      "Open X, start a post, paste the text (the campaign link is already in it).",
      "Post it, tap Share > Copy link, and paste that link here. Yooits.me checks it with X.",
    ],
    api: {
      status: "possible",
      summary:
        "X's API can post for you, but it's paid per use: about $0.015 a post, and $0.20 for any post with a link, which is every campaign post.",
      needs: [
        "An X developer account with a payment card for API credits",
        "An app with OAuth 2.0, and its client ID and secret in Vercel as X_CLIENT_ID and X_CLIENT_SECRET",
      ],
      cost: "$0.20 per post with a link (X's pay-per-use pricing since Apr 20, 2026).",
    },
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    formats: ["post", "reel", "story"],
    captionMax: 63206,
    foldAt: 140,
    hashtagsMax: 3,
    linksClickable: true,
    sizes: { default: LINK, post: SQUARE, reel: VERTICAL, story: VERTICAL },
    composeUrl: "https://www.facebook.com/",
    oembed: null,
    manualSteps: [
      "Download the graphic.",
      "Open your Yooits.me Facebook Page, create a post, add the graphic and paste the text.",
      "Post it, open the post, copy its link from the time stamp or Share > Copy link, and paste it here.",
    ],
    api: {
      status: "possible",
      summary:
        "Facebook's API can post to a Page you manage, with scheduling up to 30 days ahead. An app used only for your own Page needs no app review.",
      needs: [
        "A Facebook Page for Yooits.me where you can create content",
        "The same Meta developer app as Instagram, with Page permissions",
      ],
      cost: "No fee listed by Meta.",
    },
  },
  youtube: {
    id: "youtube",
    label: "YouTube Shorts",
    formats: ["short"],
    captionMax: 5000,
    foldAt: 100,
    hashtagsMax: 3,
    linksClickable: false,
    sizes: { default: VERTICAL, short: VERTICAL },
    composeUrl: "https://studio.youtube.com/",
    oembed: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
    manualSteps: [
      "Film the vertical video from the script (under 3 minutes makes it a Short).",
      "Upload it in YouTube Studio or the app; use the title line as the title and paste the rest as the description.",
      "Set it to Public, then copy the Short's link and paste it here. Yooits.me checks it with YouTube.",
    ],
    api: {
      status: "possible",
      summary:
        "YouTube's API can upload Shorts (100 uploads a day). Until Google verifies the app, the sign-in has to be renewed every 7 days.",
      needs: [
        "A Google Cloud project with the YouTube Data API on",
        "An OAuth client for yooits.me (the one Owner Mail uses can be reused) with the youtube.upload scope",
      ],
      cost: "Free (quota based).",
    },
  },
  snapchat: {
    id: "snapchat",
    label: "Snapchat",
    formats: ["story", "video"],
    captionMax: 250,
    foldAt: 80,
    hashtagsMax: 3,
    linksClickable: true,
    sizes: { default: VERTICAL, story: VERTICAL, video: VERTICAL },
    composeUrl: "https://www.snapchat.com/",
    oembed: null,
    manualSteps: [
      "Film the video from the script, or use the vertical graphic.",
      "Post it to your Public Profile Story or Spotlight in the Snapchat app with the short caption; add the link with the link tool.",
      "Copy the link to the Story or Spotlight and paste it here.",
    ],
    api: {
      status: "manual_only",
      summary:
        "Snapchat's Public Profile API can post Stories and Spotlight, but it's open only to accounts Snap allowlists, so posts go out by hand for now.",
      needs: ["Snap's approval for the Public Profile API (request through a Snap contact)"],
      cost: "Not published by Snap.",
    },
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

export const FORMAT_LABELS: Record<PostFormat, string> = {
  post: "Post",
  carousel: "Carousel",
  reel: "Reel",
  story: "Story",
  short: "Short",
  video: "Video",
  thread: "Thread",
};

export function graphicSize(platform: PlatformId, format: PostFormat): GraphicSize {
  const s = PLATFORMS[platform].sizes;
  return s[format] ?? s.default;
}

/** Is the address a post on this platform? Same rule as marketing_url_matches in the database. */
export function urlMatchesPlatform(platform: PlatformId, url: string): boolean {
  if (/\s/.test(url) || [...url].some((c) => c.charCodeAt(0) < 32)) return false;
  const rules: Record<PlatformId, RegExp> = {
    instagram: /^https:\/\/(www\.)?instagram\.com\//i,
    tiktok: /^https:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//i,
    x: /^https:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i,
    facebook: /^https:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.watch)\//i,
    youtube: /^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\//i,
    snapchat: /^https:\/\/(www\.|story\.)?snapchat\.com\//i,
  };
  return rules[platform].test(url);
}
