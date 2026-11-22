import { Link } from "@tanstack/react-router";
import { Bell, CheckCheck, Megaphone, MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  announcementHref,
  dismissAnnouncement,
  markRead,
  MESSAGES_PATH,
  useDashboardFeed,
  type Notification,
} from "@/lib/notifications/feed";

/** Announcements from Yooits, shown at the top of the dashboard until dismissed. */
export function DashboardAnnouncements() {
  const feed = useDashboardFeed();
  if (!feed.enabled || feed.announcements.length === 0) return null;
  return (
    <div className="mb-6 space-y-3">
      {feed.preview && (
        <p className="text-xs text-muted-foreground">
          Only admins see announcements and notifications until they're switched on in the Owner
          console.
        </p>
      )}
      {feed.announcements.map((a) => {
        const href = announcementHref(a.link_url);
        const external = href?.startsWith("https://");
        return (
          <div
            key={a.id}
            role="status"
            className="flex gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
          >
            <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{a.title}</div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
              {href && (
                <a
                  href={href}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
                  className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {a.link_label || "Learn more"}
                </a>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={`Dismiss ${a.title}`}
              onClick={() => dismissAnnouncement(a.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
};

function NotificationRow({ n }: { n: Notification }) {
  const inner = (
    <div className="flex gap-2">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-primary"}`}
        aria-label={n.read_at ? undefined : "Unread"}
      />
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${n.read_at ? "" : "font-semibold"}`}>{n.title}</div>
        {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
        <div className="mt-1 text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</div>
      </div>
    </div>
  );
  const onClick = () => markRead([n.id]);
  // link_path is always a Yooits path (the database refuses anything else).
  return (
    <li>
      {n.link_path ? (
        <a
          href={n.link_path}
          onClick={onClick}
          className="block rounded-lg px-2 py-2 hover:bg-muted"
        >
          {inner}
        </a>
      ) : (
        <button
          type="button"
          onClick={onClick}
          className="block w-full rounded-lg px-2 py-2 text-left hover:bg-muted"
        >
          {inner}
        </button>
      )}
    </li>
  );
}

/** The bell in the dashboard header: system notifications with read and unread. */
export function NotificationBell() {
  const feed = useDashboardFeed();
  if (!feed.enabled) return null;
  // Unread messages already show on the Messages button, so the badge counts notifications only.
  const badge = feed.unread;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={badge ? `Notifications, ${badge} unread` : "Notifications"}
        >
          <Bell className="h-4 w-4" />
          {badge > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-sm font-semibold">Notifications</span>
          {feed.unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => markRead()}
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
        {feed.dm_unread > 0 && (
          <div className="mx-1 my-1 flex items-center gap-2 rounded-lg bg-muted px-2 py-2 text-sm">
            <MessageCircle className="h-4 w-4 text-primary" aria-hidden />
            {MESSAGES_PATH ? (
              <Link to={MESSAGES_PATH} className="font-medium hover:underline">
                {feed.dm_unread === 1 ? "1 unread message" : `${feed.dm_unread} unread messages`}
              </Link>
            ) : (
              <span className="font-medium">
                {feed.dm_unread === 1 ? "1 unread message" : `${feed.dm_unread} unread messages`}
              </span>
            )}
          </div>
        )}
        {feed.notifications.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            You're all caught up.
          </p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {feed.notifications.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
