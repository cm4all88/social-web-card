/**
 * Share graphics for a person's own Yooits.me page: a 1080x1920 story and a
 * 1080x1350 post. The phone shows their real page (their theme, photo, name,
 * bio and first links, as yooits.me draws them), drawn with the same pieces
 * as the Marketing Center graphics, and the address printed is their own.
 */
import { fontFamilyFor, type ThemeTokens } from "@/lib/themes";
import { linkDisplay } from "@/lib/platforms";
import { linkDisplayHost, safeLinkHref } from "@/lib/safe-url";
import { BRAND, parseBackground, solid } from "@/lib/marketing/brand";
import {
  Backdrop,
  BrandGradient,
  FONT,
  fillOf,
  LinkCard,
  Lockup,
  Paint,
  Phone,
  PHONE_RATIO,
  SCREEN_H,
  SCREEN_W,
  StatusBar,
  wrap,
} from "@/lib/marketing/graphics";
import type { GraphicSize } from "@/lib/marketing/platforms";
import type { MockLink } from "@/lib/marketing/types";

export type ShareFormat = "story" | "post";

export const SHARE_SIZES: Record<ShareFormat, GraphicSize> = {
  story: { w: 1080, h: 1920, label: "Story 1080×1920" },
  post: { w: 1080, h: 1350, label: "Post 1080×1350" },
};

export type ShareProfile = {
  username: string;
  name: string;
  bio: string | null;
  /** The photo as a data: URL (needed for PNG export) or its https address (on screen). */
  avatar: string | null;
  showBranding: boolean;
};

export type ShareLink = {
  platform: string;
  url: string;
  title?: string | null;
  icon?: string | null;
  featured?: boolean | null;
};

/** The page's links as the phone mock-up draws them. */
export function mockLinks(links: ShareLink[], max = 5): MockLink[] {
  return links.slice(0, max).map((l) => {
    const meta = linkDisplay(l);
    const host = linkDisplayHost(safeLinkHref(l.url)) ?? undefined;
    return {
      label: meta.label,
      icon: (l.icon || l.platform || "website").toLowerCase(),
      host,
      featured: !!l.featured,
    };
  });
}

