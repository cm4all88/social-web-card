/**
 * Creator tab, subscriptions part: apply, set a monthly price for review, and
 * write public or subscriber-only posts. There is no checkout and nothing to
 * buy: subscriptions can't be sold until they're fully built and Stripe has
 * approved Yooits' model. The database checks every step again.
 */
import { useEffect, useState } from "react";
import { Loader2, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { creatorFeeBreakdown, formatCents } from "@/lib/creator/fees";
import {
  applyAsCreator,
  CONTENT_TYPES,
  deleteCreatorPost,
  saveCreatorPost,
  signedMediaUrls,
  submitCreatorOffer,
  uploadCreatorMedia,
  withdrawCreatorApplication,
  type ContentType,
  type MyCreatorPost,
  type MyCreatorSubscriptions,
} from "@/lib/creator/subscriptions";

type Visible = Extract<MyCreatorSubscriptions, { visible: true }>;

const card = "rounded-2xl border border-border bg-card p-5";

export function CreatorSubscriptionsSection({
  data,
  userId,
  onChanged,
}: {
  data: MyCreatorSubscriptions;
  userId: string | null;
  onChanged: () => void;
}) {
  if (!data.visible) return null;
  const approved = data.monetization && !data.monetization.suspended;
  return (
    <div className="mt-8 space-y-4">
      <h3 className="text-lg font-bold">Creator subscriptions</h3>
      {!data.enabled && (
        <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
          Only admins see this until it's turned on in the Owner Console.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        You set a monthly price and keep all of it. Subscribers pay a service and processing fee on
        top, shown before they pay. Subscriptions can't be bought on Yooits yet.
      </p>
      {data.monetization?.suspended ? (
        <div className={card}>
          <div className="font-medium">Your creator subscriptions are paused</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.monetization.suspended_reason ?? "Contact Yooits for details."}
          </p>
        </div>
      ) : approved ? (
        <>
          <OfferEditor data={data} onChanged={onChanged} />
          <div className={card}>
            <div className="text-sm text-muted-foreground">Subscribers</div>
            <div className="mt-1 text-3xl font-bold">
              {data.subscribers.toLocaleString("en-US")}
            </div>
          </div>
        </>
      ) : (
        <Application data={data} onChanged={onChanged} />
      )}
      {approved && <Posts posts={data.posts} userId={userId} onChanged={onChanged} />}
    </div>
  );
}

function Application({ data, onChanged }: { data: Visible; onChanged: () => void }) {
  const [about, setAbout] = useState("");
  const [types, setTypes] = useState<ContentType[]>([]);
  const [adult, setAdult] = useState(false);
  const [sfw, setSfw] = useState(false);
  const [busy, setBusy] = useState(false);
  const a = data.application;

  const run = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await f();
      toast.success(done);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (a?.status === "pending") {
    return (
      <div className={card}>
        <div className="font-medium">Your application is waiting for review</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Yooits reviews every creator before they can offer subscriptions.
        </p>
        <Button
          variant="secondary"
          className="mt-3"
          disabled={busy}
          onClick={() => run(withdrawCreatorApplication, "Application withdrawn")}
        >
          Withdraw application
        </Button>
      </div>
    );
  }
  if (!data.can_apply) {
    return (
      <div className={card}>
        <div className="font-medium">Applying opens at the visitor milestone</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Keep sharing your page. Your progress is shown above.
        </p>
      </div>
    );
  }
  const ok = about.trim().length >= 20 && types.length > 0 && adult && sfw;
  return (
    <div className={card}>
      <div className="font-medium">Apply to offer subscriptions</div>
      {a?.status === "rejected" && (
        <p className="mt-1 text-sm text-muted-foreground">
          Your last application wasn't approved{a.decision_note ? `: ${a.decision_note}` : "."} You
          can apply again.
        </p>
      )}
      <label className="mt-3 block text-sm">
        What will subscribers get?
        <Textarea
          value={about}
          maxLength={1000}
          onChange={(e) => setAbout(e.target.value)}
          className="mt-1"
          placeholder="For example: weekly photo updates from my studio and early looks at new work."
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {CONTENT_TYPES.map((t) => (
          <label key={t.id} className="flex items-center gap-2">
            <Checkbox
              checked={types.includes(t.id)}
              onCheckedChange={(on) =>
                setTypes((cur) => (on ? [...cur, t.id] : cur.filter((x) => x !== t.id)))
              }
            />
            {t.label}
          </label>
        ))}
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <Checkbox checked={adult} onCheckedChange={(on) => setAdult(on === true)} />
        I'm 18 or older.
      </label>
      <label className="mt-2 flex items-start gap-2 text-sm">
        <Checkbox checked={sfw} onCheckedChange={(on) => setSfw(on === true)} />
        Everything I post will be safe for work.
      </label>
      <Button
        className="mt-4"
        disabled={!ok || busy}
        onClick={() =>
          run(
            () => applyAsCreator({ about, contentTypes: types, adult, sfw }),
            "Application sent for review",
          )
        }
      >
        Send application
      </Button>
    </div>
  );
}

function OfferEditor({ data, onChanged }: { data: Visible; onChanged: () => void }) {
  const approved = data.offers.find((o) => o.status === "approved");
  const pending = data.offers.find((o) => o.status === "pending");
  const lastRejected = data.offers.find((o) => o.status === "rejected");
  const start = pending ?? approved;
  const [price, setPrice] = useState(start ? (start.price_cents / 100).toFixed(2) : "");
  const [description, setDescription] = useState(start?.description ?? "");
  const [busy, setBusy] = useState(false);
  const cents = Math.round(Number(price) * 100);
  const inRange =
    Number.isFinite(cents) && cents >= data.price_min_cents && cents <= data.price_max_cents;
  const fee = inRange ? creatorFeeBreakdown(cents, data.fees) : null;

  const submit = async () => {
    setBusy(true);
    try {
      await submitCreatorOffer(cents, description);
      toast.success("Sent for review");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <div className="font-medium">Your monthly subscription</div>
      {approved && (
        <p className="mt-1 text-sm text-muted-foreground">
          Approved: {formatCents(approved.price_cents)} a month.
        </p>
      )}
      {pending && (
        <p className="mt-1 text-sm text-muted-foreground">
          Waiting for review: {formatCents(pending.price_cents)} a month.
        </p>
      )}
      {!pending && lastRejected && !approved && (
        <p className="mt-1 text-sm text-muted-foreground">
          Not approved{lastRejected.decision_note ? `: ${lastRejected.decision_note}` : "."}
        </p>
      )}
      <label className="mt-3 block text-sm">
        Monthly price (USD)
        <Input
          type="number"
          min={data.price_min_cents / 100}
          max={data.price_max_cents / 100}
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="mt-1 w-36"
        />
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        Between {formatCents(data.price_min_cents)} and {formatCents(data.price_max_cents)}.
      </p>
      <label className="mt-3 block text-sm">
        What subscribers get
        <Textarea
          value={description}
          maxLength={1000}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1"
        />
      </label>
      {inRange && (
        <div className="mt-3 rounded-xl bg-muted p-3 text-sm" data-testid="fee-breakdown">
          <div className="flex justify-between">
            <span>You keep</span>
            <span className="font-medium">{formatCents(cents)} a month</span>
          </div>
          {fee ? (
            <>
              <div className="flex justify-between text-muted-foreground">
                <span>Service and processing fee, paid by the subscriber</span>
                <span>{formatCents(fee.serviceFee)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Subscriber pays, before any tax</span>
                <span>{formatCents(fee.total)} a month</span>
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">
              The service fee hasn't been set yet, so the subscriber's total isn't shown.
            </div>
          )}
        </div>
      )}
      <Button
        className="mt-4"
        disabled={!inRange || description.trim().length < 10 || busy}
        onClick={submit}
      >
        {approved || pending ? "Send changes for review" : "Send for review"}
      </Button>
    </div>
  );
}

function Posts({
  posts,
  userId,
  onChanged,
}: {
  posts: MyCreatorPost[];
  userId: string | null;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState("");
  const [visibility, setVisibility] = useState<"public" | "subscribers">("subscribers");
  const [media, setMedia] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const allPaths = [...media, ...posts.flatMap((p) => p.media_paths)].join("|");
  useEffect(() => {
    const paths = allPaths ? allPaths.split("|") : [];
    void signedMediaUrls(paths)
      .then(setUrls)
      .catch(() => setUrls({}));
  }, [allPaths]);

  const upload = async (file: File | undefined) => {
    if (!file || !userId) return;
    setBusy(true);
    try {
      const path = await uploadCreatorMedia(userId, file);
      setMedia((m) => [...m, path]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      await saveCreatorPost({ id: null, visibility, title, body, preview, mediaPaths: media });
      setTitle("");
      setBody("");
      setPreview("");
      setMedia([]);
      toast.success("Posted");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteCreatorPost(id);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="font-medium">New post</div>
        <Input
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mt-3"
        />
        <Textarea
          value={body}
          maxLength={10000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write something"
          className="mt-2"
        />
        <div className="mt-3 flex gap-2 text-sm">
          {(["subscribers", "public"] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={visibility === v ? "default" : "secondary"}
              onClick={() => setVisibility(v)}
            >
              {v === "public" ? "Everyone" : "Subscribers only"}
            </Button>
          ))}
        </div>
        {visibility === "subscribers" && (
          <Input
            value={preview}
            maxLength={280}
            onChange={(e) => setPreview(e.target.value)}
            placeholder="Preview for visitors (optional)"
            className="mt-2"
          />
        )}
        {media.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {media.map((p) =>
              urls[p] ? (
                <img key={p} src={urls[p]} alt="" className="h-20 w-20 rounded-lg object-cover" />
              ) : (
                <div key={p} className="h-20 w-20 rounded-lg bg-muted" />
              ),
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="cursor-pointer text-sm text-muted-foreground underline">
            Add a photo
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              disabled={busy || media.length >= 8}
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <Button disabled={!title.trim() || busy} onClick={publish}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Post"}
          </Button>
        </div>
      </div>

      {posts.length > 0 && (
        <ul className="space-y-2" aria-label="Your posts">
          {posts.map((p) => (
            <li key={p.id} className="rounded-2xl border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {p.visibility === "subscribers" && <Lock className="h-3.5 w-3.5" />}
                    {p.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.visibility === "subscribers" ? "Subscribers only" : "Everyone"}
                    {p.removed ? ` · Removed by Yooits: ${p.removed_reason ?? ""}` : ""}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${p.title}`}
                  onClick={() => remove(p.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {p.body && <p className="mt-2 whitespace-pre-wrap text-sm">{p.body}</p>}
              {p.media_paths.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.media_paths.map((m) =>
                    urls[m] ? (
                      <img
                        key={m}
                        src={urls[m]}
                        alt=""
                        className="h-24 w-24 rounded-lg object-cover"
                      />
                    ) : null,
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
