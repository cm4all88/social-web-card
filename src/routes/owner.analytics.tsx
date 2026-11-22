import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { getPlatform } from "@/lib/platforms";
import { sourceLabel } from "@/lib/analytics/source";
import {
  loadOwnerAnalytics,
  setAnalyticsEnabled,
  type OwnerAnalytics,
  type Range,
} from "@/lib/analytics/api";
import { DailyBars, RangePicker, RankList, Stat } from "@/components/analytics/Charts";

export const Route = createFileRoute("/owner/analytics")({
  component: OwnerAnalyticsPage,
});

const RANGES = [7, 30, 90] as const;

function OwnerAnalyticsPage() {
  const [days, setDays] = useState<Range>(30);
  const [data, setData] = useState<OwnerAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadOwnerAnalytics(days).then(
      (d) => !cancelled && (setData(d), setError(null)),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [days, reload]);

  const toggle = async (on: boolean) => {
    setSaving(true);
    try {
      await setAnalyticsEnabled(on);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const u = data?.users;
  const t = data?.traffic;
  const c = data?.conversions;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <RangePicker value={days} options={RANGES} onChange={(v) => setDays(v as Range)} />
      </div>
      {error && <p className="mt-6 text-muted-foreground">{error}</p>}
      {!data && !error && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
      {data && u && t && c && (
        <>
          <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4">
            <div>
              <div className="font-medium">Record views and clicks</div>
              <div className="text-sm text-muted-foreground">
                {data.enabled
                  ? "On. Every user sees their own stats on their dashboard."
                  : "Off. Nothing is recorded and users don't see a stats section."}
              </div>
            </div>
            <Switch
              checked={data.enabled}
              disabled={saving}
              onCheckedChange={toggle}
              aria-label="Record views and clicks"
            />
          </div>

          <h2 className="mt-8 text-lg font-semibold">Users</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Accounts" value={u.total} note={`${u.signups} new in ${data.days} days`} />
            <Stat
              label="Active, 7 days"
              value={u.active_7d}
              note={`${u.active_30d} in 30 days (signed in)`}
            />
            <Stat label="Pages with links" value={u.pages_published} />
            <Stat
              label="Pages with visitors"
              value={u.pages_with_traffic}
              note={`in ${data.days} days`}
            />
          </div>

          <h2 className="mt-8 text-lg font-semibold">Traffic</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Profile views" value={t.profile_views} />
            <Stat label="Link clicks" value={t.link_clicks} />
            <Stat label="Wishlist views" value={t.wishlist_views} />
            <Stat
              label="Home page views"
              value={t.home_views}
              note={`${t.signup_clicks} sign-up clicks`}
            />
          </div>
          <div className="mt-4 rounded-2xl border border-border bg-card p-4">
            <DailyBars
              data={data.daily}
              series={[
                { key: "views", label: "Views", className: "bg-primary/70" },
                { key: "clicks", label: "Clicks", className: "bg-accent" },
              ]}
            />
          </div>

          <h2 className="mt-8 text-lg font-semibold">Conversions</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Visit to sign-up"
              value={c.visit_to_signup_pct === null ? "No visits yet" : `${c.visit_to_signup_pct}%`}
              note={`${c.signups} sign-ups from ${c.home_visitors} home visitors`}
            />
            <Stat
              label="Founding Members"
              value={c.founding_active}
              note={`${c.founding_new} joined in ${data.days} days`}
            />
            <Stat
              label="Paid Plus"
              value={c.plus_paid ?? 0}
              note={
                c.free_to_plus_pct === null
                  ? "Paid checkout is off"
                  : `${c.free_to_plus_pct}% of accounts`
              }
            />
            <Stat
              label="Sign-up clicks"
              value={t.signup_clicks}
              note="Home page and profile footers"
            />
          </div>

          <h2 className="mt-8 text-lg font-semibold">Growth</h2>
          <div className="mt-3 rounded-2xl border border-border bg-card p-4">
            <DailyBars
              data={data.daily}
              series={[{ key: "signups", label: "Sign-ups", className: "bg-primary/70" }]}
            />
            <div className="mt-4 text-sm text-muted-foreground">
              Accounts by week:{" "}
              {data.growth
                .slice(-6)
                .map(
                  (g) =>
                    `${new Date(`${g.week}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} ${g.total}`,
                )
                .join(" · ")}
            </div>
          </div>

          <div className="mt-8 grid gap-6 rounded-2xl border border-border bg-card p-4 md:grid-cols-2">
            <RankList
              title="Top link destinations (clicks)"
              empty="No clicks yet."
              rows={data.destinations.map((d) => ({ label: d.host, value: d.clicks }))}
            />
            <RankList
              title="Platforms (links on pages)"
              empty="No links yet."
              rows={data.platforms.map((p) => ({
                label: getPlatform(p.platform).label,
                note: `${p.clicks.toLocaleString()} clicks`,
                value: p.links,
              }))}
            />
            <RankList
              title="Traffic sources (views)"
              empty="No views yet."
              rows={data.sources.map((s) => ({ label: sourceLabel(s.source), value: s.views }))}
            />
            <RankList
              title="Most viewed pages"
              empty="No views yet."
              rows={data.top_pages.map((p) => ({
                label: `@${p.username}`,
                note: `${p.clicks} clicks`,
                value: p.views,
              }))}
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Visitors are counted once a day from a salted hash that changes daily; no IP addresses
            are stored. Do Not Track, Global Privacy Control and known bots are skipped.
          </p>
        </>
      )}
    </div>
  );
}
