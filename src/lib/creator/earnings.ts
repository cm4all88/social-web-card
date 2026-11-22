/**
 * Creator earnings, step 1: qualifying visitors and milestones
 * (migration 20261122190000_creator_earnings.sql). The database counts and
 * decides; this file only types the answer and works out what to show.
 * Nothing here sells anything: creator subscriptions and Support Offerings
 * stay off until they work and Stripe has approved them.
 */
import { supabase } from "@/integrations/supabase/client";

export type MilestoneKind =
  "reward" | "customization" | "subscription_application" | "creator_features" | "other";

export type CreatorMilestone = {
  key: string;
  threshold: number;
  title: string;
  unlocks: string;
  kind: MilestoneKind;
  /** false: planned, unlocks nothing yet. */
  live: boolean;
  reached: boolean;
};

export type CreatorEarnings =
  | { visible: false }
  | {
      visible: true;
      /** On for everyone (false: only admins see it). */
      enabled: boolean;
      analytics_enabled: boolean;
      qualifying_visitors: number;
      milestones: CreatorMilestone[];
    };

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
const KINDS: readonly MilestoneKind[] = [
  "reward",
  "customization",
  "subscription_application",
  "creator_features",
  "other",
];

/** Anything unexpected reads as "not shown". */
export function parseCreatorEarnings(data: unknown): CreatorEarnings {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (d.visible !== true) return { visible: false };
  const milestones = (Array.isArray(d.milestones) ? d.milestones : [])
    .map((m): CreatorMilestone | null => {
      const r = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      if (typeof r.key !== "string" || typeof r.title !== "string") return null;
      const threshold = num(r.threshold);
      if (threshold < 1) return null;
      return {
        key: r.key,
        threshold,
        title: r.title,
        unlocks: typeof r.unlocks === "string" ? r.unlocks : "",
        kind: KINDS.includes(r.kind as MilestoneKind) ? (r.kind as MilestoneKind) : "other",
        live: r.live === true,
        reached: r.reached === true,
      };
    })
    .filter((m): m is CreatorMilestone => m !== null)
    .sort((a, b) => a.threshold - b.threshold);
  return {
    visible: true,
    enabled: d.enabled === true,
    analytics_enabled: d.analytics_enabled === true,
    qualifying_visitors: num(d.qualifying_visitors),
    milestones,
  };
}

/** The first milestone not yet reached, with how far along the creator is (0 to 1). */
export function nextMilestone(
  visitors: number,
  milestones: CreatorMilestone[],
): { milestone: CreatorMilestone; remaining: number; progress: number } | null {
  const sorted = [...milestones].sort((a, b) => a.threshold - b.threshold);
  const idx = sorted.findIndex((m) => visitors < m.threshold);
  if (idx < 0) return null;
  const m = sorted[idx];
  const from = idx === 0 ? 0 : sorted[idx - 1].threshold;
  const span = Math.max(1, m.threshold - from);
  return {
    milestone: m,
    remaining: m.threshold - visitors,
    progress: Math.min(1, Math.max(0, (visitors - from) / span)),
  };
}

/** What the milestone row says about its unlock. Planned milestones promise nothing. */
export function milestoneStatus(m: CreatorMilestone): string {
  if (!m.live) return "Coming later";
  return m.reached ? "Unlocked" : "Locked";
}

export async function loadMyCreatorEarnings(): Promise<CreatorEarnings> {
  const client = supabase as unknown as {
    rpc: (
      f: string,
      a: object,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("my_creator_earnings", {});
  if (error) return { visible: false };
  return parseCreatorEarnings(data);
}
