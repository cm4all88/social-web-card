import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatUsd } from "@/lib/tipping/money";

/** Yooits-admin-only platform revenue report. Access is enforced in the database function. */
export const Route = createFileRoute("/admin_/revenue")({
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
  needs_review_tips: number;
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
        { label: "Service fees collected", value: formatUsd(report.platform_fee_cents) },
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
          note: "Stripe's numbers didn't match ours",
        },
      ]
    : [];

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-6 text-3xl font-bold">Tip revenue</h1>
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
      </div>
    </div>
  );
}
