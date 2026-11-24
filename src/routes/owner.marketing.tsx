import { ContentStudio } from "@/components/marketing/ContentStudio";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  addDrafts,
  isMissingFunction,
  rpc,
  type Account,
  type Campaign,
  type MarketingState,
  type Performance,
  type Post,
  type WeeklyData,
} from "@/components/marketing/api";
import {
  ClaimNotes,
  fromLocalInput,
  HistoryDialog,
  PostEditor,
  PublishDialog,
  toLocalInput,
} from "@/components/marketing/PostDialogs";
import { finalCaption, PostPreview } from "@/components/marketing/PostPreview";
import { hasBlockedClaim, postText } from "@/lib/marketing/claims";
import {
  AUDIENCE_IDS,
  AUDIENCES,
  FEATURE_IDS,
  FEATURES,
  type Audience,
  type FeatureId,
} from "@/lib/marketing/features";
import { conceptsToPosts, generateConcepts } from "@/lib/marketing/generator";
import { LAUNCH_CAMPAIGN, LAUNCH_CONCEPTS, launchPosts } from "@/lib/marketing/launch-plan";
import { slugify } from "@/lib/marketing/links";
import { PLATFORM_IDS, PLATFORMS, type PlatformId } from "@/lib/marketing/platforms";
import {
  KIND_LABELS,
  STATUS_LABELS,
  type DraftPost,
  type PostKind,
  type PostStatus,
} from "@/lib/marketing/types";
import { change, recommendations } from "@/lib/marketing/weekly";

/**
 * Marketing Center: campaigns, generated posts, approval, the publishing
 * calendar, social accounts and what campaign links bring in. Owner only
 * (the console layout checks the admin role, and every database function
 * checks it again).
 */
export const Route = createFileRoute("/owner/marketing")({
  component: MarketingPage,
});

const STATUS_TONE: Record<PostStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-sky-500/15 text-sky-400",
  scheduled: "bg-violet-500/15 text-violet-300",
  publishing: "bg-amber-500/20 text-amber-400",
  published: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-destructive/20 text-destructive",
  archived: "bg-muted text-muted-foreground line-through",
};
const ORDER: PostStatus[] = [
  "publishing",
  "failed",
  "draft",
  "approved",
  "scheduled",
  "published",
  "archived",
];

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "No time set";

