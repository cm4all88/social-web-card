/** Small, dependency-free charts for analytics: daily bars and ranked lists. */
import { cn } from "@/lib/utils";

export function RangePicker<T extends number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time range"
      className="inline-flex rounded-full border border-border p-0.5 text-xs"
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full px-3 py-1 transition",
            value === o
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o} days
        </button>
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string | null;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {note && <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Daily bars for one or two series. */
export function DailyBars({
  data,
  series,
}: {
  data: { day: string; [k: string]: number | string }[];
  series: { key: string; label: string; className: string }[];
}) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  return (
    <div>
      <div
        className="flex h-32 items-end gap-px"
        role="img"
        aria-label={`Daily ${series.map((s) => s.label).join(" and ")}`}
      >
        {data.map((d) => (
          <div
            key={d.day}
            className="flex h-full min-w-0 flex-1 items-end gap-px"
            title={`${shortDay(d.day)}: ${series.map((s) => `${Number(d[s.key]) || 0} ${s.label.toLowerCase()}`).join(", ")}`}
          >
            {series.map((s) => (
              <div
                key={s.key}
                className={cn("min-w-0 flex-1 rounded-t-sm", s.className)}
                style={{
                  height: `${((Number(d[s.key]) || 0) / max) * 100}%`,
                  minHeight: Number(d[s.key]) ? 2 : 0,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{data[0] ? shortDay(data[0].day) : ""}</span>
        <span className="flex gap-3">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className={cn("inline-block h-2 w-2 rounded-sm", s.className)} /> {s.label}
            </span>
          ))}
        </span>
        <span>{data.length ? shortDay(data[data.length - 1].day) : ""}</span>
      </div>
    </div>
  );
}

/** A ranked list with a bar behind each value. */
export function RankList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { label: string; value: number; note?: string }[];
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r, i) => (
            <li
              key={`${r.label}-${i}`}
              className="relative overflow-hidden rounded-md px-2 py-1 text-sm"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-md bg-primary/10"
                style={{ width: `${(r.value / max) * 100}%` }}
              />
              <div className="relative flex items-center justify-between gap-3">
                <span className="min-w-0 truncate">
                  {r.label}
                  {r.note && <span className="ml-1 text-xs text-muted-foreground">{r.note}</span>}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {r.value.toLocaleString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
