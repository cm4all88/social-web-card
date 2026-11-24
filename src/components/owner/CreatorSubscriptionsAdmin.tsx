/**
 * Owner Console: creator subscriptions. Turn the feature on for creators, set
 * price limits and fee rates, review applications and prices, pause a
 * creator, and remove posts. Every change is written to the audit log.
 * Nothing here sells or charges anything: there is no checkout yet, and live
 * creator payments stay off until Stripe approves Yooits.me's model.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { creatorFeeBreakdown, formatCents, parseFeeRates } from "@/lib/creator/fees";
import {
  ownerRpc,
  type OwnerCreatorSubscriptionSettings,
  type OwnerCreatorSubscriptions,
} from "@/lib/owner/api";

const box = "rounded-2xl border border-border p-4";

export function CreatorSubscriptionsAdmin() {
  const [data, setData] = useState<OwnerCreatorSubscriptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await ownerRpc("owner_creator_subscriptions", {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (f: () => Promise<unknown>, done: string) => {
    try {
      await f();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section className="mt-12">
      <h2 className="text-2xl font-bold">Creator subscriptions</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Creators keep 100% of the price they set; subscribers pay a service and processing fee on
        top. There's no checkout yet, so nothing can be bought, and live creator payments stay off
        until Stripe approves the model.
      </p>
      {error && <p className="mt-4 text-muted-foreground">{error}</p>}
      {!data && !error && <Loader2 className="mt-6 h-6 w-6 animate-spin text-muted-foreground" />}
      {data && (
        <>
          <Settings key={data.settings.updated_at} s={data.settings} onSaved={load} />

          <h3 className="mt-8 text-lg font-bold">Applications</h3>
          {data.applications.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No applications yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {data.applications.map((a) => (
                <div key={a.id} className={box}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">@{a.username ?? "deleted"}</span>
                    <span className="text-sm text-muted-foreground">
                      {a.status} · {a.qualifying_visitors.toLocaleString("en-US")} visitors ·{" "}
                      {new Date(a.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{a.about}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Content: {a.content_types.join(", ")}. Confirmed 18+ and safe for work.
                  </p>
                  {a.decision_note && (
                    <p className="mt-1 text-xs text-muted-foreground">Note: {a.decision_note}</p>
                  )}
                  {a.status === "pending" && (
                    <Decide
                      approveLabel="Approve creator"
                      onApprove={() =>
                        act(
                          () =>
                            ownerRpc("owner_decide_creator_application", {
                              _id: a.id,
                              _approve: true,
                            }),
                          "Creator approved",
                        )
                      }
                      onReject={(note) =>
                        act(
                          () =>
                            ownerRpc("owner_decide_creator_application", {
                              _id: a.id,
                              _approve: false,
                              _note: note,
                            }),
                          "Application rejected",
                        )
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <h3 className="mt-8 text-lg font-bold">Prices waiting for review</h3>
          {data.offers.filter((o) => o.status === "pending").length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing waiting.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {data.offers
                .filter((o) => o.status === "pending")
                .map((o) => (
                  <div key={o.id} className={box}>
                    <div className="flex justify-between">
                      <span className="font-medium">@{o.username ?? "deleted"}</span>
                      <span className="text-sm">
                        {formatCents(o.price_cents)} a month · version {o.version}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{o.description}</p>
                    <Decide
                      approveLabel="Approve price"
                      onApprove={() =>
                        act(
                          () =>
                            ownerRpc("owner_decide_creator_offer", { _id: o.id, _approve: true }),
                          "Price approved",
                        )
                      }
                      onReject={(note) =>
                        act(
                          () =>
                            ownerRpc("owner_decide_creator_offer", {
                              _id: o.id,
                              _approve: false,
                              _note: note,
                            }),
                          "Price rejected",
                        )
                      }
                    />
                  </div>
                ))}
            </div>
          )}

          <h3 className="mt-8 text-lg font-bold">Approved creators</h3>
          {data.creators.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">None yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {data.creators.map((c) => (
                <div key={c.user_id} className={box}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">@{c.username ?? "deleted"}</span>
                    <span className="text-sm text-muted-foreground">
                      {c.posts} posts · {c.subscribers} subscribers
                      {c.suspended ? ` · Paused: ${c.suspended_reason ?? ""}` : ""}
                    </span>
                  </div>
                  {c.suspended ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-3"
                      onClick={() =>
                        act(
                          () =>
                            ownerRpc("owner_set_creator_monetization_suspended", {
                              _user_id: c.user_id,
                              _suspended: false,
                            }),
                          "Restored",
                        )
                      }
                    >
                      Restore
                    </Button>
                  ) : (
                    <WithReason
                      label="Pause subscriptions"
                      onSubmit={(reason) =>
                        act(
                          () =>
                            ownerRpc("owner_set_creator_monetization_suspended", {
                              _user_id: c.user_id,
                              _suspended: true,
                              _reason: reason,
                            }),
                          "Paused",
                        )
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <h3 className="mt-8 text-lg font-bold">Recent posts</h3>
          {data.posts.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No posts yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {data.posts.map((p) => (
                <div key={p.id} className={box}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{p.title}</span>
                    <span className="text-sm text-muted-foreground">
                      @{p.username ?? "deleted"} ·{" "}
                      {p.visibility === "subscribers" ? "subscribers only" : "everyone"} ·{" "}
                      {p.media_count} photos
                    </span>
                  </div>
                  {p.body && <p className="mt-2 whitespace-pre-wrap text-sm">{p.body}</p>}
                  {p.removed ? (
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        Removed: {p.removed_reason}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          act(
                            () =>
                              ownerRpc("owner_remove_creator_post", { _id: p.id, _removed: false }),
                            "Restored",
                          )
                        }
                      >
                        Restore
                      </Button>
                    </div>
                  ) : (
                    <WithReason
                      label="Remove post"
                      onSubmit={(reason) =>
                        act(
                          () =>
                            ownerRpc("owner_remove_creator_post", {
                              _id: p.id,
                              _removed: true,
                              _reason: reason,
                            }),
                          "Post removed",
                        )
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const dollars = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
const percent = (b: number | null) => (b === null ? "" : String(b / 100));
const toCents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));
const toBps = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));

function Settings({ s, onSaved }: { s: OwnerCreatorSubscriptionSettings; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(s.enabled);
  const [min, setMin] = useState(dollars(s.price_min_cents));
  const [max, setMax] = useState(dollars(s.price_max_cents));
  const [yPct, setYPct] = useState(percent(s.yooits_percent_bps));
  const [yFixed, setYFixed] = useState(dollars(s.yooits_fixed_cents));
  const [sPct, setSPct] = useState(percent(s.stripe_percent_bps));
  const [sFixed, setSFixed] = useState(dollars(s.stripe_fixed_cents));
  const [busy, setBusy] = useState(false);

  const rateFields = [yPct, yFixed, sPct, sFixed];
  const someRates = rateFields.some((v) => v.trim() !== "");
  const allRates = rateFields.every((v) => v.trim() !== "");
  const rates = parseFeeRates({
    yooits_percent_bps: toBps(yPct),
    yooits_fixed_cents: toCents(yFixed),
    stripe_percent_bps: toBps(sPct),
    stripe_fixed_cents: toCents(sFixed),
  });
  const example = creatorFeeBreakdown(500, rates);

  const save = async (nextEnabled = enabled) => {
    setBusy(true);
    try {
      await ownerRpc("owner_set_creator_subscription_settings", {
        _enabled: nextEnabled,
        _price_min_cents: toCents(min),
        _price_max_cents: toCents(max),
        _yooits_percent_bps: toBps(yPct),
        _yooits_fixed_cents: toCents(yFixed),
        _stripe_percent_bps: toBps(sPct),
        _stripe_fixed_cents: toCents(sFixed),
      });
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <div className={`${box} flex items-center justify-between`}>
        <div>
          <div className="font-medium">Creator subscriptions for everyone</div>
          <div className="text-sm text-muted-foreground">
            {s.enabled
              ? "On. Creators can apply, set a price and post. Nothing can be bought."
              : "Off. Only admins see it."}
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={busy}
          onCheckedChange={(on) => {
            setEnabled(on);
            void save(on);
          }}
          aria-label="Creator subscriptions for everyone"
        />
      </div>

      <div className={box}>
        <div className="font-medium">Prices and fees</div>
        <p className="text-sm text-muted-foreground">
          These are yours to set. The fee rates are blank until you choose them, and with no rates
          no subscriber total can be shown. Changing them doesn't change what existing subscribers
          pay.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Field label="Lowest price ($)" value={min} onChange={setMin} />
          <Field label="Highest price ($)" value={max} onChange={setMax} />
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          <Field label="Yooits.me fee (%)" value={yPct} onChange={setYPct} placeholder="Not set" />
          <Field label="Yooits.me fee ($)" value={yFixed} onChange={setYFixed} placeholder="Not set" />
          <Field label="Processing (%)" value={sPct} onChange={setSPct} placeholder="Not set" />
          <Field label="Processing ($)" value={sFixed} onChange={setSFixed} placeholder="Not set" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Processing is your estimate of Stripe's card fee, which the subscriber's fee also covers.
          Check it against your Stripe pricing.
        </p>
        {example ? (
          <p className="mt-2 text-sm">
            For a {formatCents(500)} price: the creator keeps {formatCents(500)}, the subscriber
            pays {formatCents(example.total)} before tax (fee {formatCents(example.serviceFee)}),
            and Yooits.me keeps about {formatCents(example.yooitsNet)} after processing.
          </p>
        ) : (
          someRates && (
            <p className="mt-2 text-sm text-muted-foreground">
              Fill in all four fee fields, or none.
            </p>
          )
        )}
        <Button
          className="mt-3"
          variant="secondary"
          disabled={busy || (someRates && !(allRates && rates))}
          onClick={() => save()}
        >
          Save prices and fees
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="text-sm">
      {label}
      <Input
        type="number"
        min={0}
        step="0.01"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-32"
      />
    </label>
  );
}

export function Decide({
  approveLabel,
  onApprove,
  onReject,
}: {
  approveLabel: string;
  onApprove: () => void;
  onReject: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={onApprove}>
        {approveLabel}
      </Button>
      <Input
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason, shown to the creator"
        className="h-9 w-64"
      />
      <Button size="sm" variant="secondary" disabled={!note.trim()} onClick={() => onReject(note)}>
        Reject
      </Button>
    </div>
  );
}

export function WithReason({ label, onSubmit }: { label: string; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Input
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason, shown to the creator"
        className="h-9 w-64"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!reason.trim()}
        onClick={() => onSubmit(reason)}
      >
        {label}
      </Button>
    </div>
  );
}
