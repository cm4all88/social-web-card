/** "Your stats" on the dashboard: views, visitors, clicks and where visitors came from. */
import { useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { getPlatform } from "@/lib/platforms";
import { sourceLabel } from "@/lib/analytics/source";
import {
  change,
  loadMyAnalytics,
  pct,
  type MyAnalytics as Data,
  type Range,
} from "@/lib/analytics/api";
import { DailyBars, RangePicker, RankList, Stat } from "./Charts";

const RANGES = [7, 30, 90] as const;

function changeNote(now: number, before: number): string | null {
  const c = change(now, before);
  if (c === null) return null;
  return `${c > 0 ? "+" : ""}${c}% vs previous period`;
}

export function MyAnalytics() {
  const [days, setDays] = useState<Range>(30);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadMyAnalytics(days).then(
      (d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [days]);

  // Behind the owner's switch: nothing shows until analytics is on (or if the
  // analytics functions aren't in the database, so a rollback never breaks the dashboard).
  if (!loading && (error || !data?.enabled)) return null;
  if (loading && !data) return null;
  if (!data) return null;

  const t = data.totals;
  const hasAny = t.views + t.clicks + t.wishlist_views > 0;

  return (
    <div
      id="analytics"
      className="mt-8 scroll-mt-20 rounded-2xl border border-border bg-card p-5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <BarChart3 className="h-5 w-5" /> Your stats
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </h2>
        <RangePicker value={days} options={RANGES} onChange={(v) => setDays(v as Range)} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Page views" value={t.views} note={changeNote(t.views, data.previous.views)} />
        <Stat label="Visitors" value={t.visitors} note="Counted once a day" />
        <Stat
          label="Link clicks"
          value={t.clicks}
          note={changeNote(t.clicks, data.previous.clicks)}
        />
        <Stat
          label="Click rate"
          value={pct(t.clicks, t.views)}
          note={t.wishlist_views ? `${t.wishlist_views} wishlist views` : null}
        />
      </div>

      {!hasAny ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No visits yet in the last {data.days} days. Share your link and your views and clicks show
          up here.
        </p>
      ) : (
        <>
          <div className="mt-6">
            <DailyBars
              data={data.daily}
              series={[
                { key: "views", label: "Views", className: "bg-primary/70" },
                { key: "clicks", label: "Clicks", className: "bg-accent" },
              ]}
            />
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <RankList
              title="Clicks by link"
              empty="No clicks yet."
              rows={data.links.map((l) => ({
                label: getPlatform(l.platform ?? "website").label,
                note: [l.host, l.current ? null : "(removed)"].filter(Boolean).join(" "),
                value: l.clicks,
              }))}
            />
            <RankList
              title="Where visitors came from"
              empty="No views yet."
              rows={data.sources.map((s) => ({ label: sourceLabel(s.source), value: s.views }))}
            />
            {data.campaigns.length > 0 && (
              <RankList
                title="Campaigns (UTM tags)"
                empty=""
                rows={data.campaigns.map((c) => ({
                  label: c.utm_campaign || c.utm_source || "untagged",
                  note: [c.utm_source, c.utm_medium].filter(Boolean).join(" / "),
                  value: c.views,
                }))}
              />
            )}
            <RankList
              title="Devices"
              empty="No views yet."
              rows={data.devices.map((d) => ({
                label:
                  d.device === "unknown"
                    ? "Unknown"
                    : d.device[0].toUpperCase() + d.device.slice(1),
                value: d.views,
              }))}
            />
          </div>
        </>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Your own visits while signed in aren't counted. Visitors who ask browsers not to track them
        aren't counted either.
      </p>
    </div>
  );
}
