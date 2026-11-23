/**
 * The built-in writer. It turns one idea (a Concept) into a post shaped for
 * each platform, and builds new ideas from the live feature list for the
 * Generate tab. Everything it writes comes from features.ts, so it can only
 * talk about what works today; claims.ts checks the result again.
 */
import { AUDIENCES, FEATURES, type Audience, type FeatureId } from "./features";
import { LINK_TOKEN, countedLength } from "./links";
import { PLATFORMS, type PlatformId, type PostFormat } from "./platforms";
import type { Concept, DraftPost, GraphicLayout, GraphicTheme, PostKind } from "./types";

const VIDEO_FORMAT: Partial<Record<PlatformId, PostFormat>> = {
  tiktok: "video",
  youtube: "short",
  instagram: "reel",
  facebook: "reel",
  snapchat: "story",
};

export function formatFor(c: Concept, platform: PlatformId): PostFormat {
  if (platform === "tiktok" || platform === "youtube") return VIDEO_FORMAT[platform]!;
  if (c.script && (platform === "instagram" || platform === "snapchat"))
    return VIDEO_FORMAT[platform]!;
  if (platform === "instagram")
    return c.graphic.items && c.graphic.items.length >= 3 ? "carousel" : "post";
  if (platform === "snapchat") return "story";
  if (platform === "x") return "post";
  return c.script ? "reel" : "post";
}

