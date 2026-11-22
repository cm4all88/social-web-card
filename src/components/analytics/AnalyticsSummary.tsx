/** A one-line stats strip for the top of the dashboard: last 30 days, with a link to the full view. */
import { useEffect, useState } from "react";
import { BarChart3, ChevronRight } from "lucide-react";
import { loadMyAnalytics, pct, type MyAnalytics } from "@/lib/analytics/api";

export function AnalyticsSummary({ onOpen }: { onOpen: () => void }) {
  const [data, setData] = useState<MyAnalytics | null>(null);

  useEffect(() => {
    let live = true;
    loadMyAnalytics(30).then(
      (d) => live && setData(d),
      () => live && setData(null),
    );
    return () => {
      live = false;
    };
  }, []);

  // Hidden while analytics is off (or not in the database), like the full view.
  if (!data?.enabled) return null;
  const t = data.totals;
  const items = [
    { label: "Views", value: t.views.toLocaleString() },
    { label: "Clicks", value: t.clicks.toLocaleString() },
    { label: "Click rate", value: pct(t.clicks, t.views) },
  ];

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition hover:border-primary/50"
      style={{ boxShadow: "var(--shadow-card)" }}
      aria-label={`Stats for the last 30 days: ${items.map((i) => `${i.value} ${i.label.toLowerCase()}`).join(", ")}. Open analytics.`}
    >
      <BarChart3 className="h-5 w-5 shrink-0 text-primary" />
      <div className="grid flex-1 grid-cols-3 gap-2">
        {items.map((i) => (
          <div key={i.label} className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {i.label}
            </div>
            <div className="truncate text-lg font-bold leading-tight">{i.value}</div>
          </div>
        ))}
      </div>
      <span className="hidden text-xs text-muted-foreground sm:inline">Last 30 days</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
