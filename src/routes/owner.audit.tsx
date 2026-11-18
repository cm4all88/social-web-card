import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { auditLabel, ownerRpc, type AuditEntry } from "@/lib/owner/api";

const PAGE = 50;

export const Route = createFileRoute("/owner/audit")({
  component: AuditPage,
});

function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (before: number | null) => {
    try {
      const page = await ownerRpc("owner_audit_log", { _limit: PAGE, _before_id: before });
      setEntries((prev) => (before === null ? page : [...(prev ?? []), ...page]));
      setMore(page.length === PAGE);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold">Audit log</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Admin access, invite codes and stopped tips, recorded by the database. Entries can't be edited or deleted.
      </p>
      {error && <p className="mt-6 text-muted-foreground">{error}</p>}
      {!entries && !error && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
      {entries?.length === 0 && <p className="mt-6 text-muted-foreground">Nothing recorded yet.</p>}
      {entries && entries.length > 0 && (
        <ul className="mt-6 divide-y divide-border rounded-2xl border border-border">
          {entries.map((e) => (
            <li key={e.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{auditLabel(e.action)}</span>
                <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
              </div>
              <div className="mt-1 text-muted-foreground">
                By {e.actor_username ? `@${e.actor_username}` : e.actor_user_id ? "an account with no profile" : "the database console"}
                {e.target_type === "user" && e.target_id && (
                  <>
                    {" · "}
                    <Link to="/owner/users/$userId" params={{ userId: e.target_id }} className="underline">
                      {e.target_username ? `@${e.target_username}` : "user"}
                    </Link>
                  </>
                )}
                {typeof e.details?.reason === "string" && e.details.reason && ` · ${e.details.reason}`}
              </div>
            </li>
          ))}
        </ul>
      )}
      {more && entries && (
        <Button className="mt-4" variant="outline" onClick={() => load(entries[entries.length - 1].id)}>
          Show older
        </Button>
      )}
    </div>
  );
}
