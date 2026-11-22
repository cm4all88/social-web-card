/**
 * Typed calls for the analytics database functions (migration
 * 20261122130000_analytics.sql). The generated Supabase types don't know them,
 * so the calls are typed here.
 */
import { supabase } from "@/integrations/supabase/client";

export type Range = 7 | 30 | 90;

export type MyAnalytics = {
  enabled: boolean;
  days: number;
  since: string;
  totals: { views: number; clicks: number; wishlist_views: number; visitors: number };
  previous: { views: number; clicks: number };
  daily: { day: string; views: number; clicks: number }[];
  links: {
    link_id: string;
    platform: string | null;
    host: string | null;
    clicks: number;
    current: boolean;
  }[];
  sources: { source: string; views: number }[];
  campaigns: {
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    views: number;
  }[];
  devices: { device: string; views: number }[];
  countries: { country: string; views: number }[];
};

export type OwnerAnalytics = {
  enabled: boolean;
  days: number;
  since: string;
  users: {
    total: number;
    signups: number;
    active_7d: number;
    active_30d: number;
    pages_with_traffic: number;
    pages_published: number;
  };
  traffic: {
    profile_views: number;
    link_clicks: number;
    wishlist_views: number;
    home_views: number;
    signup_clicks: number;
  };
  conversions: {
    home_visitors: number;
    signups: number;
    visit_to_signup_pct: number | null;
    founding_active: number;
    founding_new: number;
    plus_paid: number | null;
    free_to_plus_pct: number | null;
  };
  daily: { day: string; signups: number; views: number; clicks: number }[];
  growth: { week: string; total: number }[];
  destinations: { host: string; clicks: number }[];
  platforms: { platform: string; links: number; clicks: number }[];
  sources: { source: string; views: number }[];
  top_pages: { username: string; views: number; clicks: number }[];
};

type Rpc = (
  fn: string,
  args: object,
) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
const rpc = (supabase as unknown as { rpc: Rpc }).rpc.bind(supabase);

async function call<T>(fn: string, args: object): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) {
    throw new Error(
      error.code === "42501"
        ? "You don't have access to this."
        : "Couldn't load analytics. Please try again.",
    );
  }
  return data as T;
}

export const loadMyAnalytics = (days: Range) => call<MyAnalytics>("my_analytics", { _days: days });
export const loadOwnerAnalytics = (days: Range) =>
  call<OwnerAnalytics>("owner_analytics", { _days: days });
export const setAnalyticsEnabled = (enabled: boolean) =>
  call<boolean>("owner_set_analytics_enabled", { _enabled: enabled });

/** Percent change from the previous period, or null when there was nothing before. */
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}

export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}
