/**
 * The dashboard's announcements and notifications, read with one call to
 * my_dashboard_feed() and shared by the banner and the bell, so both stay in
 * step after a dismiss or a mark-read.
 */
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  starts_at: string;
};

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link_path: string | null;
  read_at: string | null;
  created_at: string;
};

export type DashboardFeed = {
  enabled: boolean;
  /** True when only admins can see this yet (the feature flag is off). */
  preview?: boolean;
  announcements: Announcement[];
  notifications: Notification[];
  unread: number;
  dm_unread: number;
};

/** Where the unread-messages line in the bell goes (the Messages button has its own badge). */
export const MESSAGES_PATH: string | null = "/messages";

const EMPTY: DashboardFeed = {
  enabled: false,
  announcements: [],
  notifications: [],
  unread: 0,
  dm_unread: 0,
};

type Rpc = (
  f: string,
  a?: object,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const rpc = (fn: string, args?: object) => (supabase as unknown as { rpc: Rpc }).rpc(fn, args);

let state: DashboardFeed = EMPTY;
let lastLoad = 0;
const listeners = new Set<() => void>();
const set = (next: DashboardFeed) => {
  state = next;
  listeners.forEach((l) => l());
};

export async function refreshFeed(): Promise<void> {
  const { data, error } = await rpc("my_dashboard_feed");
  // Never break the dashboard over this: on an error (or before the database
  // change is in place) the banner and bell simply don't show.
  if (error || !data) return;
  set({ ...EMPTY, ...(data as DashboardFeed) });
}

export async function dismissAnnouncement(id: string): Promise<void> {
  set({ ...state, announcements: state.announcements.filter((a) => a.id !== id) });
  const { error } = await rpc("dismiss_announcement", { _id: id });
  if (error) await refreshFeed();
}

/** Marks the given notifications read, or all of them when ids is omitted. */
export async function markRead(ids?: string[]): Promise<void> {
  const now = new Date().toISOString();
  const hit = (n: Notification) => !n.read_at && (!ids || ids.includes(n.id));
  const changed = state.notifications.filter(hit).length;
  if (!changed) return;
  set({
    ...state,
    notifications: state.notifications.map((n) => (hit(n) ? { ...n, read_at: now } : n)),
    unread: Math.max(0, state.unread - changed),
  });
  const { error } = await rpc("mark_notifications_read", { _ids: ids ?? null });
  if (error) await refreshFeed();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The current feed. The first component to mount loads it, and it reloads when the tab is shown again. */
export function useDashboardFeed(): DashboardFeed {
  useEffect(() => {
    // The banner and the bell mount together; load once for both.
    const load = () => {
      if (Date.now() - lastLoad < 2000) return;
      lastLoad = Date.now();
      refreshFeed();
    };
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}

/** A safe href for an announcement link: a Yooits.me path or an https address. */
export function announcementHref(url: string | null): string | undefined {
  if (!url) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f]/.test(url)) return undefined;
  if (url === "/" || /^\/[^/\\]/.test(url)) return url;
  if (/^https:\/\/[^/@\\]+(\/|$)/i.test(url)) return url;
  return undefined;
}
