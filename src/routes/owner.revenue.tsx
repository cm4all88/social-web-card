import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { formatUsd } from "@/lib/tipping/money";
import { TipApprovals } from "@/components/owner/TipApprovals";

/** Yooits-admin-only platform revenue report. Access is enforced in the database function. */
export const Route = createFileRoute("/owner/revenue")({
  component: RevenuePage,
  head: () => ({
    meta: [{ title: "Tip revenue — Yooits" }, { name: "robots", content: "noindex" }],
  }),
});

type Report = {
  successful_tips: number;
  gross_tip_volume_cents: number;
  gross_charged_cents: number;
  platform_fee_cents: number;
  platform_fee_refunded_cents: number;
  net_platform_fee_cents: number;
  refunded_tips: number;
  amount_refunded_cents: number;
  disputed_tips: number;
  disputes_lost: number;
  average_tip_cents: number;
  creators_receiving_tips: number;
  active_connected_creators: number;
  pending_connected_creators: number;
  suspended_creators: number;
  needs_review_tips: number;
  unconfirmed_fee_tips: number;
  unconfirmed_fee_cents: number;
  fee_mismatch_tips: number;
  // Stripe test-mode activity, kept out of every number above (added Nov 21).
  test_mode?: {
    successful_tips: number;
    gross_tip_volume_cents: number;
    net_platform_fee_cents: number;
    refunded_tips: number;
    connected_accounts: number;
  };
};

const PERIODS = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "all", label: "All time", days: null },
] as const;

function RevenuePage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("30");
  const [report, setReport] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return navigate({ to: "/auth" });
      setState("loading");
      const days = PERIODS.find((p) => p.key === period)?.days ?? null;
      const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
      const { data: r, error } = await supabase.rpc(
        "admin_tip_report",
        since ? { _since: since } : {},
      );
      if (error) return setState(error.code === "42501" ? "denied" : "error");
      setReport(r as unknown as Report);
      setState("ready");
    })();
  }, [period, navigate]);

  const tiles: { label: string; value: string; note?: string }[] = report
    ? [
        {
          label: "Net Yooits revenue",
          value: formatUsd(report.net_platform_fee_cents),
          note: "Service fees kept, after fee refunds",
        },
        { label: "Successful tips", value: report.successful_tips.toLocaleString() },
        {
          label: "Gross tip volume",
          value: formatUsd(report.gross_tip_volume_cents),
          note: "Paid to creators, before Stripe fees",
        },
        { label: "Average tip", value: formatUsd(report.average_tip_cents) },
        {
          label: "Service fees collected",
          value: formatUsd(report.platform_fee_cents),
          note: "Confirmed by Stripe",
        },
        {
          label: "Fees awaiting Stripe",
          value: formatUsd(report.unconfirmed_fee_cents),
          note: `${report.unconfirmed_fee_tips} tip${report.unconfirmed_fee_tips === 1 ? "" : "s"} not yet confirmed`,
        },
        { label: "Service fees refunded", value: formatUsd(report.platform_fee_refunded_cents) },
        {
          label: "Refunded tips",
          value: `${report.refunded_tips} (${formatUsd(report.amount_refunded_cents)})`,
        },
        { label: "Disputes", value: `${report.disputed_tips} (${report.disputes_lost} lost)` },
        {
          label: "Creators receiving tips",
          value: report.creators_receiving_tips.toLocaleString(),
        },
        {
          label: "Connected creators",
          value: report.active_connected_creators.toLocaleString(),
          note: `${report.pending_connected_creators} still in setup`,
        },
        {
          label: "Tips needing review",
          value: report.needs_review_tips.toLocaleString(),
          note: `Stripe's numbers didn't match ours${report.fee_mismatch_tips ? ` · ${report.fee_mismatch_tips} fee mismatch` : ""}`,
        },
        {
          label: "Suspended creators",
          value: report.suspended_creators.toLocaleString(),
        },
      ]
    : [];

  return (
    <div>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold">Money</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Totals only. Stripe charges its processing fees to creators, so these are Yooits&apos;
          gross margin before hosting and other running costs.
        </p>

        <div className="mt-6 flex gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`rounded-full border px-3 py-1 text-sm ${period === p.key ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {state === "loading" && (
          <Loader2 className="mt-10 h-6 w-6 animate-spin text-muted-foreground" />
        )}
        {state === "denied" && (
          <p className="mt-10 text-muted-foreground">Only Yooits admins can see this report.</p>
        )}
        {state === "error" && (
          <p className="mt-10 text-muted-foreground">
            The report couldn&apos;t load. Try again shortly.
          </p>
        )}
        {state === "ready" && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-2xl border border-border bg-card p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t.label}
                </div>
                <div className="mt-1 text-2xl font-bold">{t.value}</div>
                {t.note && <div className="mt-1 text-xs text-muted-foreground">{t.note}</div>}
              </div>
            ))}
          </div>
        )}
        {state === "ready" &&
          report?.test_mode &&
          report.test_mode.successful_tips + report.test_mode.connected_accounts > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Stripe test mode, not counted above: {report.test_mode.successful_tips} test tip
              {report.test_mode.successful_tips === 1 ? "" : "s"} ({report.test_mode.refunded_tips}{" "}
              refunded), {report.test_mode.connected_accounts} test account
              {report.test_mode.connected_accounts === 1 ? "" : "s"}. No real money.
            </p>
          )}
        {state === "ready" && <TipApprovals />}
        {state === "ready" && <SuspendCreator />}
      </div>
    </div>
  );
}

/** Stop or restore tips for one creator (admins only; enforced in the database). */
function SuspendCreator() {
  const [username, setUsername] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (suspend: boolean) => {
    const name = username.trim().replace(/^@/, "").toLowerCase();
    if (!name) return toast.error("Enter a username");
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_set_tip_suspension", {
      _username: name,
      _suspended: suspend,
      _reason: reason.trim() || undefined,
    });
    setBusy(false);
    if (error) return toast.error("Couldn't update that creator");
    if (!data) return toast.error("No creator with tips set up under that username");
    toast.success(suspend ? `Tips turned off for @${name}` : `Tips allowed again for @${name}`);
  };

  return (
    <div className="mt-8 rounded-2xl border border-border bg-card p-4">
      <div className="font-semibold">Stop a creator&apos;s tips</div>
      <p className="mt-1 text-sm text-muted-foreground">
        For accounts that look like personal money transfers rather than content or services. Their
        profile and wishlists stay up.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr]">
        <Input
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          placeholder="Reason (kept internal)"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="destructive" disabled={busy} onClick={() => submit(true)}>
          Stop tips
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => submit(false)}>
          Allow tips again
        </Button>
      </div>
    </div>
  );
}
