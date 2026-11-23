import type { Audience, FeatureId } from "./features";
import type { PlatformId, PostFormat } from "./platforms";

export type PostKind =
  "tutorial" | "demo" | "announcement" | "invite" | "tip" | "community" | "seasonal";
export type PostStatus =
  "draft" | "approved" | "scheduled" | "publishing" | "published" | "failed" | "archived";

/** Older posts name a template; newer ones a layout. Both still draw. */
export type GraphicTemplate = "headline" | "list" | "steps" | "wishlist" | "profile";
export type GraphicLayout =
  | "hero"
  | "profile"
  | "themes"
  | "wishlist"
  | "analytics"
  | "steps"
  | "statement"
  | "compare";
/** The backdrop behind the layout. */
export type GraphicTheme = "brand" | "night" | "snow" | "warm" | "light";

/** One link button on a phone mock-up: what the real page shows for it. */
export type MockLink = { label: string; icon: string; host?: string; featured?: boolean };
export type MockItem = { name: string; price?: string; host?: string; taken?: boolean };

export type GraphicSpec = {
  layout?: GraphicLayout;
  template?: GraphicTemplate;
  theme: GraphicTheme;
  /** Small line above the headline. */
  eyebrow?: string;
  headline: string;
  sub?: string;
  /** Steps, or the "before" lines in a compare. */
  items?: string[];
  /** Button text; defaults to "Make yours at yooits.me". */
  cta?: string;
  /** Page theme shown on the phone (a theme key from themes.ts). */
  look?: string;
  /** Page themes for the themes layout, up to three. */
  looks?: string[];
  /** Animated effect drawn over the phone's page. */
  effect?: "snow" | "stars" | "hearts" | "leaves";
  /** What the phone's page holds. */
  bio?: string;
  links?: MockLink[];
  /** Wishlist layout: the list's title, who it's for, and its items. */
  list?: { title: string; forLine?: string; occasion?: string; items: MockItem[] };
};

/** A post before it's saved: what the generator makes and owner_marketing_add_posts takes. */
export type DraftPost = {
  platform: PlatformId;
  format: PostFormat;
  kind: PostKind;
  title: string;
  /** May hold {link}, replaced with the post's own campaign link when copied. */
  caption: string;
  hashtags: string[];
  script?: string | null;
  graphic: GraphicSpec;
  features: FeatureId[];
  landing_path: string;
  scheduled_at?: string | null;
  source: "launch_plan" | "generator" | "ai" | "manual";
};

/** One idea, written once, turned into a post per platform. */
export type Concept = {
  kind: PostKind;
  audience: Audience;
  features: FeatureId[];
  title: string;
  hook: string;
  body: string[];
  cta: string;
  /** Hand-written X post (must hold {link}); otherwise built from hook + cta. */
  x?: string;
  /** Beats for a short vertical video; present means video platforms get it. */
  script?: string[];
  graphic: Omit<GraphicSpec, "theme"> & { theme?: GraphicTheme };
  tags: string[];
  platforms: PlatformId[];
  landing?: string;
};

export const KIND_LABELS: Record<PostKind, string> = {
  tutorial: "Tutorial",
  demo: "Demo",
  announcement: "Announcement",
  invite: "Invitation",
  tip: "Tip",
  community: "Community",
  seasonal: "Seasonal",
};

export const STATUS_LABELS: Record<PostStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  scheduled: "Scheduled",
  publishing: "Due to post",
  published: "Live",
  failed: "Failed",
  archived: "Archived",
};
