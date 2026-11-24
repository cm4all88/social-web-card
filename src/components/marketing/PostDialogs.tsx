import { studioGraphic } from "@/lib/marketing/studio";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { checkClaims, postText } from "@/lib/marketing/claims";
import { marketingAiRewrite, marketingVerifyPost } from "@/lib/marketing/functions";
import {
  AD_LOOKS,
  BACKDROP_LABELS,
  downloadGraphic,
  LAYOUT_LABELS,
  layoutOf,
} from "@/lib/marketing/graphics";
import { PLATFORMS, graphicSize, urlMatchesPlatform } from "@/lib/marketing/platforms";
import type {
  GraphicLayout,
  GraphicSpec,
  GraphicTheme,
  MockItem,
  MockLink,
} from "@/lib/marketing/types";
import { STATUS_LABELS } from "@/lib/marketing/types";
import { rpc, type HistoryRow, type Post } from "./api";
import { finalCaption, hasGraphic, postLink, PostPreview } from "./PostPreview";

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
  const [tagText, setTagText] = useState("");
  const [linkText, setLinkText] = useState("");
  const [itemText, setItemText] = useState("");
  useEffect(() => {
    setDraft(post);
    setTagText(post?.hashtags.join(" ") ?? "");
    const pg = post && hasGraphic(post.graphic) ? post.graphic : null;
    setLinkText(linksToText(pg?.links));
    setItemText(itemsToText(pg?.list?.items));
  }, [post]);
  if (!draft || !post) return null;
  const g: GraphicSpec = hasGraphic(draft.graphic)
    ? draft.graphic
    : { layout: "statement", theme: "brand", headline: "" };
  const setG = (patch: Partial<GraphicSpec>) => setDraft({ ...draft, graphic: { ...g, ...patch } });
  const layout = layoutOf(g);
  const setList = (patch: Partial<NonNullable<GraphicSpec["list"]>>) =>
    setG({ list: { title: "Holiday list", items: [], ...g.list, ...patch } });
  const locked = post.status === "publishing" || post.status === "published";
  const wordsChanged =
    draft.caption !== post.caption ||
    draft.script !== post.script ||
    JSON.stringify(parseTags(tagText)) !== JSON.stringify(post.hashtags) ||
    JSON.stringify(draft.graphic) !== JSON.stringify(post.graphic);

  const save = async () => {
    setSaving(true);
    const { error } = await rpc("owner_marketing_update_post", {
      _id: post.id,
      _patch: {
        title: draft.title,
        caption: draft.caption,
        hashtags: parseTags(tagText),
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

  const show = (l: GraphicLayout[]) => l.includes(layout);
  const field = "h-10 text-base";
  const select =
    "h-10 w-full rounded-md border border-input bg-background px-3 text-base disabled:opacity-60";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] w-[96vw] max-w-6xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Edit post</DialogTitle>
          <DialogDescription>
            {PLATFORMS[draft.platform].label} · {STATUS_LABELS[post.status]}
            {locked && " · this post is going out or live, so it can't be edited"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-0 lg:self-start">
            <PostPreview post={draft} slug={slug} className="max-w-xl" />
          </div>
          <Tabs defaultValue="words" className="space-y-4">
            <TabsList className="grid h-11 w-full grid-cols-4">
              <TabsTrigger value="words" className="text-base">Words</TabsTrigger>
              <TabsTrigger value="graphic" className="text-base">Graphic</TabsTrigger>
              <TabsTrigger value="video" className="text-base">Video</TabsTrigger>
              <TabsTrigger value="timing" className="text-base">When</TabsTrigger>
            </TabsList>

            <TabsContent value="words" className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Caption</Label>
                  <Button size="sm" variant="ghost" disabled={locked || rewriting} onClick={rewrite}>
                    {rewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}{" "}
                    Rewrite with AI
                  </Button>
                </div>
                <Textarea
                  rows={10}
                  className="text-base leading-relaxed"
                  value={draft.caption}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, caption: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {"{link}"} becomes this post's own link to yooits.me.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Hashtags</Label>
                <Input
                  className={field}
                  value={tagText}
                  disabled={locked}
                  placeholder="linkinbio creators"
                  onChange={(e) => setTagText(e.target.value)}
                  onBlur={() => setDraft({ ...draft, hashtags: parseTags(tagText) })}
                />
                <div className="flex flex-wrap gap-1.5">
                  {parseTags(tagText).map((t) => (
                    <span key={t} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Title (only you see this, except on YouTube)</Label>
                <Input
                  className={field}
                  value={draft.title}
                  maxLength={120}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
            </TabsContent>

            {g.studio && (
              <TabsContent value="graphic" className="space-y-4">
                <label className="block">Headline
                  <Input value={g.headline} disabled={locked} maxLength={80}
                    onChange={(event) => setG({ headline: event.target.value })} />
                </label>
                <label className="block">Call to action
                  <Input value={g.cta ?? ""} disabled={locked} maxLength={70}
                    onChange={(event) => setG({ cta: event.target.value })} />
                </label>
              </TabsContent>
            )}
            {g.studio ? null : <TabsContent value="graphic" className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm">Layout</Label>
                  <select
                    className={select}
                    disabled={locked}
                    value={layout}
                    onChange={(e) => setG({ layout: e.target.value as GraphicLayout, template: undefined })}
                  >
                    {(Object.keys(LAYOUT_LABELS) as GraphicLayout[]).map((l) => (
                      <option key={l} value={l}>
                        {LAYOUT_LABELS[l]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Background</Label>
                  <select
                    className={select}
                    disabled={locked}
                    value={g.theme}
                    onChange={(e) => setG({ theme: e.target.value as GraphicTheme })}
                  >
                    {(Object.keys(BACKDROP_LABELS) as GraphicTheme[]).map((t) => (
                      <option key={t} value={t}>
                        {BACKDROP_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Headline</Label>
                <Input
                  className={field}
                  value={g.headline}
                  disabled={locked}
                  maxLength={80}
                  onChange={(e) => setG({ headline: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Put *stars* around words to color them with the Yooits gradient.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm">Small line above</Label>
                  <Input
                    className={field}
                    value={g.eyebrow ?? ""}
                    disabled={locked}
                    maxLength={30}
                    onChange={(e) => setG({ eyebrow: e.target.value || undefined })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Button</Label>
                  <Input
                    className={field}
                    value={g.cta ?? ""}
                    placeholder="Make yours at yooits.me"
                    disabled={locked}
                    maxLength={32}
                    onChange={(e) => setG({ cta: e.target.value || undefined })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Line under the headline</Label>
                <Input
                  className={field}
                  value={g.sub ?? ""}
                  disabled={locked}
                  maxLength={90}
                  onChange={(e) => setG({ sub: e.target.value || undefined })}
                />
              </div>
              {show(["steps", "compare"]) && (
                <div className="space-y-1.5">
                  <Label className="text-sm">{layout === "steps" ? "Steps" : "Before lines"} (one per line)</Label>
                  <Textarea
                    rows={4}
                    className="text-base"
                    value={(g.items ?? []).join("\n")}
                    disabled={locked}
                    onChange={(e) => setG({ items: lines(e.target.value).slice(0, 4) })}
                  />
                </div>
              )}
              {show(["profile", "compare", "wishlist"]) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Page theme on the phone</Label>
                    <select
                      className={select}
                      disabled={locked}
                      value={g.look ?? ""}
                      onChange={(e) => setG({ look: e.target.value || undefined })}
                    >
                      <option value="">Midnight (default)</option>
                      {AD_LOOKS.map((l) => (
                        <option key={l.key} value={l.key}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {layout !== "wishlist" && (
                    <div className="space-y-1.5">
                      <Label className="text-sm">Effect</Label>
                      <select
                        className={select}
                        disabled={locked}
                        value={g.effect ?? ""}
                        onChange={(e) => setG({ effect: (e.target.value || undefined) as GraphicSpec["effect"] })}
                      >
                        <option value="">None</option>
                        <option value="snow">Snow</option>
                        <option value="stars">Stars</option>
                        <option value="hearts">Hearts</option>
                        <option value="leaves">Leaves</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
              {show(["hero", "themes"]) && (
                <div className="space-y-1.5">
                  <Label className="text-sm">Page themes on the phones</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[0, 1, 2].map((i) => (
                      <select
                        key={i}
                        className={select}
                        disabled={locked}
                        value={g.looks?.[i] ?? ""}
                        onChange={(e) => {
                          const looks = [...(g.looks ?? ["", "", ""])];
                          looks[i] = e.target.value;
                          setG({ looks: looks.filter(Boolean).length ? looks : undefined });
                        }}
                      >
                        <option value="">Default</option>
                        {AD_LOOKS.map((l) => (
                          <option key={l.key} value={l.key}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    ))}
                  </div>
                </div>
              )}
              {show(["profile", "compare", "hero", "themes"]) && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Bio on the phone</Label>
                    <Input
                      className={field}
                      value={g.bio ?? ""}
                      disabled={locked}
                      maxLength={80}
                      onChange={(e) => setG({ bio: e.target.value || undefined })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Links on the phone (one per line: name | platform | site)</Label>
                    <Textarea
                      rows={5}
                      className="font-mono text-sm"
                      value={linkText}
                      disabled={locked}
                      placeholder={"Instagram | instagram | instagram.com\nMy shop | shop | etsy.com"}
                      onChange={(e) => setLinkText(e.target.value)}
                      onBlur={() => setG({ links: parseLinks(linkText) })}
                    />
                  </div>
                </>
              )}
              {layout === "wishlist" && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-sm">List title</Label>
                      <Input
                        className={field}
                        value={g.list?.title ?? ""}
                        disabled={locked}
                        maxLength={30}
                        onChange={(e) => setList({ title: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">Occasion</Label>
                      <Input
                        className={field}
                        value={g.list?.occasion ?? ""}
                        disabled={locked}
                        maxLength={30}
                        onChange={(e) => setList({ occasion: e.target.value || undefined })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Items (one per line: name | price | site | taken)</Label>
                    <Textarea
                      rows={5}
                      className="font-mono text-sm"
                      value={itemText}
                      disabled={locked}
                      onChange={(e) => setItemText(e.target.value)}
                      onBlur={() => setList({ items: parseItems(itemText) })}
                    />
                  </div>
                </>
              )}
            </TabsContent>}

            <TabsContent value="video" className="space-y-1.5">
              <Label className="text-sm">Video script</Label>
              <Textarea
                rows={16}
                className="text-base leading-relaxed"
                value={draft.script ?? ""}
                disabled={locked}
                placeholder="One beat per line: what's on screen, then what's said."
                onChange={(e) => setDraft({ ...draft, script: e.target.value || null })}
              />
              <p className="text-xs text-muted-foreground">
                Shown to you only. Film it, then post the video with the caption.
              </p>
            </TabsContent>

            <TabsContent value="timing" className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Post time</Label>
                <Input
                  type="datetime-local"
                  className={field}
                  disabled={locked}
                  value={toLocalInput(draft.scheduled_at)}
                  onChange={(e) => setDraft({ ...draft, scheduled_at: fromLocalInput(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Link goes to (page on yooits.me)</Label>
                <Input
                  className={field}
                  value={draft.landing_path}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, landing_path: e.target.value || "/" })}
                />
              </div>
            </TabsContent>
            <ClaimNotes text={postText(draft)} />
          </Tabs>
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

const lines = (v: string) =>
  v
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

function parseTags(v: string) {
  return [...new Set(v.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean))].slice(0, 30);
}

function parseLinks(v: string): MockLink[] | undefined {
  const out = lines(v)
    .slice(0, 6)
    .map((l) => {
      const [label, icon, host] = l.split("|").map((s) => s.trim());
      return { label, icon: (icon || "website").toLowerCase(), host: host || undefined };
    })
    .filter((l) => l.label);
  return out.length ? out : undefined;
}

const linksToText = (links?: MockLink[]) =>
  (links ?? []).map((l) => [l.label, l.icon, l.host].filter(Boolean).join(" | ")).join("\n");

function parseItems(v: string): MockItem[] {
  return lines(v)
    .slice(0, 4)
    .map((l) => {
      const [name, price, host, taken] = l.split("|").map((s) => s.trim());
      return { name, price: price || undefined, host: host || undefined, taken: /^(taken|yes|claimed)$/i.test(taken ?? "") };
    })
    .filter((i) => i.name);
}

const itemsToText = (items?: MockItem[]) =>
  (items ?? []).map((i) => [i.name, i.price ?? "", i.host ?? "", i.taken ? "taken" : ""].join(" | ").replace(/( \| )+$/, "")).join("\n");

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
              <Button size="sm" variant="secondary" onClick={() => copy(postLink(post, slug), "Link")}>
                <Copy className="h-3 w-3" /> Copy link
              </Button>
              {post.script && (
                <Button size="sm" variant="secondary" onClick={() => copy(post.script!, "Script")}>
                  <Copy className="h-3 w-3" /> Copy script
                </Button>
              )}
              {studioGraphic(post.graphic.studio) ? (
                <Button size="sm" variant="secondary" onClick={() =>
                  import("./exportPosts").then(({ exportForReview }) =>
                    exportForReview([post], () => slug ?? undefined),
                  ).catch((e) => toast.error(e.message))
                }>
                  <Download className="h-3 w-3" /> Download post ZIP
                </Button>
              ) : hasGraphic(post.graphic) && (
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
              <p className="break-all rounded-md bg-muted p-2 font-mono text-xs">{postLink(post, slug)}</p>
              <p className="text-xs text-muted-foreground">
                That link tracks visits and sign-ups from this post. Put it in the post or your bio.
              </p>
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