function ellipsize(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Their page, at a phone's CSS size. */
function MyPage({
  profile,
  t,
  links,
  uid,
}: {
  profile: ShareProfile;
  t: ThemeTokens;
  links: MockLink[];
  uid: string;
}) {
  const fg = solid(t.foreground, "#ffffff");
  const accent = solid(t.accent, "#ffffff");
  const font = fontFamilyFor(t.font);
  const name = ellipsize(profile.name, 24);
  const nameSize = name.length > 16 ? 24 : 30;
  const bio = profile.bio ? wrap(profile.bio, 38, 3) : [];
  const avatarCy = 88 + 56;
  const nameY = 88 + 112 + 20 + 26;
  const handleY = nameY + 26;
  const bioY = handleY + 30;
  let y = bioY + bio.length * 24 + 24;
  const room = SCREEN_H - y - (profile.showBranding ? 70 : 30);
  const shown: MockLink[] = [];
  let used = 0;
  for (const l of links) {
    const h = (l.featured ? 88 : 80) + 12;
    if (used + h > room) break;
    shown.push(l);
    used += h;
  }
  const clip = `${uid}-av`;
  return (
    <g fontFamily={font}>
      <Paint
        layers={parseBackground(t.background)}
        x={0}
        y={0}
        w={SCREEN_W}
        h={SCREEN_H}
        uid={`${uid}-bgp`}
      />
      <StatusBar color={fg} />
      <defs>
        <clipPath id={clip}>
          <circle cx={SCREEN_W / 2} cy={avatarCy} r={52} />
        </clipPath>
      </defs>
      <circle cx={SCREEN_W / 2} cy={avatarCy} r={56} fill={accent} />
      <circle cx={SCREEN_W / 2} cy={avatarCy} r={52} {...fillOf(t.card)} />
      {profile.avatar ? (
        <image
          href={profile.avatar}
          x={SCREEN_W / 2 - 52}
          y={avatarCy - 52}
          width={104}
          height={104}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clip})`}
        />
      ) : (
        <text
          x={SCREEN_W / 2}
          y={avatarCy + 13}
          textAnchor="middle"
          fill={solid(t.cardForeground, fg)}
          fontWeight={800}
          fontSize={40}
        >
          {profile.name.slice(0, 1).toUpperCase()}
        </text>
      )}
      <text
        x={SCREEN_W / 2}
        y={nameY}
        textAnchor="middle"
        fill={fg}
        fontWeight={700}
        fontSize={nameSize}
        letterSpacing={-0.5}
      >
        {name}
      </text>
      <text x={SCREEN_W / 2} y={handleY} textAnchor="middle" fill={fg} opacity={0.7} fontSize={14}>
        @{profile.username}
      </text>
      {bio.map((line, i) => (
        <text
          key={i}
          x={SCREEN_W / 2}
          y={bioY + i * 24}
          textAnchor="middle"
          fill={fg}
          opacity={0.8}
          fontSize={16}
        >
          {line}
        </text>
      ))}
      {shown.map((l, i) => {
        const node = <LinkCard key={i} link={l} y={y} t={t} uid={uid} i={i} />;
        y += (l.featured ? 88 : 80) + 12;
        return node;
      })}
      {profile.showBranding && (
        <text x={SCREEN_W / 2} y={y + 28} textAnchor="middle" fill={fg} opacity={0.6} fontSize={12}>
          Create your free profile on Yooits.me
        </text>
      )}
    </g>
  );
}

/** The address in a gradient pill, centered on cx (or starting at x when left). */
function UrlPill({
  text,
  x,
  y,
  maxW,
  size,
  uid,
  align = "middle",
}: {
  text: string;
  x: number;
  y: number;
  maxW: number;
  size: number;
  uid: string;
  align?: "middle" | "start";
}) {
  let s = size;
  const widthAt = (fs: number) => text.length * fs * 0.58 + fs * 1.8;
  while (s > size * 0.5 && widthAt(s) > maxW) s -= 2;
  const w = widthAt(s);
  const h = s * 2.1;
  const left = align === "middle" ? x - w / 2 : x;
  return (
    <g>
      <rect x={left} y={y} width={w} height={h} rx={h / 2} fill={`url(#${uid}-brand)`} />
      <text
        x={left + w / 2}
        y={y + h / 2 + s * 0.36}
        textAnchor="middle"
        fill="#ffffff"
        fontFamily={FONT}
        fontWeight={800}
        fontSize={s}
        letterSpacing={-0.3}
      >
        {text}
      </text>
    </g>
  );
}

export function ProfileShareGraphic({
  format,
  profile,
  theme,
  links,
  address,
  id,
}: {
  format: ShareFormat;
  profile: ShareProfile;
  theme: ThemeTokens;
  links: MockLink[];
  /** "yooits.me/name" */
  address: string;
  id?: string;
}) {
  const { w, h } = SHARE_SIZES[format];
  const uid = (id ?? `share-${format}`).replace(/[^a-zA-Z0-9_-]/g, "");
  const t = theme;
  const label = `${profile.name} on Yooits.me: ${address}`;

  if (format === "story") {
    const phoneW = 560;
    const phoneH = phoneW * PHONE_RATIO;
    const phoneY = 400;
    return (
      <svg
        id={id}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        role="img"
        aria-label={label}
      >
        <defs>
          <BrandGradient id={`${uid}-brand`} />
        </defs>
        <Backdrop theme="brand" w={w} h={h} uid={uid} />
        <Lockup x={w / 2 - 150} y={150} h={52} uid={uid} text="#ffffff" />
        <text
          x={w / 2}
          y={330}
          textAnchor="middle"
          fill="#ffffff"
          fontFamily={FONT}
          fontWeight={800}
          fontSize={96}
          letterSpacing={-2.4}
        >
          Yo, it's <tspan fill={`url(#${uid}-brand)`}>me.</tspan>
        </text>
        <Phone x={(w - phoneW) / 2} y={phoneY} w={phoneW} uid={`${uid}-ph`}>
          <MyPage profile={profile} t={t} links={links} uid={`${uid}-pg`} />
        </Phone>
        <UrlPill
          text={address}
          x={w / 2}
          y={phoneY + phoneH + 50}
          maxW={w - 140}
          size={56}
          uid={uid}
        />
      </svg>
    );
  }

  // Post: text on the left, the phone on the right.
  const pad = 76;
  const phoneW = 470;
  const phoneH = phoneW * PHONE_RATIO;
  const colW = w - phoneW - pad * 2 - 30;
  const nameLines = wrap(profile.name, 11, 3);
  const longest = Math.max(...nameLines.map((l) => l.length), 1);
  const nameSize = Math.max(36, Math.min(80, Math.floor(colW / (longest * 0.6))));
  // Center the text block on the canvas.
  const blockH = 26 + nameLines.length * nameSize * 1.08 + 170 + 36 * 2.1;
  let cy = Math.max(230, (h - blockH) / 2 + 26);
  return (
    <svg
      id={id}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      role="img"
      aria-label={label}
    >
      <defs>
        <BrandGradient id={`${uid}-brand`} />
      </defs>
      <Backdrop theme="brand" w={w} h={h} uid={uid} />
      <Lockup x={pad} y={pad} h={46} uid={uid} text="#ffffff" />
      <text
        x={pad}
        y={cy}
        fill={`url(#${uid}-brand)`}
        fontFamily={FONT}
        fontWeight={800}
        fontSize={26}
        letterSpacing={3}
      >
        {BRAND.message.toUpperCase()}
      </text>
      {nameLines.map((line) => {
        cy += nameSize * 1.08;
        return (
          <text
            key={line}
            x={pad}
            y={cy}
            fill="#ffffff"
            fontFamily={FONT}
            fontWeight={800}
            fontSize={nameSize}
            letterSpacing={-nameSize * 0.025}
          >
            {line}
          </text>
        );
      })}
      <text x={pad} y={cy + 70} fill="#dcd3ff" fontFamily={FONT} fontWeight={500} fontSize={34}>
        All my links,
      </text>
      <text x={pad} y={cy + 116} fill="#dcd3ff" fontFamily={FONT} fontWeight={500} fontSize={34}>
        one place.
      </text>
      <UrlPill
        text={address}
        x={pad}
        y={cy + 170}
        maxW={colW + 40}
        size={36}
        uid={uid}
        align="start"
      />
      <Phone x={w - pad - phoneW} y={(h - phoneH) / 2} w={phoneW} uid={`${uid}-ph`}>
        <MyPage profile={profile} t={t} links={links} uid={`${uid}-pg`} />
      </Phone>
    </svg>
  );
}

/** Fetches a photo and returns it as a data: URL, so it survives PNG export. Null on failure. */
export async function photoAsDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") || blob.size > 8 * 1024 * 1024) return null;
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
