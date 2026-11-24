/**
 * Sharing a Yooits.me page: the address to share, the share buttons each app
 * really supports on the web, and suggested captions. Pure, so it's tested
 * directly.
 *
 * Share links carry ?utm_source=<app>&utm_medium=share, so the visits they
 * bring show up in analytics as coming from a share. The copied link stays
 * clean (no tracking), because people paste it into their bio.
 */

/** How a share happened. Stored as profile_shares.channel. */
export type ShareChannel =
  | "copy"
  | "native"
  | "facebook"
  | "x"
  | "threads"
  | "bluesky"
  | "whatsapp"
  | "telegram"
  | "linkedin"
  | "reddit"
  | "email"
  | "sms"
  | "instagram"
  | "tiktok"
  | "snapchat"
  | "story"
  | "post"
  | "caption";

export const SHARE_CHANNELS: readonly ShareChannel[] = [
  "copy",
  "native",
  "facebook",
  "x",
  "threads",
  "bluesky",
  "whatsapp",
  "telegram",
  "linkedin",
  "reddit",
  "email",
  "sms",
  "instagram",
  "tiktok",
  "snapchat",
  "story",
  "post",
  "caption",
];

export function isShareChannel(v: string): v is ShareChannel {
  return (SHARE_CHANNELS as readonly string[]).includes(v);
}

/** The page's own address, with no tracking. */
export function profileUrl(origin: string, username: string): string {
  return `${origin.replace(/\/+$/, "")}/${encodeURIComponent(username)}`;
}

/** The page's address for one app, marked so its visits count as from a share. */
export function trackedProfileUrl(origin: string, username: string, source: string): string {
  const q = new URLSearchParams({ utm_source: source, utm_medium: "share" });
  return `${profileUrl(origin, username)}?${q.toString()}`;
}

/** "yooits.me/name", for printing on graphics and in captions. */
export function displayUrl(origin: string, username: string): string {
  return profileUrl(origin, username).replace(/^https?:\/\/(www\.)?/, "");
}

/**
 * An app with a web share address. Each opens that app's own compose screen
 * with the link (and text, where the app takes text) filled in. Nothing is
 * posted until the person posts it there.
 */
export type IntentTarget = {
  channel: Extract<
    ShareChannel,
    | "facebook"
    | "x"
    | "threads"
    | "bluesky"
    | "whatsapp"
    | "telegram"
    | "linkedin"
    | "reddit"
    | "email"
    | "sms"
  >;
  label: string;
  /** Only shown on phones (sms: needs a phone's messages app). */
  mobileOnly?: boolean;
};

export const INTENT_TARGETS: IntentTarget[] = [
  { channel: "facebook", label: "Facebook" },
  { channel: "x", label: "X" },
  { channel: "threads", label: "Threads" },
  { channel: "whatsapp", label: "WhatsApp" },
  { channel: "bluesky", label: "Bluesky" },
  { channel: "telegram", label: "Telegram" },
  { channel: "linkedin", label: "LinkedIn" },
  { channel: "reddit", label: "Reddit" },
  { channel: "email", label: "Email" },
  { channel: "sms", label: "Text message", mobileOnly: true },
];

/** The app's share address with this page and text filled in. */
export function intentUrl(
  channel: IntentTarget["channel"],
  origin: string,
  username: string,
  text: string,
): string {
  const url = trackedProfileUrl(origin, username, channel);
  const e = encodeURIComponent;
  switch (channel) {
    case "facebook":
      // Facebook takes only the link; it reads the page's preview itself.
      return `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`;
    case "x":
      return `https://x.com/intent/tweet?text=${e(text)}&url=${e(url)}`;
    case "threads":
      return `https://www.threads.net/intent/post?text=${e(`${text} ${url}`)}`;
    case "bluesky":
      return `https://bsky.app/intent/compose?text=${e(`${text} ${url}`)}`;
    case "whatsapp":
      return `https://wa.me/?text=${e(`${text} ${url}`)}`;
    case "telegram":
      return `https://t.me/share/url?url=${e(url)}&text=${e(text)}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}`;
    case "reddit":
      return `https://www.reddit.com/submit?url=${e(url)}&title=${e(text)}`;
    case "email":
      return `mailto:?subject=${e(text)}&body=${e(`${text}\n\n${url}`)}`;
    case "sms":
      return `sms:?&body=${e(`${text} ${url}`)}`;
  }
}

/**
 * Apps with no web share address: Instagram, TikTok and Snapchat. The honest
 * way in is the downloaded graphic plus the copied link, added by hand.
 */
export const APP_ONLY_TARGETS: {
  channel: Extract<ShareChannel, "instagram" | "tiktok" | "snapchat">;
  label: string;
  how: string;
}[] = [
  {
    channel: "instagram",
    label: "Instagram",
    how: "Post the story graphic to your Instagram story and add a Link sticker with your link. For your bio: Edit profile, Links, then paste it.",
  },
  {
    channel: "tiktok",
    label: "TikTok",
    how: "If your TikTok profile has a Website field (Edit profile), paste your link there. TikTok only offers it to some accounts. You can post the story graphic as a photo too.",
  },
  {
    channel: "snapchat",
    label: "Snapchat",
    how: "Add the story graphic to a Snap, tap the paperclip and paste your link.",
  },
];

/** Suggested captions, in the page owner's voice. Each holds the link once. */
export function suggestedCaptions(opts: {
  origin: string;
  username: string;
  hasWishlist?: boolean;
}): string[] {
  const link = displayUrl(opts.origin, opts.username);
  const out = [
    `Everything I'm up to, all in one place: ${link}`,
    `New link in bio! Find all my links here: ${link}`,
    `Yo, it's me. Every place to find me is at ${link}`,
    `Follow me everywhere from one link: ${link}`,
  ];
  if (opts.hasWishlist) out.push(`My wishlist is up. See it and everything else at ${link}`);
  return out;
}

/** Short text that goes with a share button that takes text. */
export function shareText(name: string, own: boolean): string {
  return own ? "Find all my links in one place" : `Check out ${name} on Yooits.me`;
}
