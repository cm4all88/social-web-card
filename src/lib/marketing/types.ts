import type { Audience, FeatureId } from "./features";
import type { PlatformId, PostFormat } from "./platforms";

export type PostKind =
  "tutorial" | "demo" | "announcement" | "invite" | "tip" | "community" | "seasonal";
export type PostStatus =
  "draft" | "approved" | "scheduled" | "publishing" | "published" | "failed" | "archived";

export type GraphicTemplate = "headline" | "list" | "steps" | "wishlist" | "profile";
export type GraphicTheme = "night" | "snow" | "warm";

export type GraphicSpec = {
  template: GraphicTemplate;
  theme: GraphicTheme;
  headline: string;
  sub?: string;
  items?: string[];
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
