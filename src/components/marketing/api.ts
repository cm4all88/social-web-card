import { supabase } from "@/integrations/supabase/client";
import type { FeatureId } from "@/lib/marketing/features";
import type { PlatformId, PostFormat } from "@/lib/marketing/platforms";
import type { DraftPost, GraphicSpec, PostKind, PostStatus } from "@/lib/marketing/types";
import type { PlatformRow, Weekly } from "@/lib/marketing/weekly";

// The marketing functions aren't in the generated types.
export const rpc = <T = unknown>(fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc.bind(supabase) as unknown as (
      f: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: T; error: { message: string; code?: string } | null }>
  )(fn, args);

export type Campaign = {
  id: string;
  name: string;
  slug: string;
  goal: string | null;
  audiences: string[];
  season: string | null;
  starts_on: string | null;
  ends_on: string | null;
  status: "active" | "paused" | "done" | "archived";
};

export type Post = {
  id: string;
  campaign_id: string | null;
  platform: PlatformId;
  format: PostFormat;
  kind: PostKind;
  title: string;
  caption: string;
  hashtags: string[];
  script: string | null;
  graphic: GraphicSpec | Record<string, never>;
  features: FeatureId[];
  landing_path: string;
  code: string;
  scheduled_at: string | null;
  status: PostStatus;
  publish_method: "manual" | "api";
  approved_at: string | null;
  publishing_started_at: string | null;
  published_at: string | null;
  external_id: string | null;
  external_url: string | null;
  verified_at: string | null;
  verification: "oembed" | "api" | "owner_confirmed" | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type Account = {
  platform: PlatformId;
  handle: string | null;
  profile_url: string | null;
  mode: string;
  connection_status: string;
  connected_at: string | null;
  notes: string | null;
  has_token: boolean;
};

export type MarketingState = {
  campaigns: Campaign[];
  posts: Post[];
  accounts: Account[];
  counts: Partial<Record<PostStatus, number>>;
  now: string;
};

export type Performance = {
  days: number;
  since: string;
  totals: {
    signups: number;
    attributed_signups: number;
    referred_signups: number;
    profile_completions: number;
    paid: number;
  };
  campaign_visits: number;
  campaigns: {
    id: string;
    name: string;
    slug: string;
    visits: number;
    signup_clicks: number;
    signups: number;
    completions: number;
    paid: number;
    published: number;
  }[];
  platforms: PlatformRow[];
  posts: {
    id: string;
    title: string;
    platform: PlatformId;
    code: string;
    published_at: string;
    external_url: string;
    signups: number;
    completions: number;
    paid: number;
  }[];
  referrers: { username: string; signups: number }[];
  analytics_enabled: boolean;
};

export type WeeklyData = Weekly & { generated_at: string; week: { from: string; to: string } };

export type HistoryRow = {
  at: string;
  event: string;
  from: string | null;
  to: string | null;
  detail: Record<string, unknown>;
};

/** A missing function means the scheduler/analytics part of the database isn't switched on yet. */
export const isMissingFunction = (e: { code?: string; message: string } | null) =>
  !!e &&
  (e.code === "PGRST202" ||
    e.code === "42883" ||
    /could not find the function|does not exist/i.test(e.message));

export async function addDrafts(campaignId: string | null, posts: DraftPost[]) {
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < posts.length; i += 200) {
    const { data, error } = await rpc<{ added: number; skipped_duplicates: number }>(
      "owner_marketing_add_posts",
      {
        _campaign: campaignId,
        _posts: posts.slice(i, i + 200),
      },
    );
    if (error) throw new Error(error.message);
    added += data.added;
    skipped += data.skipped_duplicates;
  }
  return { added, skipped };
}
