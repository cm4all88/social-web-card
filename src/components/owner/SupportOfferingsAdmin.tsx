/**
 * Owner Console: Support Offerings (issue #7). Turn the feature on for
 * creators, set price limits, review each version's real deliverable before it
 * can be offered, and pause an offering. Every change is written to the audit
 * log. There is no checkout yet, so nothing here sells anything.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { formatCents } from "@/lib/creator/fees";
import { ownerRpc, type OwnerSupportOfferings, type OwnerSupportVersion } from "@/lib/owner/api";
import { PLATFORM_FEE_CENTS } from "@/lib/tipping/money";
import { Decide, WithReason } from "./CreatorSubscriptionsAdmin";

const box = "rounded-2xl border border-border p-4";

export function SupportOfferingsAdmin() {
  const [data, setData] = useState<OwnerSupportOfferings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await ownerRpc("owner_support_offerings", {}));
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

  const pending = (data?.offerings ?? []).flatMap((o) =>
    (o.versions ?? []).filter((v) => v.status === "pending").map((v) => ({ o, v })),
  );
  const listed = (data?.offerings ?? []).filter((o) =>
    (o.versions ?? []).some((v) => v.status === "approved"),
  );

  return (
    <section className="mt-12">
      <h2 className="text-2xl font-bold">Support Offerings</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Creators keep the whole price; supporters pay the {formatCents(PLATFORM_FEE_CENTS)} Yooits.me
        service fee on top. Approve only real deliverables, never a disguised money transfer.
        There's no checkout yet, so nothing can be bought.
      </p>
      {error && <p className="mt-4 text-muted-foreground">{error}</p>}
      {!data && !error && <Loader2 className="mt-6 h-6 w-6 animate-spin text-muted-foreground" />}
      {data && (
        <>
          <Settings key={data.settings.updated_at} s={data.settings} onSaved={load} />

          <h3 className="mt-8 text-lg font-bold">Waiting for review</h3>
          {pending.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing waiting.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {pending.map(({ o, v }) => (
                <div key={v.id} className={box}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">@{o.username ?? "deleted"}</span>
                    <span className="text-sm text-muted-foreground">
                      version {v.version} · {new Date(v.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <VersionDetails v={v} />
                  <Decide
                    approveLabel="Approve offering"
                    onApprove={() =>
                      act(
                        () =>
                          ownerRpc("owner_decide_support_version", { _id: v.id, _approve: true }),
                        "Offering approved",
                      )
                    }
                    onReject={(note) =>
                      act(
                        () =>
                          ownerRpc("owner_decide_support_version", {
                            _id: v.id,
                            _approve: false,
                            _note: note,
                          }),
                        "Offering rejected",
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <h3 className="mt-8 text-lg font-bold">Approved offerings</h3>
          {listed.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">None yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {listed.map((o) => {
                const v = (o.versions ?? []).find((x) => x.status === "approved")!;
                return (
                  <div key={o.id} className={box}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">
                        @{o.username ?? "deleted"} · {v.title}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {o.archived
                          ? "Archived"
                          : o.suspended
                            ? `Paused: ${o.suspended_reason ?? ""}`
                            : "Approved"}
                      </span>
                    </div>
                    {o.suspended ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-3"
                        onClick={() =>
                          act(
                            () =>
                              ownerRpc("owner_set_support_offering_suspended", {
                                _offering_id: o.id,
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
                        label="Pause offering"
                        onSubmit={(reason) =>
                          act(
                            () =>
                              ownerRpc("owner_set_support_offering_suspended", {
                                _offering_id: o.id,
                                _suspended: true,
                                _reason: reason,
                              }),
                            "Paused",
                          )
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function VersionDetails({ v }: { v: OwnerSupportVersion }) {
  const [opening, setOpening] = useState(false);
  const openFile = async () => {
    if (!v.file_path) return;
    setOpening(true);
    try {
      const { data, error } = await supabase.storage
        .from("support-files")
        .createSignedUrl(v.file_path, 300);
      if (error || !data?.signedUrl) throw new Error(error?.message ?? "Couldn't open the file.");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="mt-2 space-y-1 text-sm">
      <p className="font-medium">
        {v.title} · {v.kind.replace("_", " ")} · from {formatCents(v.min_price_cents)}
        {v.allow_pay_more ? " or more" : ""}
      </p>
      <p className="whitespace-pre-wrap">{v.description}</p>
      <p className="text-muted-foreground">Supporters get: {v.what_you_get}</p>
      {v.content_body && (
        <p className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-muted p-3 text-xs">
          {v.content_body}
        </p>
      )}
      {v.file_path && (
        <Button size="sm" variant="outline" disabled={opening} onClick={() => void openFile()}>
          Open {v.file_name ?? "file"}
        </Button>
      )}
    </div>
  );
}

function Settings({ s, onSaved }: { s: OwnerSupportOfferings["settings"]; onSaved: () => void }) {
  const [min, setMin] = useState((s.price_min_cents / 100).toFixed(2));
  const [max, setMax] = useState((s.price_max_cents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const save = async (enabled: boolean | null, withPrices: boolean) => {
    setBusy(true);
    try {
      await ownerRpc("owner_set_support_offering_settings", {
        _enabled: enabled,
        _price_min_cents: withPrices ? Math.round(Number(min) * 100) : null,
        _price_max_cents: withPrices ? Math.round(Number(max) * 100) : null,
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
    <div className={`mt-6 ${box}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">Support Offerings for creators</div>
          <div className="text-sm text-muted-foreground">
            {s.enabled
              ? "On. Creators can add offerings for review. Supporters still can't buy."
              : "Off. Only admins can add offerings."}
          </div>
        </div>
        <Switch
          checked={s.enabled}
          disabled={busy}
          onCheckedChange={(on) => void save(on, false)}
          aria-label="Support Offerings for creators"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Lowest price
          <Input className="mt-1 w-28" value={min} onChange={(e) => setMin(e.target.value)} />
        </label>
        <label className="text-sm">
          Highest price
          <Input className="mt-1 w-28" value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
        <Button
          variant="secondary"
          disabled={busy || !(Number(min) > 0) || !(Number(max) >= Number(min))}
          onClick={() => void save(null, true)}
        >
          Save limits
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Checkout: {s.checkout_enabled ? "on" : "off"}. It stays off until Stripe approves creator
        payments.
      </p>
    </div>
  );
}
