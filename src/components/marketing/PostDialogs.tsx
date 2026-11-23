import { useEffect, useState } from "react";
import { Copy, Download, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { checkClaims, postText } from "@/lib/marketing/claims";
import { marketingAiRewrite, marketingVerifyPost } from "@/lib/marketing/functions";
import { downloadGraphic } from "@/lib/marketing/graphics";
import { PLATFORMS, graphicSize, urlMatchesPlatform } from "@/lib/marketing/platforms";
import type { GraphicSpec, GraphicTemplate, GraphicTheme } from "@/lib/marketing/types";
import { STATUS_LABELS } from "@/lib/marketing/types";
import { rpc, type HistoryRow, type Post } from "./api";
import { finalCaption, hasGraphic, PostPreview } from "./PostPreview";

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
export { toLocalInput, fromLocalInput };

export function ClaimNotes({ text }: { text: string }) {
  const issues = checkClaims(text);
  if (!issues.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {issues.map((i, n) => (
        <li key={n} className={i.level === "blocked" ? "text-destructive" : "text-amber-500"}>
          {i.level === "blocked" ? "Can't approve: " : "Check: "}"{i.phrase}". {i.why}
        </li>
      ))}
    </ul>
  );
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy. Select the text and copy it yourself.");
  }
}

// ---------------------------------------------------------------------------
// Edit a post
// ---------------------------------------------------------------------------
export function PostEditor({
  post,
  slug,
  audience,
  onClose,
  onSaved,
}: {
  post: Post | null;
  slug: string | null | undefined;
  audience: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Post | null>(post);
  const [saving, setSaving] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  useEffect(() => setDraft(post), [post]);
  if (!draft || !post) return null;
  const g: GraphicSpec = hasGraphic(draft.graphic)
    ? draft.graphic
    : { template: "headline", theme: "night", headline: "" };
  const setG = (patch: Partial<GraphicSpec>) => setDraft({ ...draft, graphic: { ...g, ...patch } });
  const locked = post.status === "publishing" || post.status === "published";
  const wordsChanged =
    draft.caption !== post.caption ||
    draft.script !== post.script ||
    JSON.stringify(draft.hashtags) !== JSON.stringify(post.hashtags) ||
    JSON.stringify(draft.graphic) !== JSON.stringify(post.graphic);

  const save = async () => {
    setSaving(true);
    const { error } = await rpc("owner_marketing_update_post", {
      _id: post.id,
      _patch: {
        title: draft.title,
        caption: draft.caption,
        hashtags: draft.hashtags,
        script: draft.script ?? "",
        graphic: draft.graphic,
        landing_path: draft.landing_path,
        scheduled_at: draft.scheduled_at ?? "",
      },
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(
      wordsChanged && post.status !== "draft"
        ? "Saved. Changed words send it back to draft for approval."
        : "Saved",
    );
    onSaved();
  };

  const rewrite = async () => {
    setRewriting(true);
    try {
      const r = await marketingAiRewrite({
        data: {
          platform: draft.platform,
          caption: draft.caption,
          features: draft.features,
          audience,
          kind: draft.kind,
        },
      });
      if (r.ok) {
        setDraft({ ...draft, caption: r.caption });
        toast.success("Rewritten. Read it over before saving.");
      } else toast.message(r.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't rewrite.");
    } finally {
      setRewriting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit post</DialogTitle>
          <DialogDescription>
            {PLATFORMS[draft.platform].label} · {STATUS_LABELS[post.status]}
            {locked && " · this post is going out or live, so it can't be edited"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <Label>Title (only you see this, except on YouTube)</Label>
              <Input
                value={draft.title}
                maxLength={120}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>Caption</Label>
                <Button size="sm" variant="ghost" disabled={locked || rewriting} onClick={rewrite}>
                  {rewriting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}{" "}
                  Rewrite with AI
                </Button>
              </div>
              <Textarea
                rows={7}
                value={draft.caption}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {"{link}"} becomes this post's own campaign link.
              </p>
            </div>
            <div>
              <Label>Hashtags (space separated, no #)</Label>
              <Input
                value={draft.hashtags.join(" ")}
                disabled={locked}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    hashtags: e.target.value
                      .split(/[\s,]+/)
                      .map((t) => t.replace(/^#/, ""))
                      .filter(Boolean)
                      .slice(0, 30),
                  })
                }
              />
            </div>
            <div>
              <Label>Video script</Label>
              <Textarea
                rows={5}
                value={draft.script ?? ""}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, script: e.target.value || null })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Graphic layout</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  disabled={locked}
                  value={g.template}
                  onChange={(e) => setG({ template: e.target.value as GraphicTemplate })}
                >
                  {(["headline", "list", "steps", "wishlist", "profile"] as GraphicTemplate[]).map(
                    (t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div>
                <Label>Colors</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  disabled={locked}
                  value={g.theme}
                  onChange={(e) => setG({ theme: e.target.value as GraphicTheme })}
                >
                  <option value="night">Yooits night</option>
                  <option value="snow">Winter</option>
                  <option value="warm">Warm</option>
                </select>
              </div>
            </div>
            <div>
              <Label>Graphic headline</Label>
              <Input
                value={g.headline}
                disabled={locked}
                maxLength={80}
                onChange={(e) => setG({ headline: e.target.value })}
              />
            </div>
            <div>
              <Label>Graphic line under it</Label>
              <Input
                value={g.sub ?? ""}
                disabled={locked}
                maxLength={90}
                onChange={(e) => setG({ sub: e.target.value })}
              />
            </div>
            <div>
              <Label>Graphic rows (one per line)</Label>
              <Textarea
                rows={3}
                value={(g.items ?? []).join("\n")}
                disabled={locked}
                onChange={(e) =>
                  setG({
                    items: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 5),
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Post time</Label>
                <Input
                  type="datetime-local"
                  disabled={locked}
                  value={toLocalInput(draft.scheduled_at)}
                  onChange={(e) =>
                    setDraft({ ...draft, scheduled_at: fromLocalInput(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>Link goes to</Label>
                <Input
                  value={draft.landing_path}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, landing_path: e.target.value || "/" })}
                />
              </div>
            </div>
            <ClaimNotes text={postText(draft)} />
          </div>
          <div className="space-y-2">
            <PostPreview post={draft} slug={slug} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={locked || saving} onClick={save}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Post it by hand, then record and verify the live address
// ---------------------------------------------------------------------------
export function PublishDialog({
  post,
  slug,
  onClose,
  onDone,
}: {
  post: Post | null;
  slug: string | null | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setUrl("");
    setNote(null);
  }, [post?.id]);
  if (!post) return null;
  const spec = PLATFORMS[post.platform];
  const text = finalCaption(post, slug);
  const gid = `pub-${post.id}`;
  const urlOk = urlMatchesPlatform(post.platform, url.trim());

  const verify = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (spec.oembed) {
        const r = await marketingVerifyPost({ data: { postId: post.id, url: url.trim() } });
        if (r.ok) {
          toast.success(
            `Checked with ${spec.label}: it's live${r.author ? ` (by ${r.author})` : ""}.`,
          );
          onDone();
        } else setNote(r.message);
      } else {
        const { error } = await rpc("owner_marketing_confirm_published", {
          _id: post.id,
          _url: url.trim(),
        });
        if (error) setNote(error.message);
        else {
          toast.success("Recorded as live, confirmed by you.");
          onDone();
        }
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't check the post.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post it on {spec.label}</DialogTitle>
          <DialogDescription>
            Posts go out by hand until an API connection is set up. It's marked live only once its
            address is recorded
            {spec.oembed
              ? ` and ${spec.label} confirms the post is public.`
              : `. ${spec.label} has no public check, so it's recorded as confirmed by you.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4 text-sm">
            <ol className="list-decimal space-y-1 pl-4">
              {spec.manualSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => copy(text, "Caption")}>
                <Copy className="h-3 w-3" /> Copy caption
              </Button>
              {post.script && (
                <Button size="sm" variant="secondary" onClick={() => copy(post.script!, "Script")}>
                  <Copy className="h-3 w-3" /> Copy script
                </Button>
              )}
              {hasGraphic(post.graphic) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    downloadGraphic(
                      gid,
                      graphicSize(post.platform, post.format),
                      `yooits-${post.platform}-${post.code}`,
                    ).catch((e) => toast.error(e.message))
                  }
                >
                  <Download className="h-3 w-3" /> Download graphic
                </Button>
              )}
              <Button size="sm" variant="secondary" asChild>
                <a href={spec.composeUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3" /> Open {spec.label}
                </a>
              </Button>
            </div>
            {post.script && (
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                {post.script}
              </pre>
            )}
            <div className="space-y-2">
              <Label>Address of the live post</Label>
              <Input
                placeholder={`https://… (${spec.label})`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              {url && !urlOk && (
                <p className="text-xs text-destructive">That isn't a {spec.label} address.</p>
              )}
              {note && <p className="text-xs text-destructive">{note}</p>}
            </div>
          </div>
          <PostPreview post={post} slug={slug} graphicId={gid} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!urlOk || busy} onClick={verify}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {spec.oembed ? `Check with ${spec.label} and mark live` : "I posted it: mark live"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  edited: "Words edited",
  rescheduled: "Time changed",
  updated: "Updated",
  due: "Came due",
  published: "Marked live",
  retried: "Retried",
  status_approved: "Approved",
  status_scheduled: "Scheduled",
  status_draft: "Back to draft",
  status_archived: "Archived",
  status_publishing: "Due to post",
  status_failed: "Marked failed",
};

export function HistoryDialog({ post, onClose }: { post: Post | null; onClose: () => void }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    if (!post) return;
    setRows(null);
    rpc<HistoryRow[]>("owner_marketing_post_history", { _id: post.id }).then(({ data, error }) => {
      if (error) toast.error(error.message);
      setRows(data ?? []);
    });
  }, [post]);
  if (!post) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <DialogDescription>{post.title}</DialogDescription>
        </DialogHeader>
        {!rows ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
            {rows.map((r, i) => (
              <li key={i} className="border-b border-border pb-2">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{EVENT_LABEL[r.event] ?? r.event}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.at).toLocaleString()}
                  </span>
                </div>
                {r.from !== r.to && r.to && (
                  <p className="text-xs text-muted-foreground">
                    {r.from
                      ? (STATUS_LABELS[r.from as keyof typeof STATUS_LABELS] ?? r.from)
                      : "New"}{" "}
                    → {STATUS_LABELS[r.to as keyof typeof STATUS_LABELS] ?? r.to}
                  </p>
                )}
                {typeof r.detail?.note === "string" && <p className="text-xs">{r.detail.note}</p>}
                {typeof r.detail?.url === "string" && (
                  <a
                    className="text-xs text-primary underline"
                    href={r.detail.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {r.detail.url}
                  </a>
                )}
                {typeof r.detail?.verification === "string" && (
                  <p className="text-xs text-muted-foreground">
                    {r.detail.verification === "owner_confirmed"
                      ? "Confirmed by you"
                      : `Checked with the platform (${r.detail.verification})`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
