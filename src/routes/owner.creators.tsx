import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ownerRpc, type OwnerCreatorEarnings, type OwnerCreatorMilestone } from "@/lib/owner/api";

/**
 * Creator earnings, step 1: who has real visitors, the milestones they work
 * toward, and the switch that shows the Creator tab to everyone. Nothing here
 * sells or pays anything. Every change is logged in the audit log.
 */
export const Route = createFileRoute("/owner/creators")({
  component: CreatorsPage,
});

function CreatorsPage() {
  const [data, setData] = useState<OwnerCreatorEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await ownerRpc("owner_creator_earnings", {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setSettings = async (args: {
    _enabled: boolean | null;
    _suspicious_pages_per_day?: number | null;
    _suspicious_events_per_day?: number | null;
  }) => {
    setBusy(true);
    try {
      await ownerRpc("owner_set_creator_earnings", args);
      toast.success("Saved");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold">Creators</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Qualifying visitors are people who viewed a creator's page, counted once a day each. The
        creator's own visits, repeat refreshes, bots and suspicious traffic are left out. Reaching a
        milestone unlocks only what it says; a milestone that isn't live unlocks nothing and shows
        as coming later. Paid creator subscriptions aren't built yet, and no one can sell or pay
        through this page.
      </p>
      {error && <p className="mt-6 text-muted-foreground">{error}</p>}
      {!data && !error && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
      {data && (
        <>
          <div className="mt-6 flex items-center justify-between rounded-2xl border border-border p-4">
            <div>
              <div className="font-medium">Creator tab for everyone</div>
              <div className="text-sm text-muted-foreground">
                {data.settings.enabled
                  ? "On. Everyone sees their visitors and milestones on the Creator tab."
                  : "Off. Only admins see the Creator tab."}
              </div>
            </div>
            <Switch
              checked={data.settings.enabled}
              disabled={busy}
              onCheckedChange={(on) => setSettings({ _enabled: on })}
              aria-label="Creator tab for everyone"
            />
          </div>

          <SuspiciousLimits
            pages={data.settings.suspicious_pages_per_day}
            events={data.settings.suspicious_events_per_day}
            busy={busy}
            onSave={(pages, events) =>
              setSettings({
                _enabled: null,
                _suspicious_pages_per_day: pages,
                _suspicious_events_per_day: events,
              })
            }
          />

          <h2 className="mt-8 text-xl font-bold">Milestones</h2>
          <div className="mt-3 space-y-3">
            {data.milestones.map((m) => (
              <MilestoneEditor key={m.key + m.updated_at} m={m} onSaved={load} />
            ))}
          </div>

          <h2 className="mt-8 text-xl font-bold">Creators by qualifying visitors</h2>
          {data.top_creators.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No page views yet.</p>
          ) : (
            <ol className="mt-3 divide-y divide-border rounded-2xl border border-border">
              {data.top_creators.map((c) => (
                <li key={c.user_id} className="flex justify-between p-3 text-sm">
                  <span>@{c.username}</span>
                  <span className="font-medium">
                    {c.qualifying_visitors.toLocaleString("en-US")}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function SuspiciousLimits({
  pages,
  events,
  busy,
  onSave,
}: {
  pages: number;
  events: number;
  busy: boolean;
  onSave: (pages: number, events: number) => void;
}) {
  const [p, setP] = useState(String(pages));
  const [e, setE] = useState(String(events));
  return (
    <div className="mt-4 rounded-2xl border border-border p-4">
      <div className="font-medium">Suspicious traffic</div>
      <p className="text-sm text-muted-foreground">
        A visitor stops counting for the day once they view more than this many different pages, or
        send more than this many events.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Pages a day
          <Input
            type="number"
            min={2}
            value={p}
            onChange={(x) => setP(x.target.value)}
            className="mt-1 w-28"
          />
        </label>
        <label className="text-sm">
          Events a day
          <Input
            type="number"
            min={10}
            value={e}
            onChange={(x) => setE(x.target.value)}
            className="mt-1 w-28"
          />
        </label>
        <Button
          variant="secondary"
          disabled={busy || !Number(p) || !Number(e)}
          onClick={() => onSave(Math.floor(Number(p)), Math.floor(Number(e)))}
        >
          Save limits
        </Button>
      </div>
    </div>
  );
}

function MilestoneEditor({ m, onSaved }: { m: OwnerCreatorMilestone; onSaved: () => void }) {
  const [threshold, setThreshold] = useState(String(m.threshold));
  const [title, setTitle] = useState(m.title);
  const [unlocks, setUnlocks] = useState(m.unlocks);
  const [live, setLive] = useState(m.live);
  const [busy, setBusy] = useState(false);
  const changed =
    Number(threshold) !== m.threshold ||
    title !== m.title ||
    unlocks !== m.unlocks ||
    live !== m.live;

  const save = async () => {
    setBusy(true);
    try {
      await ownerRpc("owner_set_creator_milestone", {
        _key: m.key,
        _threshold: Math.floor(Number(threshold)),
        _title: title,
        _unlocks: unlocks,
        _live: live,
      });
      toast.success("Milestone saved");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Visitors
          <Input
            type="number"
            min={1}
            value={threshold}
            onChange={(x) => setThreshold(x.target.value)}
            className="mt-1 w-28"
          />
        </label>
        <label className="min-w-48 flex-1 text-sm">
          Title
          <Input
            value={title}
            maxLength={80}
            onChange={(x) => setTitle(x.target.value)}
            className="mt-1"
          />
        </label>
      </div>
      <label className="mt-3 block text-sm">
        What it unlocks
        <Input
          value={unlocks}
          maxLength={240}
          onChange={(x) => setUnlocks(x.target.value)}
          className="mt-1"
        />
      </label>
      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={live} onCheckedChange={setLive} aria-label={`${m.title} is live`} />
          {live ? "Live: reaching it unlocks this" : "Not live: shown as coming later"}
        </label>
        <Button size="sm" disabled={!changed || busy || !(Number(threshold) >= 1)} onClick={save}>
          Save
        </Button>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">Key: {m.key}</div>
    </div>
  );
}
