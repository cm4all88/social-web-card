import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { rpc } from "@/components/marketing/api";
import { InviteCodes, Redemptions } from "@/components/owner/InviteCodes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ELIGIBILITY_LABELS,
  promotionOffer,
  type Eligibility,
  type Promotion,
  type PromotionReport,
  type PromotionStatus,
} from "@/lib/owner/codes";

/**
 * Promotions: a campaign with its own codes, rules and report. A promotion's
 * reward is free Plus through the same no-card grant Founding Members use;
 * nothing here touches Stripe or checkout. Codes are ordinary invite codes
 * tied to the promotion, so sign-up and redemption work the same way.
 */
export const Route = createFileRoute("/owner/promotions")({
  component: PromotionsPage,
});

type Campaign = { id: string; name: string };

const STATE_LABELS: Record<Promotion["state"], string> = {
  live: "Live",
  scheduled: "Scheduled",
  ended: "Ended",
  draft: "Draft",
  paused: "Paused",
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

/** ISO to the value a datetime-local input wants, in the viewer's own time. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc<T>(fn, args);
  if (error) throw new Error(/^Not authorized/.test(error.message) ? "Only Yooits admins can do this." : error.message);
  return data;
}

type Draft = {
  id?: string;
  name: string;
  description: string;
  status: PromotionStatus;
  starts_at: string;
  ends_at: string;
  plus_months: number;
  eligibility: Eligibility;
  max_redemptions: string;
  campaign_id: string;
};

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  status: "draft",
  starts_at: "",
  ends_at: "",
  plus_months: 1,
  eligibility: "new_accounts",
  max_redemptions: "",
  campaign_id: "",
});

const draftOf = (p: Promotion): Draft => ({
  id: p.id,
  name: p.name,
  description: p.description ?? "",
  status: p.status,
  starts_at: toLocalInput(p.starts_at),
  ends_at: toLocalInput(p.ends_at),
  plus_months: p.plus_months,
  eligibility: p.eligibility,
  max_redemptions: p.max_redemptions == null ? "" : String(p.max_redemptions),
  campaign_id: p.campaign_id ?? "",
});

function PromotionsPage() {
  const [list, setList] = useState<{ promotions: Promotion[]; campaigns: Campaign[] } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await call<{ promotions: Promotion[]; campaigns: Campaign[] }>("owner_promotions"));
    } catch (e) {
      toast.error((e as Error).message);
      setList({ promotions: [], campaigns: [] });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await call<Promotion>("owner_promotion_save", {
        _p: {
          id: draft.id ?? null,
          name: draft.name,
          description: draft.description,
          status: draft.status,
          starts_at: fromLocalInput(draft.starts_at),
          ends_at: fromLocalInput(draft.ends_at),
          plus_months: draft.plus_months,
          eligibility: draft.eligibility,
          max_redemptions: draft.max_redemptions ? Number(draft.max_redemptions) : null,
          campaign_id: draft.campaign_id || null,
        },
      });
      toast.success(draft.id ? "Promotion saved" : "Promotion created");
      setDraft(null);
      await load();
      setOpenId(saved.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const open = list?.promotions.find((p) => p.id === openId) ?? null;

  return (
    <div className="max-w-5xl">
      {open ? (
        <PromotionDetail
          promotion={open}
          onBack={() => setOpenId(null)}
          onEdit={() => setDraft(draftOf(open))}
          onChanged={load}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold">Promotions</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                A promotion is a set of codes with one offer and one set of rules. Its reward is free Plus for a
                number of months, with no card and nothing that renews. Codes work on the normal sign-up page
                and for people already signed in. Founding Members keep their own page.
              </p>
            </div>
            <Button onClick={() => setDraft(emptyDraft())}>
              <Plus className="mr-2 h-4 w-4" /> New promotion
            </Button>
          </div>

          {!list && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
          {list && list.promotions.length === 0 && (
            <div className="mt-8 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No promotions yet. Make one, add its codes, and share them yourself. Nothing is sent from here.
            </div>
          )}
          {list && list.promotions.length > 0 && (
            <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3">Promotion</th>
                    <th className="p-3">State</th>
                    <th className="p-3">Offer</th>
                    <th className="p-3">Used</th>
                    <th className="p-3">On Plus now</th>
                    <th className="p-3">Window</th>
                  </tr>
                </thead>
                <tbody>
                  {list.promotions.map((p) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-t border-border hover:bg-muted/30"
                      onClick={() => setOpenId(p.id)}
                    >
                      <td className="p-3">
                        <div className="font-medium text-primary">{p.name}</div>
                        {p.campaign_name && <div className="text-xs text-muted-foreground">{p.campaign_name}</div>}
                      </td>
                      <td className="p-3">{STATE_LABELS[p.state]}</td>
                      <td className="p-3">{promotionOffer(p)}</td>
                      <td className="p-3">
                        {p.redemptions}
                        {p.max_redemptions != null && ` of ${p.max_redemptions}`}
                      </td>
                      <td className="p-3">{p.plus_now}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {p.starts_at ? `From ${fmt(p.starts_at)}` : "Any time"}
                        {p.ends_at && ` to ${fmt(p.ends_at)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit promotion" : "New promotion"}</DialogTitle>
            <DialogDescription>
              Changes apply to codes from now on. Anyone who already used a code keeps what they got.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div>
                <Label htmlFor="pr-name">Name</Label>
                <Input
                  id="pr-name"
                  maxLength={80}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="pr-desc">Notes (only you see these)</Label>
                <Textarea
                  id="pr-desc"
                  maxLength={500}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="pr-status">Status</Label>
                  <select
                    id="pr-status"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value as PromotionStatus })}
                  >
                    <option value="draft">Draft (codes don't work yet)</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="ended">Ended</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="pr-months">Free Plus months</Label>
                  <Input
                    id="pr-months"
                    type="number"
                    min={0}
                    max={12}
                    value={draft.plus_months}
                    onChange={(e) =>
                      setDraft({ ...draft, plus_months: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })
                    }
                  />
                  <p className="mt-1 text-xs text-muted-foreground">0 tracks sign-ups with no reward.</p>
                </div>
                <div>
                  <Label htmlFor="pr-start">Starts (blank for now)</Label>
                  <Input
                    id="pr-start"
                    type="datetime-local"
                    value={draft.starts_at}
                    onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="pr-end">Ends (blank for no end)</Label>
                  <Input
                    id="pr-end"
                    type="datetime-local"
                    value={draft.ends_at}
                    onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="pr-elig">Who can use it</Label>
                  <select
                    id="pr-elig"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={draft.eligibility}
                    onChange={(e) => setDraft({ ...draft, eligibility: e.target.value as Eligibility })}
                  >
                    {(Object.keys(ELIGIBILITY_LABELS) as Eligibility[]).map((k) => (
                      <option key={k} value={k}>
                        {ELIGIBILITY_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="pr-cap">Total uses allowed (blank for no cap)</Label>
                  <Input
                    id="pr-cap"
                    type="number"
                    min={1}
                    value={draft.max_redemptions}
                    onChange={(e) => setDraft({ ...draft, max_redemptions: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="pr-camp">Marketing campaign (optional)</Label>
                <select
                  id="pr-camp"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.campaign_id}
                  onChange={(e) => setDraft({ ...draft, campaign_id: e.target.value })}
                >
                  <option value="">None</option>
                  {list?.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                One account can use each promotion once. Someone already paying for Plus can't use a Plus
                code. Free Plus from a code starts after any free Plus they already have.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !draft || draft.name.trim().length < 2}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {draft?.id ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PromotionDetail({
  promotion,
  onBack,
  onEdit,
  onChanged,
}: {
  promotion: Promotion;
  onBack: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [report, setReport] = useState<PromotionReport | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setReport(null);
    call<PromotionReport>("owner_promotion_report", { _id: promotion.id, _days: 30 })
      .then(setReport)
      .catch((e) => toast.error((e as Error).message));
  }, [promotion.id, tick]);

  const p = report?.promotion ?? promotion;
  const maxDay = Math.max(1, ...(report?.daily ?? []).map((d) => d.redemptions));
  const changed = () => {
    setTick((t) => t + 1);
    onChanged();
  };

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="mr-1 h-4 w-4" /> All promotions
      </Button>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{p.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {STATE_LABELS[p.state]} · {promotionOffer(p)} · {ELIGIBILITY_LABELS[p.eligibility]}
            {p.campaign_name && (
              <>
                {" · "}
                <Link to="/owner/marketing" className="text-primary hover:underline">
                  {p.campaign_name}
                </Link>
              </>
            )}
          </p>
          {p.description && <p className="mt-2 max-w-2xl text-sm">{p.description}</p>}
        </div>
        <Button variant="outline" onClick={onEdit}>
          Edit
        </Button>
      </div>

      {p.status === "draft" && (
        <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          This promotion is a draft, so its codes don't work yet. Set it to Active when you're ready.
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Used", value: p.max_redemptions != null ? `${p.redemptions} of ${p.max_redemptions}` : p.redemptions },
          { label: "Last 7 days", value: p.redemptions_7d },
          { label: "New sign-ups", value: p.signups },
          { label: "On free Plus now", value: p.plus_now },
          { label: "Paying for Plus", value: p.paying_now },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</div>
            <div className="mt-1 text-2xl font-bold">{t.value}</div>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-xl font-bold">Last 30 days</h2>
      {!report && <Loader2 className="mt-3 h-5 w-5 animate-spin text-muted-foreground" />}
      {report && (
        <div className="mt-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="Codes used per day, last 30 days">
            {report.daily.map((d) => (
              <div
                key={d.day}
                title={`${fmt(d.day)}: ${d.redemptions} used, ${d.signups} new sign-ups`}
                className="flex-1 rounded-t bg-primary/70"
                style={{ height: `${Math.max(2, (d.redemptions / maxDay) * 100)}%`, opacity: d.redemptions ? 1 : 0.2 }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{fmt(report.daily[0]?.day ?? null)}</span>
            <span>Today</span>
          </div>
        </div>
      )}

      <h2 className="mt-8 text-xl font-bold">Codes</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        One shared code with many uses suits a post. Single-use codes suit people you invite one by one.
      </p>
      <div className="mt-3">
        <InviteCodes promotionId={promotion.id} defaultUses={100} onChanged={changed} />
      </div>

      <h2 className="mt-8 text-xl font-bold">Who used it</h2>
      <div className="mt-3">
        <Redemptions promotionId={promotion.id} refreshKey={tick} />
      </div>
    </div>
  );
}
