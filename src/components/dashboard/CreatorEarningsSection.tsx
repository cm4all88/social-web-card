/**
 * Creator tab: qualifying visitors and progress toward creator milestones.
 * Read-only. No prices, purchase or subscription controls: those come only
 * once creator subscriptions work and Stripe has approved them.
 */
import { Progress } from "@/components/ui/progress";
import { milestoneStatus, nextMilestone, type CreatorEarnings } from "@/lib/creator/earnings";

const fmt = (n: number) => n.toLocaleString("en-US");

export function CreatorEarningsSection({ data }: { data: CreatorEarnings }) {
  if (!data.visible) return null;
  const next = nextMilestone(data.qualifying_visitors, data.milestones);
  return (
    <div className="mt-4 space-y-4">
      {!data.enabled && (
        <p className="rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
          Only admins see this tab until it's turned on in the Owner Console.
        </p>
      )}
      <div
        className="rounded-2xl border border-border bg-card p-5"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="text-sm text-muted-foreground">Qualifying visitors</div>
        <div className="mt-1 text-3xl font-bold" data-testid="qualifying-visitors">
          {fmt(data.qualifying_visitors)}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          People who visited your page, counted once a day each. Your own visits, repeat refreshes,
          bots and suspicious traffic don't count.
        </p>
        {!data.analytics_enabled && (
          <p className="mt-2 text-sm text-muted-foreground">
            Visitors are counted once analytics is switched on for Yooits.
          </p>
        )}
        {next && (
          <div className="mt-4">
            <div className="flex justify-between text-sm">
              <span>Next: {next.milestone.title}</span>
              <span className="text-muted-foreground">{fmt(next.remaining)} to go</span>
            </div>
            <Progress
              value={Math.round(next.progress * 100)}
              className="mt-2"
              aria-label={`Progress to ${next.milestone.title}`}
            />
          </div>
        )}
      </div>

      <ol className="space-y-2" aria-label="Creator milestones">
        {data.milestones.map((m) => (
          <li
            key={m.key}
            className="flex items-start justify-between gap-3 rounded-2xl border border-border p-4"
          >
            <div>
              <div className="font-medium">
                {fmt(m.threshold)} visitors: {m.title}
              </div>
              <div className="text-sm text-muted-foreground">{m.unlocks}</div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                m.live && m.reached
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground"
              }`}
            >
              {milestoneStatus(m)}
            </span>
          </li>
        ))}
      </ol>

      <p className="text-sm text-muted-foreground">
        Paid creator subscriptions aren't available on Yooits yet.
      </p>
    </div>
  );
}
