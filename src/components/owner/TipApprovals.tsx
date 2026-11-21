import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  creator_type: string | null;
  offering: string | null;
  stripe_status: string | null;
  charges_enabled: boolean;
  approved_at: string | null;
};

/**
 * Creators who have set up tips, waiting ones first. Approve or withdraw on
 * each user's page (Account controls); the database checks admin access.
 */
export function TipApprovals() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Not in the generated types yet; called as a method so the client keeps its `this`.
    const client = supabase as unknown as {
      rpc: (f: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    client.rpc("owner_list_tip_approvals").then(({ data, error: e }) => {
      if (e) setError(true);
      else setRows((data ?? []) as Row[]);
    });
  }, []);

  const waiting = rows?.filter((r) => !r.approved_at).length ?? 0;
  return (
    <div className="mt-8 rounded-2xl border border-border bg-card p-4">
      <div className="font-semibold">Tip approvals{rows ? ` (${waiting} waiting)` : ""}</div>
      <p className="mt-1 text-sm text-muted-foreground">
        No creator can take tips until you approve them. Check that tips are for their content or a
        service, then approve on their user page.
      </p>
      {error && <p className="mt-3 text-sm text-red-600">Couldn&apos;t load the list.</p>}
      {rows && rows.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No creator has set up tips yet.</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {rows.map((r) => (
            <li key={r.user_id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <Link to="/owner/users/$userId" params={{ userId: r.user_id }} className="font-medium underline">
                  @{r.username ?? "no username"}
                </Link>{" "}
                <span className="text-muted-foreground">
                  {r.creator_type?.replaceAll("_", " ") ?? "type not chosen"}
                  {r.offering ? `: ${r.offering}` : ""}
                </span>
                <div className="text-xs text-muted-foreground">
                  Stripe: {r.stripe_status ?? "not connected"}
                  {r.charges_enabled ? ", can take payments" : ""}
                </div>
              </div>
              <span className={r.approved_at ? "text-xs text-muted-foreground" : "text-xs font-medium text-amber-600"}>
                {r.approved_at ? `Approved ${new Date(r.approved_at).toLocaleDateString()}` : "Waiting for approval"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
