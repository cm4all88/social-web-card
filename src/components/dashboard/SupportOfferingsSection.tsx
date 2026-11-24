/**
 * Creator tab, Support Offerings part (issue #7): list a real digital thing a
 * supporter receives (a download, a digital card, a reader pack or an
 * exclusive post). Each version is reviewed in the Owner Console before it can
 * be offered. There is no checkout yet, so nothing here can be bought, and the
 * database checks every step again.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCents } from "@/lib/creator/fees";
import {
  archiveSupportOffering,
  OFFERING_KINDS,
  submitSupportOffering,
  supportTotal,
  uploadSupportFile,
  type MyOffering,
  type MySupportOfferings,
  type OfferingKind,
  type OfferingVersion,
} from "@/lib/support/offerings";

type Visible = Extract<MySupportOfferings, { visible: true }>;

const card = "rounded-2xl border border-border bg-card p-5";

const STATUS_TEXT: Record<OfferingVersion["status"], string> = {
  pending: "Waiting for review",
  approved: "Approved",
  rejected: "Not approved",
};

export function SupportOfferingsSection({
  data,
  userId,
  onChanged,
}: {
  data: MySupportOfferings;
  userId: string | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<MyOffering | "new" | null>(null);
  if (!data.visible) return null;
  return (
    <div className="mt-8 space-y-4">
      <h3 className="text-lg font-bold">Support Offerings</h3>
      {!data.enabled && (
        <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
          Only admins see this until it's turned on in the Owner Console.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Offer something real that supporters receive. You keep the whole price; supporters pay a{" "}
        {formatCents(supportTotal(0).fee)} Yooits.me service fee on top. Each offering is reviewed
        before it's shown, and supporters can't buy yet.
      </p>

      {data.offerings.map((o) => (
        <OfferingCard key={o.id} o={o} onEdit={() => setEditing(o)} onChanged={onChanged} />
      ))}

      {editing ? (
        <OfferingEditor
          key={editing === "new" ? "new" : editing.id}
          data={data}
          userId={userId}
          offering={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Button variant="outline" onClick={() => setEditing("new")}>
          Add an offering
        </Button>
      )}
    </div>
  );
}

function OfferingCard({
  o,
  onEdit,
  onChanged,
}: {
  o: MyOffering;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const versions = o.versions ?? [];
  const latest = versions[0];
  const approved = versions.find((v) => v.status === "approved");
  if (!latest) return null;
  const archive = async () => {
    try {
      await archiveSupportOffering(o.id);
      toast.success("Offering archived");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{latest.title}</p>
          <p className="text-xs text-muted-foreground">
            {OFFERING_KINDS.find((k) => k.id === latest.kind)?.label} · from{" "}
            {formatCents(latest.min_price_cents)}
            {latest.allow_pay_more ? " or more" : ""} · {STATUS_TEXT[latest.status]}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void archive()}>
            Archive
          </Button>
        </div>
      </div>
      {o.suspended && (
        <p className="mt-2 text-sm text-destructive">
          Paused by Yooits.me{o.suspended_reason ? `: ${o.suspended_reason}` : "."}
        </p>
      )}
      {latest.status === "rejected" && latest.decision_note && (
        <p className="mt-2 text-sm text-muted-foreground">Reviewer note: {latest.decision_note}</p>
      )}
      {approved && approved.id !== latest.id && (
        <p className="mt-2 text-xs text-muted-foreground">
          Version {approved.version} stays approved while your changes are reviewed.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Sales: {o.sales}</p>
    </div>
  );
}

function OfferingEditor({
  data,
  userId,
  offering,
  onDone,
  onCancel,
}: {
  data: Visible;
  userId: string | null;
  offering: MyOffering | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const base = offering?.versions?.[0];
  const [kind, setKind] = useState<OfferingKind>(base?.kind ?? "download");
  const [title, setTitle] = useState(base?.title ?? "");
  const [description, setDescription] = useState(base?.description ?? "");
  const [whatYouGet, setWhatYouGet] = useState(base?.what_you_get ?? "");
  const [price, setPrice] = useState(((base?.min_price_cents ?? 500) / 100).toFixed(2));
  const [payMore, setPayMore] = useState(base?.allow_pay_more ?? false);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const needsFile = OFFERING_KINDS.find((k) => k.id === kind)?.needsFile ?? true;
  const cents = Math.round(Number(price) * 100);
  const priceOk =
    Number.isFinite(cents) && cents >= data.price_min_cents && cents <= data.price_max_cents;
  const quote = priceOk ? supportTotal(cents) : null;

  const submit = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      let filePath: string | null = null;
      let fileName: string | null = null;
      if (needsFile) {
        if (!file) throw new Error("Upload the file supporters will receive.");
        filePath = await uploadSupportFile(userId, file);
        fileName = file.name.slice(0, 200);
      }
      await submitSupportOffering({
        offeringId: offering?.id ?? null,
        kind,
        title: title.trim(),
        description: description.trim(),
        whatYouGet: whatYouGet.trim(),
        minPriceCents: cents,
        allowPayMore: payMore,
        filePath,
        fileName,
        contentBody: needsFile ? null : body.trim(),
      });
      toast.success("Sent for review");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${card} space-y-3`}>
      <p className="font-semibold">{offering ? "Edit offering" : "New offering"}</p>
      {offering && (
        <p className="text-xs text-muted-foreground">
          Changes go back for review as a new version. Attach the file (or write the post) again.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {OFFERING_KINDS.map((k) => (
          <Button
            key={k.id}
            size="sm"
            type="button"
            variant={kind === k.id ? "default" : "outline"}
            onClick={() => setKind(k.id)}
          >
            {k.label}
          </Button>
        ))}
      </div>
      <Input
        placeholder="Title"
        maxLength={80}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Textarea
        placeholder="Describe it (at least 20 characters)"
        maxLength={1000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Textarea
        placeholder="What supporters get (for example: a 24-page PDF guide)"
        maxLength={280}
        value={whatYouGet}
        onChange={(e) => setWhatYouGet(e.target.value)}
      />
      {needsFile ? (
        <label className="block text-sm">
          <span className="text-muted-foreground">
            File supporters receive (PDF, EPUB, ZIP or image, up to 50 MB)
          </span>
          <input
            type="file"
            className="mt-1 block w-full text-sm"
            accept=".pdf,.epub,.zip,image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : (
        <Textarea
          placeholder="The post supporters unlock (at least 50 characters)"
          maxLength={20000}
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Price (USD)
          <Input
            className="mt-1 w-32"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={payMore} onCheckedChange={(v) => setPayMore(v === true)} />
          Let supporters pay more
        </label>
      </div>
      {quote ? (
        <p className="text-sm text-muted-foreground">
          You get {formatCents(quote.price)}. Supporters pay {formatCents(quote.total)} (
          {formatCents(quote.price)} + {formatCents(quote.fee)} service fee).
        </p>
      ) : (
        <p className="text-sm text-destructive">
          Choose a price between {formatCents(data.price_min_cents)} and{" "}
          {formatCents(data.price_max_cents)}.
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={busy || !priceOk || !title.trim()} onClick={() => void submit()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Send for review
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