/** Hashtags in the platform's style and number. */
export function tagsFor(platform: PlatformId, tags: string[]): string[] {
  const base = Array.from(
    new Set(["yooits", ...tags.map((t) => t.replace(/^#/, "").replace(/\s+/g, ""))]),
  );
  return base.slice(0, PLATFORMS[platform].hashtagsMax);
}

function scriptText(beats: string[]): string {
  return beats.map((b, i) => `${i + 1}. ${b}`).join("\n");
}

/** Shorten to a limit at a word boundary. */
function clip(s: string, max: number): string {
  if ([...s].length <= max) return s;
  const cut = [...s].slice(0, max - 1).join("");
  return `${cut.replace(/\s+\S*$/, "")}…`;
}

export function renderConcept(
  c: Concept,
  platform: PlatformId,
  campaignTheme?: GraphicTheme,
): DraftPost {
  const spec = PLATFORMS[platform];
  const format = formatFor(c, platform);
  const hashtags = tagsFor(platform, c.tags);
  const body = c.body.join("\n");
  let caption: string;
  switch (platform) {
    case "instagram":
      caption = `${c.hook}\n\n${body}\n\n${c.cta} Link in bio.`;
      break;
    case "tiktok":
      caption = `${c.hook} ${c.body[0] ?? ""} ${c.cta} Link in bio.`.replace(/\s+/g, " ").trim();
      break;
    case "youtube":
      caption = `${c.hook}\n\n${body}\n\n${c.cta} yooits.me`;
      break;
    case "facebook":
      caption = `${c.hook}\n\n${body}\n\n${c.cta} ${LINK_TOKEN}`;
      break;
    case "snapchat":
      caption = clip(`${c.hook} ${c.cta}`, spec.captionMax);
      break;
    case "x": {
      const custom = c.x && c.x.includes(LINK_TOKEN) ? c.x : null;
      caption = custom ?? `${c.hook} ${c.cta} ${LINK_TOKEN}`;
      if (countedLength("x", caption.replace(LINK_TOKEN, "https://yooits.me/x")) > 280) {
        caption = `${clip(c.hook, 200)} ${LINK_TOKEN}`;
      }
      break;
    }
  }
  const usesScript =
    !!c.script &&
    (format === "video" ||
      format === "short" ||
      format === "reel" ||
      (platform === "snapchat" && !!c.script));
  return {
    platform,
    format,
    kind: c.kind,
    title: platform === "youtube" ? clip(c.hook, 95) : c.title,
    caption: clip(caption, spec.captionMax),
    hashtags,
    script: usesScript ? scriptText(c.script!) : null,
    graphic: { ...c.graphic, theme: c.graphic.theme ?? campaignTheme ?? "brand" },
    features: c.features,
    landing_path: c.landing ?? "/",
    source: "launch_plan",
  };
}

// ---------------------------------------------------------------------------
// New ideas from the feature list (Generate tab)
// ---------------------------------------------------------------------------

/** Feature-specific openings and steps, so generated posts say something concrete. */
const FEATURE_COPY: Record<FeatureId, { hooks: string[]; steps: string[]; tag: string }> = {
  page: {
    hooks: [
      "Your bio gets one link. Make it the one that has everything.",
      "Your own Yooits page is free, and it takes about a minute.",
      'If people keep asking "where else are you?", send them here.',
    ],
    steps: ["Pick a username", "Add your links", "Put your Yooits link in your bio"],
    tag: "linkinbio",
  },
  links: {
    hooks: [
      "Add every link you've got. There's no limit on the free page.",
      "Put the link you care about most at the very top.",
      "Ten links? Forty? The free page doesn't count.",
    ],
    steps: ["Add a link", "Drag it where you want it", "Star it to feature it at the top"],
    tag: "linkinbio",
  },
  themes: {
    hooks: [
      "Same links, twelve different looks. All free.",
      "Make your page match your feed, not the other way round.",
      "Pick a theme, or set your own colors and call it yours.",
    ],
    steps: ["Open Appearance", "Tap through the themes", "Or set your own colors"],
    tag: "aesthetic",
  },
  seasonal: {
    hooks: [
      "Snowfall is out for winter, and it's free.",
      "Your page can dress for the season too.",
    ],
    steps: ["Open Appearance", "Pick Snowfall", "Watch it snow"],
    tag: "winteraesthetic",
  },
  effects: {
    hooks: [
      "Snow, leaves, hearts or stars, drifting behind your links.",
      "A little movement on your page goes a long way.",
    ],
    steps: ["Open Appearance", "Pick an effect", "Save and open your page"],
    tag: "aesthetic",
  },
  rewards: {
    hooks: [
      "Finish setting up your page and it pays you back in themes.",
      "Five small things to do on Yooits, five themes you unlock.",
    ],
    steps: ["Complete your profile", "Add five links", "Share your page"],
    tag: "unlocked",
  },
  background: {
    hooks: [
      "Hit 1,000 visitors and your page can wear your own background.",
      "Here's what 1,000 visitors unlocks on Yooits.",
    ],
    steps: ["Share your page", "Watch the visitor count", "Upload your background at 1,000"],
    tag: "milestone",
  },
  wishlists: {
    hooks: [
      "Make a wishlist people can actually find: it lives on your page.",
      "One link for your list, so nobody has to guess what you want.",
      "Private for planning, public for sharing. Your list, your call.",
    ],
    steps: ["Make a list", "Add what you want", "Share its link or show it on your page"],
    tag: "wishlist",
  },
  gift_claims: {
    hooks: [
      'Nobody buys the same gift twice when they can tap "I\'ll buy it" first.',
      "The fix for three people buying the same thing.",
    ],
    steps: ["Share your list", 'A friend taps "I\'ll buy it"', "Everyone else sees it's taken"],
    tag: "giftideas",
  },
  messages: {
    hooks: [
      "Messages on Yooits are off until you turn them on.",
      "Let people reach you without handing out your number.",
    ],
    steps: ["Turn messages on in settings", "Reply when you want", "Block or report in a tap"],
    tag: "onlinesafety",
  },
  analytics: {
    hooks: [
      "Which of your links actually gets tapped? Your page knows.",
      "Views, clicks and where people came from, free on every page.",
    ],
    steps: ["Open Analytics", "See views and clicks", "Check where visitors came from"],
    tag: "creatortips",
  },
  safety: {
    hooks: [
      "Nobody gets to grab a username built to look like yours.",
      "Every page has a report button, and the bell tells you what matters.",
    ],
    steps: [
      "Claim your name",
      "See the report button on any page",
      "Check the bell for what's new",
    ],
    tag: "onlinesafety",
  },
};

const CTA: Record<PostKind, string[]> = {
  tutorial: [
    "Try it on your own page.",
    "Takes a minute to set up.",
    "Yours is free at yooits.me.",
  ],
  demo: ["Make yours free.", "Set yours up in a minute.", "See how yours looks."],
  announcement: ["It's free to join.", "Claim your name.", "Go pick your username."],
  invite: ["Claim your name before someone else does.", "Grab your link.", "Come make yours."],
  tip: ["Worth two minutes today.", "Try it tonight.", "Small change, cleaner page."],
  community: [
    "Drop yours in the replies.",
    "Show us what you made.",
    "Tag someone who needs this.",
  ],
  seasonal: [
    "Make your list today.",
    "Get it set before the holidays.",
    "Share it with the family chat.",
  ],
};

const AUDIENCE_LINE: Record<Audience, string[]> = {
  creators: [
    "Every platform you post on, one link in every bio.",
    "Your links, in the order you want people to see them.",
  ],
  streamers: [
    "Schedule, clips, Discord and socials, all behind one link.",
    "Put it in your panels and your chat command.",
  ],
  artists: [
    "Portfolio, shop and new releases in one place.",
    "A page that looks like your work, not like a template.",
  ],
  small_business: [
    "Menu, booking, reviews and socials behind one link.",
    "Put it on the counter card and the bio.",
  ],
  everyone: ["One link for everything you're into.", "Your stuff, in one place, at your own name."],
};

/** Small seeded random, so "generate again" gives different posts but tests stay stable. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function pick<T>(r: () => number, list: T[], used?: Set<T>): T {
  const free = used ? list.filter((x) => !used.has(x)) : list;
  const pool = free.length ? free : list;
  const v = pool[Math.floor(r() * pool.length)];
  used?.add(v);
  return v;
}

export type GenerateInput = {
  audience: Audience;
  features: FeatureId[];
  kinds: PostKind[];
  platforms: PlatformId[];
  /** How many ideas; each becomes one post per platform. */
  count: number;
  seed?: number;
  theme?: GraphicTheme;
};

/** Each feature's natural picture, so generated graphics vary like the launch plan's. */
const FEATURE_LAYOUT: Record<FeatureId, GraphicLayout> = {
  page: "hero",
  links: "profile",
  themes: "themes",
  seasonal: "profile",
  effects: "themes",
  rewards: "steps",
  background: "statement",
  wishlists: "wishlist",
  gift_claims: "wishlist",
  messages: "statement",
  analytics: "analytics",
  safety: "statement",
};
const BACKDROPS: GraphicTheme[] = ["brand", "night", "light", "warm"];

/** Short headline from a hook: its first sentence, with its last two words in the brand gradient. */
function headlineFrom(hook: string): string {
  const first = (hook.match(/^[^.!?]+[.!?]?/)?.[0] ?? hook).trim();
  const words = first.split(" ");
  if (words.length > 9 || words.length < 3) return first;
  return `${words.slice(0, -2).join(" ")} *${words.slice(-2).join(" ")}*`;
}

function graphicFor(
  fid: FeatureId,
  kind: PostKind,
  hook: string,
  claim: string,
  steps: string[],
  facts: string[],
  i: number,
  theme?: GraphicTheme,
): Concept["graphic"] {
  const backdrop =
    theme ?? (fid === "seasonal" ? "snow" : BACKDROPS[i % BACKDROPS.length]);
  if (kind === "tutorial" || kind === "tip")
    return { layout: "steps", theme: backdrop, headline: headlineFrom(hook), items: steps };
  const layout = FEATURE_LAYOUT[fid];
  return {
    layout,
    theme: backdrop,
    headline: headlineFrom(hook),
    sub: layout === "statement" || layout === "steps" ? undefined : claim,
    items: layout === "steps" ? facts : undefined,
    look: fid === "seasonal" ? "snowfall" : undefined,
    effect: fid === "seasonal" ? "snow" : fid === "effects" ? "stars" : undefined,
  };
}

export function generateConcepts(input: GenerateInput): Concept[] {
  const r = rng(input.seed ?? Date.now());
  const features = input.features.length ? input.features : AUDIENCES[input.audience].angle;
  const kinds = input.kinds.length
    ? input.kinds
    : (["tutorial", "demo", "tip", "invite"] as PostKind[]);
  const usedHooks = new Set<string>();
  const out: Concept[] = [];
  for (let i = 0; i < Math.max(1, Math.min(input.count, 30)); i++) {
    const fid = features[i % features.length];
    const kind = kinds[i % kinds.length];
    const f = FEATURES[fid];
    const copy = FEATURE_COPY[fid];
    const hook = pick(r, copy.hooks, usedHooks);
    const audienceLine = pick(r, AUDIENCE_LINE[input.audience]);
    const facts = [...f.facts].sort(() => r() - 0.5).slice(0, 3);
    const isSteps = kind === "tutorial" || kind === "tip";
    const body = isSteps ? copy.steps.map((s, n) => `${n + 1}. ${s}`) : [f.claim, audienceLine];
    const video = kind === "tutorial" || kind === "demo";
    out.push({
      kind,
      audience: input.audience,
      features: [fid],
      title: `${f.name}: ${kind}`,
      hook,
      body,
      cta: pick(r, CTA[kind]),
      script: video
        ? [
            `0-2s: on screen "${hook}"`,
            `2-8s: screen recording. ${f.demo}`,
            ...copy.steps.map((s, n) => `${8 + n * 3}-${11 + n * 3}s: ${s}`),
            `End card: "Yo, it's me. yooits.me"`,
          ]
        : undefined,
      graphic: graphicFor(fid, kind, hook, f.claim, copy.steps, facts, i, input.theme),
      tags: [
        copy.tag,
        input.audience === "small_business"
          ? "smallbusiness"
          : input.audience === "everyone"
            ? "linkinbio"
            : input.audience,
      ],
      platforms: input.platforms,
    });
  }
  return out;
}

export function conceptsToPosts(
  concepts: Concept[],
  platforms?: PlatformId[],
  theme?: GraphicTheme,
  source: DraftPost["source"] = "generator",
): DraftPost[] {
  return concepts.flatMap((c) =>
    (platforms ?? c.platforms).map((p) => ({ ...renderConcept(c, p, theme), source })),
  );
}
