import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ownerRpc, type AbuseReport } from "@/lib/owner/api";
import { reportReasonLabel } from "@/lib/reports/reasons";

export const Route = createFileRoute("/owner/reports")({
  component: ReportsPage,
});

const FILTERS = [
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
] as const;

type Filter = (typeof FILTERS)[number]["id"];

function ReportsPage() {
  const [filter, setFilter] = useState<Filter>("open");
  const [reports, setReports] = useState<AbuseReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: Filter) => {
    setReports(null);
    setError(null);
    try {
      setReports(await ownerRpc("owner_list_reports", { _status: f }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold">Reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pages and wishlists that visitors reported. To act on one, open the person and unpublish or suspend
        them, then mark the report resolved. Closing a report is recorded in the audit log.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "outline"} onClick={() => setFilter(f.id)}>
            {f.label}
          </Button>
        ))}
      </div>
      {error && <p className="mt-6 text-muted-foreground">{error}</p>}
      {!reports && !error && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
      {reports?.length === 0 && <p className="mt-6 text-muted-foreground">No reports here.</p>}
      {reports && reports.length > 0 && (
        <ul className="mt-6 space-y-3">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} onChanged={() => load(filter)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportCard({ report: r, onChanged }: { report: AbuseReport; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const close = async (status: "resolved" | "dismissed" | "open") => {
    setBusy(true);
    try {
      await ownerRpc("owner_resolve_report", { _id: r.id, _status: status, _note: note || null });
      toast.success(status === "open" ? "Report reopened" : `Report ${status}`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const who = r.target_username ? `@${r.target_username}` : "a deleted account";
  return (
    <li className="rounded-2xl border border-border p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{reportReasonLabel(r.reason)}</span>
        <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
      </div>
      <div className="mt-1 text-muted-foreground">
        {r.target_kind === "wishlist" ? `Wishlist "${r.wishlist_title ?? r.wishlist_slug ?? "deleted"}" by ` : "Page of "}
        <Link to="/owner/users/$userId" params={{ userId: r.target_user_id }} className="underline">
          {who}
        </Link>
        {r.reporter_contact && ` · reply to ${r.reporter_contact}`}
      </div>
      {r.details && <p className="mt-2 whitespace-pre-wrap">{r.details}</p>}
      {r.status === "open" ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input placeholder="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => close("resolved")}>
            Resolved
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => close("dismissed")}>
            Dismiss
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {r.status === "resolved" ? "Resolved" : "Dismissed"}
            {r.resolved_at && ` ${new Date(r.resolved_at).toLocaleDateString()}`}
            {r.resolution_note && ` · ${r.resolution_note}`}
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => close("open")}>
            Reopen
          </Button>
        </div>
      )}
    </li>
  );
}
