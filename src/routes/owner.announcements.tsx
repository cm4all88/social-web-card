import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { announcementHref } from "@/lib/notifications/feed";

/**
 * Announcements shown on people's dashboards, and the switch that turns
 * announcements and notifications on for everyone. Every change is logged.
 */
export const Route = createFileRoute("/owner/announcements")({
  component: AnnouncementsPage,
});

type Audience = "all" | "founding" | "plus";
type Row = {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  audience: Audience;
  starts_at: string;
  ends_at: string | null;
  archived_at: string | null;
  created_at: string;
  state: "live" | "scheduled" | "ended" | "archived";
  dismissals: number;
};
type Listing = { enabled: boolean; announcements: Row[] };

const AUDIENCES: { id: Audience; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "founding", label: "Founding Members" },
  { id: "plus", label: "Plus members" },
];
const STATE_LABEL: Record<Row["state"], string> = {
  live: "Live",
  scheduled: "Scheduled",
  ended: "Ended",
  archived: "Archived",
};

// Not in the generated types yet.
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc.bind(supabase) as unknown as (
      f: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn, args);

/** ISO time to the value a datetime-local input shows, in the viewer's time zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

type Draft = {
  id: string | null;
  title: string;
  body: string;
  link_url: string;
  link_label: string;
  audience: Audience;
  starts: string;
  ends: string;
};
const EMPTY_DRAFT: Draft = {
  id: null,
  title: "",
  body: "",
  link_url: "",
  link_label: "",
  audience: "all",
  starts: "",
  ends: "",
};

function AnnouncementsPage() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await rpc("owner_list_announcements");
    if (error) toast.error(error.message);
    setListing((data as Listing) ?? { enabled: false, announcements: [] });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setFlag = async (on: boolean) => {
    setBusy(true);
    const { error } = await rpc("owner_set_feature_flag", {
      _key: "dashboard_notifications",
      _enabled: on,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(
      on
        ? "Announcements and notifications are on for everyone"
        : "Turned off; only admins see them",
    );
    void load();
  };

  const linkProblem =
    draft.link_url.trim() && !announcementHref(draft.link_url.trim())
      ? "Use a Yooits path like /dashboard or a full https:// address."
      : null;

  const save = async () => {
    setBusy(true);
    const { error } = await rpc("owner_save_announcement", {
      _id: draft.id,
      _title: draft.title,
      _body: draft.body,
      _link_url: draft.link_url.trim() || null,
      _link_label: draft.link_label.trim() || null,
      _audience: draft.audience,
      _starts_at: fromLocalInput(draft.starts),
      _ends_at: fromLocalInput(draft.ends),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(draft.id ? "Announcement updated" : "Announcement saved");
    setDraft(EMPTY_DRAFT);
    void load();
  };

  const archive = async (r: Row, archived: boolean) => {
    setBusy(true);
    const { error } = await rpc("owner_archive_announcement", { _id: r.id, _archived: archived });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(archived ? "Archived" : "Restored");
    void load();
  };

  const edit = (r: Row) =>
    setDraft({
      id: r.id,
      title: r.title,
      body: r.body,
      link_url: r.link_url ?? "",
      link_label: r.link_label ?? "",
      audience: r.audience,
      starts: toLocalInput(r.starts_at),
      ends: toLocalInput(r.ends_at),
    });

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold">Announcements</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A card at the top of people's dashboards, until they dismiss it. No email is sent. Changes
        are recorded in the audit log.
      </p>

      {!listing ? (
        <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-border p-4">
            <div>
              <div className="font-medium">Show announcements and notifications</div>
              <p className="text-sm text-muted-foreground">
                {listing.enabled
                  ? "On: everyone sees the announcement card and the notification bell."
                  : "Off: only admins see them, so you can check them first."}
              </p>
            </div>
            <Switch
              checked={listing.enabled}
              disabled={busy}
              onCheckedChange={setFlag}
              aria-label="Show announcements and notifications"
            />
          </div>

          <form
            className="mt-6 space-y-4 rounded-2xl border border-border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="font-medium">{draft.id ? "Edit announcement" : "New announcement"}</div>
            <div className="space-y-1">
              <Label htmlFor="ann-title">Title</Label>
              <Input
                id="ann-title"
                value={draft.title}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ann-body">Message</Label>
              <Textarea
                id="ann-body"
                value={draft.body}
                maxLength={1000}
                rows={3}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ann-link">Link (optional)</Label>
                <Input
                  id="ann-link"
                  placeholder="/dashboard or https://…"
                  value={draft.link_url}
                  maxLength={500}
                  onChange={(e) => setDraft({ ...draft, link_url: e.target.value })}
                />
                {linkProblem && <p className="text-xs text-destructive">{linkProblem}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ann-label">Link text</Label>
                <Input
                  id="ann-label"
                  placeholder="Learn more"
                  value={draft.link_label}
                  maxLength={40}
                  disabled={!draft.link_url.trim()}
                  onChange={(e) => setDraft({ ...draft, link_label: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Who sees it</Label>
              <div className="flex flex-wrap gap-2">
                {AUDIENCES.map((a) => (
                  <Button
                    key={a.id}
                    type="button"
                    size="sm"
                    variant={draft.audience === a.id ? "default" : "outline"}
                    onClick={() => setDraft({ ...draft, audience: a.id })}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ann-start">Starts (blank for now)</Label>
                <Input
                  id="ann-start"
                  type="datetime-local"
                  value={draft.starts}
                  onChange={(e) => setDraft({ ...draft, starts: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ann-end">Ends (optional)</Label>
                <Input
                  id="ann-end"
                  type="datetime-local"
                  value={draft.ends}
                  onChange={(e) => setDraft({ ...draft, ends: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={busy || !draft.title.trim() || !draft.body.trim() || !!linkProblem}
              >
                {draft.id ? "Save changes" : "Save announcement"}
              </Button>
              {draft.id && (
                <Button type="button" variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>

          {listing.announcements.length === 0 ? (
            <p className="mt-6 text-muted-foreground">No announcements yet.</p>
          ) : (
            <ul className="mt-6 space-y-3">
              {listing.announcements.map((r) => (
                <li key={r.id} className="rounded-2xl border border-border p-4 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{r.title}</span>
                    <span className="rounded-full border border-border px-2 text-xs">
                      {STATE_LABEL[r.state]}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{r.body}</p>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {AUDIENCES.find((a) => a.id === r.audience)?.label} · from{" "}
                    {new Date(r.starts_at).toLocaleString()}
                    {r.ends_at && ` to ${new Date(r.ends_at).toLocaleString()}`} · dismissed by{" "}
                    {r.dismissals}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => edit(r)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => archive(r, r.state !== "archived")}
                    >
                      {r.state === "archived" ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
