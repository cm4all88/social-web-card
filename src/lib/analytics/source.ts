/**
 * Pure helpers for analytics: where a visit came from, what kind of device it
 * was, and whether the request should be counted at all. No I/O here, so it
 * can be tested directly.
 */

/** Traffic sources shown to people, in plain names. */
export const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct or unknown",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  x: "X (Twitter)",
  threads: "Threads",
  youtube: "YouTube",
  snapchat: "Snapchat",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  pinterest: "Pinterest",
  discord: "Discord",
  twitch: "Twitch",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  bluesky: "Bluesky",
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  yahoo: "Yahoo",
  email: "Email",
  yooits: "Yooits",
  other: "Other websites",
};

export function sourceLabel(id: string): string {
  return SOURCE_LABELS[id] ?? id;
}

/** Referrer host suffix -> source. Checked as "host is X or ends with .X". */
const HOST_SOURCES: [string, string][] = [
  ["instagram.com", "instagram"],
  ["tiktok.com", "tiktok"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["fb.me", "facebook"],
  ["messenger.com", "facebook"],
  ["twitter.com", "x"],
  ["x.com", "x"],
  ["t.co", "x"],
  ["threads.net", "threads"],
  ["threads.com", "threads"],
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["snapchat.com", "snapchat"],
  ["linkedin.com", "linkedin"],
  ["lnkd.in", "linkedin"],
  ["reddit.com", "reddit"],
  ["pinterest.com", "pinterest"],
  ["pin.it", "pinterest"],
  ["discord.com", "discord"],
  ["discord.gg", "discord"],
  ["discordapp.com", "discord"],
  ["twitch.tv", "twitch"],
  ["whatsapp.com", "whatsapp"],
  ["wa.me", "whatsapp"],
  ["t.me", "telegram"],
  ["telegram.org", "telegram"],
  ["bsky.app", "bluesky"],
  ["duckduckgo.com", "duckduckgo"],
  ["bing.com", "bing"],
  ["yahoo.com", "yahoo"],
  ["mail.google.com", "email"],
  ["outlook.live.com", "email"],
  ["outlook.office.com", "email"],
  ["mail.yahoo.com", "email"],
  ["yooits.me", "yooits"],
];

/** In-app browsers say who they are in the user agent, often with no referrer. */
const UA_SOURCES: [RegExp, string][] = [
  [/Instagram/i, "instagram"],
  [/\bFBA[NV]\/|FB_IAB|FBIOS|\bFB4A\b/i, "facebook"],
  [/musical_ly|BytedanceWebview|\bTikTok\b|trill_/i, "tiktok"],
  [/Snapchat/i, "snapchat"],
  [/LinkedInApp/i, "linkedin"],
  [/Pinterest/i, "pinterest"],
  [/Twitter(?:Android|iPhone)?\b/i, "x"],
  [/Barcelona\b|Threads/i, "threads"],
  [/WhatsApp/i, "whatsapp"],
  [/Telegram/i, "telegram"],
  [/Discord/i, "discord"],
];

const UTM_SOURCES: Record<string, string> = {
  ig: "instagram",
  instagram: "instagram",
  tiktok: "tiktok",
  tt: "tiktok",
  fb: "facebook",
  facebook: "facebook",
  twitter: "x",
  x: "x",
  threads: "threads",
  youtube: "youtube",
  yt: "youtube",
  snapchat: "snapchat",
  linkedin: "linkedin",
  reddit: "reddit",
  pinterest: "pinterest",
  discord: "discord",
  twitch: "twitch",
  whatsapp: "whatsapp",
  telegram: "telegram",
  bluesky: "bluesky",
  email: "email",
  newsletter: "email",
  google: "google",
};

/** Host of a referrer URL, lower-case, without "www.". Null when unusable. */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "android-app:")
      return null;
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return h && h.length <= 253 ? h : null;
  } catch {
    return null;
  }
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function isGoogle(host: string): boolean {
  // google.com, google.co.uk, google.de, news.google.com ...
  return /(^|\.)google\.[a-z.]{2,6}$/.test(host);
}

/** Android apps sometimes send android-app://com.instagram.android as the referrer. */
function androidAppSource(host: string): string | null {
  if (host.includes("instagram")) return "instagram";
  if (host.includes("facebook")) return "facebook";
  if (host.includes("zhiliaoapp") || host.includes("tiktok") || host.includes("musically"))
    return "tiktok";
  if (host.includes("twitter")) return "x";
  if (host.includes("snapchat")) return "snapchat";
  if (host.includes("linkedin")) return "linkedin";
  if (host.includes("reddit")) return "reddit";
  if (host.includes("google.android.gm")) return "email";
  if (host.includes("google")) return "google";
  return null;
}

/**
 * Where a visit came from. utm_source wins when it names a known platform,
 * then the referrer, then the in-app browser's user agent.
 */
export function classifySource(opts: {
  referrer?: string | null;
  userAgent?: string | null;
  utmSource?: string | null;
}): string {
  const utm = opts.utmSource?.trim().toLowerCase();
  if (utm && UTM_SOURCES[utm]) return UTM_SOURCES[utm];

  const raw = opts.referrer ?? "";
  const host = referrerHost(raw);
  if (host) {
    if (raw.toLowerCase().startsWith("android-app:")) {
      const s = androidAppSource(host);
      if (s) return s;
    } else {
      // Specific hosts (mail.google.com) before broad ones (google.*).
      for (const [domain, source] of HOST_SOURCES) {
        if (domain.includes("mail") || domain.includes("outlook")) {
          if (hostIs(host, domain)) return source;
        }
      }
      if (isGoogle(host)) return "google";
      for (const [domain, source] of HOST_SOURCES) {
        if (hostIs(host, domain)) return source;
      }
    }
  }

  const ua = opts.userAgent ?? "";
  for (const [re, source] of UA_SOURCES) {
    if (re.test(ua)) return source;
  }
  if (host) return "other";
  return "direct";
}

export function deviceFromUserAgent(
  ua: string | null | undefined,
): "mobile" | "tablet" | "desktop" | null {
  if (!ua) return null;
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}

/** Crawlers, link-preview fetchers, monitors and headless browsers. Kept simple on purpose. */
const BOT_RE =
  /bot\b|bot\/|crawl|spider|slurp|scrape|preview|facebookexternalhit|embedly|quora link|whatsapp\/|telegrambot|discordbot|slackbot|skypeuripreview|bingpreview|headless|phantomjs|puppeteer|playwright|lighthouse|pingdom|uptime|monitor|curl\/|wget\/|python-requests|python-urllib|httpclient|okhttp|go-http-client|axios\/|node-fetch|java\//i;

export function isBot(ua: string | null | undefined): boolean {
  if (!ua || ua.length < 12) return true;
  return BOT_RE.test(ua);
}

/** Do Not Track or Global Privacy Control: the visitor asked not to be counted. */
export function optedOut(headers: { dnt?: string | null; gpc?: string | null }): boolean {
  return headers.dnt?.trim() === "1" || headers.gpc?.trim() === "1";
}

/** Trim a UTM value to what we store: printable, at most 100 characters. */
export function cleanUtm(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = Array.from(v)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c > 0x1f && c !== 0x7f;
    })
    .join("")
    .trim()
    .slice(0, 100);
  return s || null;
}