function Badge({ status }: { status: PostStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function MarketingPage() {
  const [state, setState] = useState<MarketingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState("queue");
  const [editing, setEditing] = useState<Post | null>(null);
  const [publishing, setPublishing] = useState<Post | null>(null);
  const [history, setHistory] = useState<Post | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await rpc<MarketingState>("owner_marketing_state");
    if (error)
      setLoadError(
        isMissingFunction(error)
          ? "The Marketing Center's database part isn't switched on yet."
          : error.message,
      );
    else {
      setLoadError(null);
      setState(data);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const campaigns = state?.campaigns ?? [];
  const slugOf = useCallback(
    (id: string | null) => campaigns.find((c) => c.id === id)?.slug,
    [campaigns],
  );
  const audienceOf = useCallback(
    (id: string | null) => campaigns.find((c) => c.id === id)?.audiences?.[0] ?? "everyone",
    [campaigns],
  );

  const setStatus = useCallback(
    async (ids: string[], to: PostStatus, note?: string) => {
      const { data, error } = await rpc<{
        changed: number;
        refused: { title: string; reason: string }[];
      }>("owner_marketing_set_status", {
        _ids: ids,
        _to: to,
        _note: note ?? null,
      });
      if (error) return toast.error(error.message);
      if (data.changed)
        toast.success(
          `${data.changed} post${data.changed === 1 ? "" : "s"}: ${STATUS_LABELS[to].toLowerCase()}`,
        );
      if (data.refused.length)
        toast.message(
          `${data.refused.length} not changed: "${data.refused[0].title}" ${data.refused[0].reason}`,
        );
      load();
    },
    [load],
  );

  if (loadError) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Marketing</h1>
        <p className="text-sm text-destructive">{loadError}</p>
      </div>
    );
  }
  if (!state) return <Loader2 className="h-5 w-5 animate-spin" />;

  const counts = state.counts;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Marketing</h1>
        <p className="text-sm text-muted-foreground">
          Posts only talk about features that work today. Nothing goes out until you approve it, and
          a post counts as live only once its address is checked.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {ORDER.filter((s) => s !== "archived").map((s) => (
          <span key={s} className={`rounded-full px-3 py-1 ${STATUS_TONE[s]}`}>
            {STATUS_LABELS[s]}: {counts[s] ?? 0}
          </span>
        ))}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="studio">Content studio</TabsTrigger>
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="weekly">Weekly summary</TabsTrigger>
        </TabsList>
        <TabsContent value="queue">
          <Queue
            state={state}
            slugOf={slugOf}
            setStatus={setStatus}
            onEdit={setEditing}
            onPublish={setPublishing}
            onHistory={setHistory}
          />
        </TabsContent>
        <TabsContent value="calendar">
          <CalendarView posts={state.posts} onOpen={setEditing} onPublish={setPublishing} />
        </TabsContent>
        <TabsContent value="studio">
          <ContentStudio campaigns={campaigns} onAdded={load} />
        </TabsContent>
        <TabsContent value="generate">
          <Generate
            campaigns={campaigns}
            onAdded={() => {
              load();
              setTab("queue");
            }}
          />
        </TabsContent>
        <TabsContent value="accounts">
          <Accounts accounts={state.accounts} onSaved={load} />
        </TabsContent>
        <TabsContent value="analytics">
          <Analytics />
        </TabsContent>
        <TabsContent value="weekly">
          <WeeklySummary />
        </TabsContent>
      </Tabs>
      <PostEditor
        post={editing}
        slug={slugOf(editing?.campaign_id ?? null)}
        audience={audienceOf(editing?.campaign_id ?? null)}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
      <PublishDialog
        post={publishing}
        slug={slugOf(publishing?.campaign_id ?? null)}
        onClose={() => setPublishing(null)}
        onDone={() => {
          setPublishing(null);
          load();
        }}
      />
      <HistoryDialog post={history} onClose={() => setHistory(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------
function Queue({
  state,
  slugOf,
  setStatus,
  onEdit,
  onPublish,
  onHistory,
}: {
  state: MarketingState;
  slugOf: (id: string | null) => string | undefined;
  setStatus: (ids: string[], to: PostStatus, note?: string) => Promise<unknown>;
  onEdit: (p: Post) => void;
  onPublish: (p: Post) => void;
  onHistory: (p: Post) => void;
}) {
  const [status, setStatusFilter] = useState<PostStatus | "all" | "due">("all");
  const [platform, setPlatform] = useState<PlatformId | "all">("all");
  const [campaign, setCampaign] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const now = Date.now();
  const isDue = (p: Post) =>
    p.status === "publishing" ||
    (p.status === "scheduled" && !!p.scheduled_at && new Date(p.scheduled_at).getTime() <= now);

  const posts = useMemo(
    () =>
      state.posts
        .filter((p) =>
          status === "all"
            ? p.status !== "archived"
            : status === "due"
              ? isDue(p)
              : p.status === status,
        )
        .filter((p) => platform === "all" || p.platform === platform)
        .filter((p) => campaign === "all" || p.campaign_id === campaign)
        .filter((p) => inRange(p.scheduled_at, from, to)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.posts, status, platform, campaign, from, to],
  );
  const chosen = posts.filter((p) => selected.has(p.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const bulk = async (to: PostStatus) => {
    let ids = chosen.map((p) => p.id);
    if (to === "approved") {
      const blocked = chosen.filter((p) => hasBlockedClaim(postText(p)));
      if (blocked.length)
        toast.message(`${blocked.length} left as draft: they mention something that isn't live.`);
      ids = chosen.filter((p) => !hasBlockedClaim(postText(p))).map((p) => p.id);
    }
    if (!ids.length) return;
    await setStatus(ids, to);
    setSelected(new Set());
  };
  const dueCount = state.posts.filter(isDue).length;
  const exportList = chosen.length ? chosen : posts;
  const runExport = async () => {
    if (!exportList.length || exporting) return;
    setExporting(`0 of ${exportList.length}`);
    try {
      const { exportForReview } = await import("@/components/marketing/exportPosts");
      await exportForReview(exportList, slugOf, (d, t) => setExporting(`${d} of ${t}`));
      toast.success(`Exported ${exportList.length} post${exportList.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-3">
      {dueCount > 0 && (
        <button
          className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm"
          onClick={() => setStatusFilter("due")}
        >
          {dueCount} post{dueCount === 1 ? " is" : "s are"} due to go out. Show them.
        </button>
      )}
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <Select
          label="Status"
          value={status}
          onChange={(v) => setStatusFilter(v as typeof status)}
          options={[
            ["all", "All but archived"],
            ["due", "Due now"],
            ...ORDER.map((s) => [s, STATUS_LABELS[s]] as [string, string]),
          ]}
        />
        <Select
          label="Platform"
          value={platform}
          onChange={(v) => setPlatform(v as typeof platform)}
          options={[
            ["all", "All"],
            ...PLATFORM_IDS.map((p) => [p, PLATFORMS[p].label] as [string, string]),
          ]}
        />
        <Select
          label="Campaign"
          value={campaign}
          onChange={setCampaign}
          options={[
            ["all", "All"],
            ...state.campaigns.map((c) => [c.id, c.name] as [string, string]),
          ]}
        />
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">From</span>
          <Input
            type="date"
            className="h-9 w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">To</span>
          <Input
            type="date"
            className="h-9 w-40"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto h-9"
          disabled={!exportList.length || !!exporting}
          onClick={runExport}
          title="Download every post shown (or just the ones you ticked) as graphics, a review page and a spreadsheet. Changes nothing."
        >
          {exporting ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Exporting {exporting}
            </>
          ) : (
            <>
              <Download className="mr-1 h-4 w-4" /> Export for review ({exportList.length})
            </>
          )}
        </Button>
      </div>
      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 text-sm">
          <span>{chosen.length} selected</span>
          <Button size="sm" onClick={() => bulk("approved")}>
            Approve
          </Button>
          <Button size="sm" variant="secondary" onClick={() => bulk("scheduled")}>
            Schedule at their times
          </Button>
          <Button size="sm" variant="ghost" onClick={() => bulk("draft")}>
            Back to draft
          </Button>
          <Button size="sm" variant="ghost" onClick={() => bulk("archived")}>
            Archive
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      {posts.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {state.posts.length === 0
            ? "No posts yet. Load the launch plan from the Generate tab."
            : "Nothing matches these filters."}
        </p>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={chosen.length === posts.length}
              onCheckedChange={(c) => setSelected(c ? new Set(posts.map((p) => p.id)) : new Set())}
            />{" "}
            Select all {posts.length}
          </label>
          {posts.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              slug={slugOf(p.campaign_id)}
              due={isDue(p)}
              open={open === p.id}
              selected={selected.has(p.id)}
              onToggle={() => toggle(p.id)}
              onOpen={() => setOpen(open === p.id ? null : p.id)}
              setStatus={setStatus}
              onEdit={() => onEdit(p)}
              onPublish={() => onPublish(p)}
              onHistory={() => onHistory(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PostRow({
  post: p,
  slug,
  due,
  open,
  selected,
  onToggle,
  onOpen,
  setStatus,
  onEdit,
  onPublish,
  onHistory,
}: {
  post: Post;
  slug: string | undefined;
  due: boolean;
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  setStatus: (ids: string[], to: PostStatus, note?: string) => Promise<unknown>;
  onEdit: () => void;
  onPublish: () => void;
  onHistory: () => void;
}) {
  const blocked = hasBlockedClaim(postText(p));
  const [failNote, setFailNote] = useState("");
  const canPost = ["approved", "scheduled", "publishing", "failed"].includes(p.status);
  return (
    <div className={`rounded-lg border ${due ? "border-amber-500/50" : "border-border"} bg-card`}>
      <div className="flex items-start gap-3 p-3">
        <Checkbox checked={selected} onCheckedChange={onToggle} className="mt-1" />
        <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold">{PLATFORMS[p.platform].label}</span>
            <Badge status={p.status} />
            <span className="text-muted-foreground">{KIND_LABELS[p.kind]}</span>
            <span className="text-muted-foreground">{when(p.scheduled_at)}</span>
            {blocked && <span className="text-destructive">Needs rewording</span>}
            {p.attempts > 0 && <span className="text-muted-foreground">Retry {p.attempts}</span>}
          </div>
          <p className="mt-1 truncate text-sm font-medium">{p.title}</p>
          <p className="truncate text-xs text-muted-foreground">{p.caption}</p>
          {p.last_error && p.status === "failed" && (
            <p className="text-xs text-destructive">{p.last_error}</p>
          )}
        </button>
      </div>
      {open && (
        <div className="grid gap-4 border-t border-border p-3 md:grid-cols-2">
          <PostPreview post={p} slug={slug} />
          <div className="space-y-3 text-sm">
            <ClaimNotes text={postText(p)} />
            {p.status === "published" && p.external_url && (
              <p>
                Live at{" "}
                <a
                  className="text-primary underline"
                  href={p.external_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.external_url}
                </a>
                <br />
                <span className="text-xs text-muted-foreground">
                  {p.verification === "owner_confirmed"
                    ? "Confirmed by you"
                    : "Checked with the platform"}{" "}
                  {p.verified_at && `on ${when(p.verified_at)}`}. Campaign code {p.code}.
                </span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {p.status !== "published" && p.status !== "publishing" && (
                <Button size="sm" variant="secondary" onClick={onEdit}>
                  Edit
                </Button>
              )}
              {p.status === "draft" && (
                <Button size="sm" disabled={blocked} onClick={() => setStatus([p.id], "approved")}>
                  Approve
                </Button>
              )}
              {p.status === "approved" && (
                <Button
                  size="sm"
                  disabled={!p.scheduled_at}
                  onClick={() => setStatus([p.id], "scheduled")}
                >
                  Schedule for {when(p.scheduled_at)}
                </Button>
              )}
              {p.status === "scheduled" && (
                <Button size="sm" variant="ghost" onClick={() => setStatus([p.id], "approved")}>
                  Unschedule
                </Button>
              )}
              {canPost && (
                <Button size="sm" onClick={onPublish}>
                  Post it
                </Button>
              )}
              {p.status === "failed" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setStatus([p.id], "scheduled")}
                >
                  Retry
                </Button>
              )}
              {["approved", "scheduled", "failed"].includes(p.status) && (
                <Button size="sm" variant="ghost" onClick={() => setStatus([p.id], "draft")}>
                  Back to draft
                </Button>
              )}
              {["draft", "approved", "scheduled", "failed"].includes(p.status) && (
                <Button size="sm" variant="ghost" onClick={() => setStatus([p.id], "archived")}>
                  Archive
                </Button>
              )}
              {p.status === "archived" && (
                <Button size="sm" variant="ghost" onClick={() => setStatus([p.id], "draft")}>
                  Restore to draft
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onHistory}>
                History
              </Button>
            </div>
            {p.status === "publishing" && (
              <div className="flex gap-2">
                <Input
                  placeholder="What went wrong (optional)"
                  value={failNote}
                  onChange={(e) => setFailNote(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setStatus([p.id], "failed", failNote || undefined)}
                >
                  Mark failed
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Is the post's time within the chosen days (inclusive, local time)? Unscheduled posts only match an open range. */
function inRange(at: string | null, from: string, to: string) {
  if (!from && !to) return true;
  if (!at) return false;
  const t = new Date(at).getTime();
  if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && t >= new Date(`${to}T00:00:00`).getTime() + 86_400_000) return false;
  return true;
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <select
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
function CalendarView({
  posts,
  onOpen,
  onPublish,
}: {
  posts: Post[];
  onOpen: (p: Post) => void;
  onPublish: (p: Post) => void;
}) {
  const first = posts
    .filter((p) => p.scheduled_at && p.status !== "archived")
    .map((p) => new Date(p.scheduled_at!))
    .sort((a, b) => +a - +b)[0];
  const [month, setMonth] = useState(() => {
    const d = first && first > new Date() ? first : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - start.getDay());
    return Array.from(
      { length: 42 },
      (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
    );
  }, [month]);
  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts) {
      if (!p.scheduled_at || p.status === "archived") continue;
      const d = new Date(
        p.status === "published" && p.published_at ? p.published_at : p.scheduled_at,
      );
      const k = d.toDateString();
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    for (const list of m.values())
      list.sort((a, b) => +new Date(a.scheduled_at!) - +new Date(b.scheduled_at!));
    return m;
  }, [posts]);
  const today = new Date().toDateString();
  const unscheduled = posts.filter((p) => !p.scheduled_at && p.status !== "archived").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="font-semibold">
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h2>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const list = byDay.get(d.toDateString()) ?? [];
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div
              key={d.toISOString()}
              className={`min-h-24 rounded-md border p-1 ${inMonth ? "border-border bg-card" : "border-transparent opacity-40"} ${d.toDateString() === today ? "ring-1 ring-primary" : ""}`}
            >
              <div className="text-right text-[11px] text-muted-foreground">{d.getDate()}</div>
              <div className="space-y-0.5">
                {list.slice(0, 4).map((p) => (
                  <button
                    key={p.id}
                    title={`${PLATFORMS[p.platform].label}: ${p.title} (${STATUS_LABELS[p.status]})`}
                    onClick={() =>
                      ["scheduled", "publishing", "failed"].includes(p.status)
                        ? onPublish(p)
                        : onOpen(p)
                    }
                    className={`block w-full truncate rounded px-1 text-left text-[10px] ${STATUS_TONE[p.status]}`}
                  >
                    {PLATFORMS[p.platform].label.slice(0, 2)} · {p.title.replace(/^Day \d+: /, "")}
                  </button>
                ))}
                {list.length > 4 && (
                  <div className="text-[10px] text-muted-foreground">+{list.length - 4} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Tap a post to edit it, or to post it once it's scheduled.{" "}
        {unscheduled > 0 &&
          `${unscheduled} post${unscheduled === 1 ? " has" : "s have"} no time yet and aren't shown.`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------
function Generate({ campaigns, onAdded }: { campaigns: Campaign[]; onAdded: () => void }) {
  const launch = campaigns.find((c) => c.slug === LAUNCH_CAMPAIGN.slug);
  const [busy, setBusy] = useState(false);
  const [campaignId, setCampaignId] = useState<string>(campaigns[0]?.id ?? "new");
  const [newName, setNewName] = useState("");
  const [audience, setAudience] = useState<Audience>("creators");
  const [features, setFeatures] = useState<FeatureId[]>([]);
  const [kinds, setKinds] = useState<PostKind[]>(["tutorial", "demo", "tip"]);
  const [platforms, setPlatforms] = useState<PlatformId[]>(["instagram", "tiktok", "x"]);
  const [count, setCount] = useState(5);
  const [start, setStart] = useState(
    () => toLocalInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 10) + "T11:00",
  );
  const [preview, setPreview] = useState<DraftPost[]>([]);
  const launchCount = useMemo(() => launchPosts().length, []);

  const loadLaunch = async () => {
    setBusy(true);
    try {
      const { data: id, error } = await rpc<string>("owner_marketing_save_campaign", {
        _c: LAUNCH_CAMPAIGN,
      });
      if (error) throw new Error(error.message);
      const r = await addDrafts(id, launchPosts());
      toast.success(
        `${r.added} launch posts added as drafts${r.skipped ? `, ${r.skipped} already there` : ""}.`,
      );
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load the plan.");
    } finally {
      setBusy(false);
    }
  };

  const generate = () => {
    const concepts = generateConcepts({
      audience,
      features,
      kinds,
      platforms,
      count,
      seed: Date.now(),
    });
    const base = fromLocalInput(start) ? new Date(fromLocalInput(start)!) : new Date();
    const posts = conceptsToPosts(concepts, platforms).map((p, i) => ({
      ...p,
      scheduled_at: new Date(
        base.getTime() + Math.floor(i / platforms.length) * 86400000,
      ).toISOString(),
    }));
    setPreview(posts);
  };

  const save = async () => {
    setBusy(true);
    try {
      let id = campaignId;
      if (id === "new") {
        const name = newName.trim();
        if (!name) throw new Error("Give the new campaign a name.");
        const { data, error } = await rpc<string>("owner_marketing_save_campaign", {
          _c: { name, slug: slugify(name), audiences: [audience], starts_on: start.slice(0, 10) },
        });
        if (error) throw new Error(error.message);
        id = data;
      }
      const r = await addDrafts(id, preview);
      toast.success(
        `${r.added} drafts added${r.skipped ? `, ${r.skipped} were duplicates and skipped` : ""}.`,
      );
      setPreview([]);
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the drafts.");
    } finally {
      setBusy(false);
    }
  };

  const toggleIn = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">30-day launch plan</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {LAUNCH_CONCEPTS.length} days from Nov 25 to Dec 24: tutorials, demos, announcements and
          invitations for creators, streamers, artists, small businesses and everyone, with holiday
          wishlists as the seasonal hook. {launchCount} posts across Instagram, TikTok, X, Facebook,
          YouTube Shorts and Snapchat, each at a set Pacific time. They load as drafts.
        </p>
        <Button className="mt-3" disabled={busy} onClick={loadLaunch}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{" "}
          {launch ? "Add any missing launch posts" : "Load the launch plan as drafts"}
        </Button>
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">Make new posts</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Select
            label="Campaign"
            value={campaignId}
            onChange={setCampaignId}
            options={[
              ...campaigns.map((c) => [c.id, c.name] as [string, string]),
              ["new", "New campaign…"],
            ]}
          />
          {campaignId === "new" && (
            <label className="space-y-1">
              <span className="block text-xs text-muted-foreground">New campaign name</span>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. January creators"
              />
            </label>
          )}
          <Select
            label="Who it's for"
            value={audience}
            onChange={(v) => setAudience(v as Audience)}
            options={AUDIENCE_IDS.map((a) => [a, AUDIENCES[a].label] as [string, string])}
          />
        </div>
        <Chips
          label="Features (blank: the usual ones for this audience)"
          all={FEATURE_IDS}
          on={features}
          name={(f) => FEATURES[f].name}
          toggle={(f) => setFeatures(toggleIn(features, f))}
        />
        <Chips
          label="Kinds of post"
          all={Object.keys(KIND_LABELS) as PostKind[]}
          on={kinds}
          name={(k) => KIND_LABELS[k]}
          toggle={(k) => setKinds(toggleIn(kinds, k))}
        />
        <Chips
          label="Platforms"
          all={PLATFORM_IDS}
          on={platforms}
          name={(p) => PLATFORMS[p].label}
          toggle={(p) => setPlatforms(toggleIn(platforms, p))}
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Ideas (one per day)</span>
            <Input
              type="number"
              min={1}
              max={30}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              className="w-24"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">First post</span>
            <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <Button variant="secondary" disabled={!platforms.length} onClick={generate}>
            {preview.length ? "Write a different set" : "Write posts"}
          </Button>
        </div>
        {preview.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm">
              {preview.length} posts written. Edit any of them after adding; each still needs your
              approval.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {preview.slice(0, 12).map((p, i) => (
                <div key={i} className="space-y-1 rounded-md border border-border p-2 text-xs">
                  <div className="font-semibold">
                    {PLATFORMS[p.platform].label} · {KIND_LABELS[p.kind]} ·{" "}
                    {when(p.scheduled_at ?? null)}
                  </div>
                  <p className="whitespace-pre-wrap">
                    {finalCaption(
                      { ...p, code: "preview", landing_path: p.landing_path },
                      "preview",
                    )}
                  </p>
                  <ClaimNotes text={postText(p)} />
                </div>
              ))}
            </div>
            {preview.length > 12 && (
              <p className="text-xs text-muted-foreground">and {preview.length - 12} more.</p>
            )}
            <Button disabled={busy} onClick={save}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Add {preview.length} as drafts
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          The writer only uses the live features listed here. Each post's editor has "Rewrite with
          AI" for a second take; it's checked against the same rules.
        </p>
      </section>
    </div>
  );
}

function Chips<T extends string>({
  label,
  all,
  on,
  name,
  toggle,
}: {
  label: string;
  all: T[];
  on: T[];
  name: (v: T) => string;
  toggle: (v: T) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">
        {all.map((v) => (
          <button
            key={v}
            onClick={() => toggle(v)}
            className={`rounded-full border px-3 py-1 text-xs ${on.includes(v) ? "border-primary bg-primary/20" : "border-border"}`}
          >
            {name(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
function Accounts({ accounts, onSaved }: { accounts: Account[]; onSaved: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        No social account is connected by API yet, so every post goes out by hand from the Queue.
        Save each handle here so Yooits.me can check a live post was made by your account.
      </p>
      {PLATFORM_IDS.map((id) => (
        <AccountCard
          key={id}
          account={accounts.find((a) => a.platform === id)}
          platform={id}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}

function AccountCard({
  account,
  platform,
  onSaved,
}: {
  account?: Account;
  platform: PlatformId;
  onSaved: () => void;
}) {
  const spec = PLATFORMS[platform];
  const [handle, setHandle] = useState(account?.handle ?? "");
  const [url, setUrl] = useState(account?.profile_url ?? "");
  const [notes, setNotes] = useState(account?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await rpc("owner_marketing_save_account", {
      _platform: platform,
      _handle: handle,
      _profile_url: url,
      _notes: notes,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${spec.label} saved`);
    onSaved();
  };
  const tone =
    spec.api.status === "possible"
      ? "text-emerald-400"
      : spec.api.status === "restricted"
        ? "text-amber-400"
        : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{spec.label}</h3>
        <span className="text-xs text-muted-foreground">
          {account?.has_token ? "Connected" : "Posting by hand"}
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <Input placeholder="@handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
        <Input
          placeholder={`Profile address on ${spec.label}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button size="sm" className="mt-2" disabled={busy} onClick={save}>
        Save
      </Button>
      <div className="mt-3 space-y-1 text-xs">
        <p className={tone}>
          API publishing:{" "}
          {spec.api.status === "possible"
            ? "possible"
            : spec.api.status === "restricted"
              ? "restricted"
              : "not available yet"}
          . {spec.api.summary}
        </p>
        <p className="text-muted-foreground">Cost: {spec.api.cost}</p>
        <p className="text-muted-foreground">To connect it: {spec.api.needs.join("; ")}.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
function Analytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Performance | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    rpc<Performance>("owner_marketing_performance", { _days: days }).then(({ data, error }) => {
      if (error)
        setNote(
          isMissingFunction(error)
            ? "Campaign analytics couldn't load because a database function is missing. Reload the page to try again."
            : error.message,
        );
      else {
        setNote(null);
        setData(data);
      }
    });
  }, [days]);
  if (note) return <p className="text-sm text-muted-foreground">{note}</p>;
  if (!data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const t = data.totals;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {[7, 14, 30, 90].map((d) => (
          <Button
            key={d}
            size="sm"
            variant={d === days ? "default" : "ghost"}
            onClick={() => setDays(d)}
          >
            {d} days
          </Button>
        ))}
      </div>
      {!data.analytics_enabled && (
        <p className="text-sm text-amber-400">
          Site analytics are switched off, so visits aren't being counted.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Campaign visits" value={data.campaign_visits} />
        <Stat
          label="Sign-ups from campaigns"
          value={t.attributed_signups}
          sub={`of ${t.signups} sign-ups`}
        />
        <Stat label="Sign-ups from someone's page" value={t.referred_signups} />
        <Stat label="Profiles completed" value={t.profile_completions} sub="all new sign-ups" />
        <Stat label="Paid conversions" value={t.paid} sub="live Plus" />
      </div>
      <Table
        title="Campaigns"
        head={["Campaign", "Visits", "Claim taps", "Sign-ups", "Completed", "Paid", "Posts live"]}
        rows={data.campaigns.map((c) => [
          c.name,
          c.visits,
          c.signup_clicks,
          c.signups,
          c.completions,
          c.paid,
          c.published,
        ])}
      />
      <Table
        title="Platforms"
        head={["Platform", "Visits", "Sign-ups", "Completed", "Paid", "Posts live"]}
        rows={data.platforms.map((p) => [
          PLATFORMS[p.platform].label,
          p.visits,
          p.signups,
          p.completions,
          p.paid,
          p.published,
        ])}
      />
      <Table
        title="Posts live in this period"
        head={["Post", "Platform", "Sign-ups", "Completed", "Paid"]}
        rows={data.posts.map((p) => [
          <a
            key={p.id}
            href={p.external_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline"
          >
            {p.title} <ExternalLink className="h-3 w-3" />
          </a>,
          PLATFORMS[p.platform].label,
          p.signups,
          p.completions,
          p.paid,
        ])}
      />
      {data.referrers.length > 0 && (
        <Table
          title="Pages that brought sign-ups"
          head={["Page", "Sign-ups"]}
          rows={data.referrers.map((r) => [`yooits.me/${r.username}`, r.signups])}
        />
      )}
      <p className="text-xs text-muted-foreground">
        A sign-up counts for a campaign when that person first arrived through one of its links in
        the 30 days before signing up. Views and clicks only count while site analytics are on.
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Table({
  title,
  head,
  rows,
}: {
  title: string;
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {head.map((h) => (
                  <th key={h} className="py-1 pr-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {r.map((c, j) => (
                    <td key={j} className="py-1 pr-3">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly summary
// ---------------------------------------------------------------------------
function WeeklySummary() {
  const [w, setW] = useState<WeeklyData | null>(null);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      rpc<WeeklyData>("owner_marketing_weekly"),
      rpc<Performance>("owner_marketing_performance", { _days: 7 }),
    ]).then(([a, b]) => {
      if (a.error)
        setNote(
          isMissingFunction(a.error)
            ? "The weekly summary couldn't load because a database function is missing. Reload the page to try again."
            : a.error.message,
        );
      else setW(a.data);
      if (!b.error) setPerf(b.data);
    });
  }, []);
  if (note) return <p className="text-sm text-muted-foreground">{note}</p>;
  if (!w) return <Loader2 className="h-5 w-5 animate-spin" />;
  const recs = recommendations(w, perf?.platforms ?? []);
  const line = (label: string, now: number, before?: number) => (
    <li className="flex justify-between border-b border-border py-1">
      <span>{label}</span>
      <span>
        <b>{now}</b>{" "}
        {before !== undefined && (
          <span className="text-xs text-muted-foreground">({change(now, before)})</span>
        )}
      </span>
    </li>
  );
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold">Last 7 days</h3>
        <ul className="mt-2 text-sm">
          {line("Posts live", w.this.published, w.last.published)}
          {line("Visits from campaign links", w.this.campaign_visits, w.last.campaign_visits)}
          {line("Home page visits", w.this.home_views, w.last.home_views)}
          {line('"Claim your link" taps', w.this.signup_clicks, w.last.signup_clicks)}
          {line("Sign-ups", w.this.signups, w.last.signups)}
          {line("Sign-ups from campaigns", w.this.attributed_signups, w.last.attributed_signups)}
          {line("Profiles completed", w.this.profile_completions)}
          {line("Posts failed", w.this.failed)}
        </ul>
        {w.sources.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Top sources:{" "}
            {w.sources
              .slice(0, 5)
              .map((s) => `${s.source ?? "direct"} (${s.visits})`)
              .join(", ")}
          </p>
        )}
      </div>
      <div>
        <h3 className="text-sm font-semibold">Recommendations</h3>
        <ul className="mt-2 list-disc space-y-2 pl-4 text-sm">
          {recs.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          You get a bell notification every Monday when a new week is ready.
        </p>
      </div>
    </div>
  );
}
