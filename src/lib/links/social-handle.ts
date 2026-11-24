/** Extract only unambiguous profile paths on exact platform hosts. */
export function socialHandle(href?: string): string | null {
  if (!href || !/^https?:\/\//i.test(href)) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const { hostname, pathname } = url;
  const host = hostname.replace(/^www\./, "");
  const path = pathname.replace(/\/$/, "");
  if (host === "tiktok.com" || host === "youtube.com") {
    return /^\/@[\w.-]{1,100}$/.test(path) ? path.slice(1) : null;
  }
  if (host === "snapchat.com") {
    const match = /^\/add\/([\w.-]{1,30})$/.exec(path);
    return match ? `@${match[1]}` : null;
  }
  const match = /^\/([\w.]{1,30})$/.exec(path);
  if (!match) return null;
  const name = match[1];
  if (
    host === "instagram.com" &&
    !/^(p|reels?|stories|explore|accounts|direct|about|legal|developer)$/i.test(name)
  ) {
    return `@${name}`;
  }
  return null;
}
