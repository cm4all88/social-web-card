/** Link sections and per-link click counts (migration 20261122180000_links_first.sql). */
import { supabase } from "@/integrations/supabase/client";
import type { LinkSection } from "./groups";

export type ManagedLink = {
  id: string;
  user_id: string;
  platform: string;
  url: string;
  display_order: number;
  enabled: boolean;
  title: string | null;
  icon: string | null;
  featured: boolean;
  section_id: string | null;
};

export type LinkClicks = {
  enabled: boolean;
  byLink: Record<string, { total: number; last_30: number }>;
};

type Rpc = (
  fn: string,
  args: object,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const rpc = (supabase as unknown as { rpc: Rpc }).rpc.bind(supabase);

/** Sections for one person, in order. An empty list if they can't be read. */
export async function loadSections(userId: string): Promise<LinkSection[]> {
  const { data, error } = await supabase
    .from("link_sections")
    .select("id, title, display_order")
    .eq("user_id", userId)
    .order("display_order", { ascending: true });
  if (error) return [];
  return (data ?? []) as LinkSection[];
}

/** My clicks per link. Never throws: no numbers is fine. */
export async function loadLinkClicks(): Promise<LinkClicks> {
  try {
    const { data, error } = await rpc("my_link_clicks", {});
    if (error || !data) return { enabled: false, byLink: {} };
    const d = data as {
      enabled: boolean;
      links: { link_id: string; total: number; last_30: number }[];
    };
    const byLink: LinkClicks["byLink"] = {};
    for (const l of d.links ?? []) byLink[l.link_id] = { total: l.total, last_30: l.last_30 };
    return { enabled: !!d.enabled, byLink };
  } catch {
    return { enabled: false, byLink: {} };
  }
}

/** Saves new display_order numbers. Returns false if any row failed. */
export async function saveOrder(
  changed: { id: string; display_order: number }[],
): Promise<boolean> {
  if (changed.length === 0) return true;
  const results = await Promise.all(
    changed.map((c) =>
      supabase.from("social_links").update({ display_order: c.display_order }).eq("id", c.id),
    ),
  );
  return !results.some((r) => r.error);
}

export async function saveSectionOrder(
  changed: { id: string; display_order: number }[],
): Promise<boolean> {
  if (changed.length === 0) return true;
  const results = await Promise.all(
    changed.map((c) =>
      supabase.from("link_sections").update({ display_order: c.display_order }).eq("id", c.id),
    ),
  );
  return !results.some((r) => r.error);
}

export function clickLabel(c: { total: number; last_30: number } | undefined): string {
  const n = c?.total ?? 0;
  return `${n.toLocaleString()} ${n === 1 ? "click" : "clicks"}`;
}
