import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ownerRpc, type OwnerUserRow } from "@/lib/owner/api";

const PAGE = 25;

export const Route = createFileRoute("/owner/users")({
  component: UsersPage,
});

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "Never");

function UsersPage() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<OwnerUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    ownerRpc("owner_list_users", { _search: search || null, _limit: PAGE, _offset: page * PAGE }).then(
      setRows,
      (e: Error) => setError(e.message),
    );
  }, [search, page]);

  const total = rows?.[0]?.total_count ?? 0;

  return (
    <div>
      <h1 className="text-3xl font-bold">Users</h1>
      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setSearch(query.trim());
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Username, name or email"
          maxLength={100}
          aria-label="Search users"
        />
        <Button type="submit" variant="secondary">
          <Search className="mr-2 h-4 w-4" /> Search
        </Button>
      </form>

      {error && <p className="mt-6 text-muted-foreground">{error}</p>}
      {!rows && !error && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
      {rows && rows.length === 0 && <p className="mt-6 text-muted-foreground">No matching accounts.</p>}
      {rows && rows.length > 0 && (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            {total.toLocaleString()} account{total === 1 ? "" : "s"}
          </p>
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border">
            {rows.map((u) => (
              <li key={u.user_id}>
                <Link
                  to="/owner/users/$userId"
                  params={{ userId: u.user_id }}
                  className="flex flex-col gap-1 p-4 hover:bg-muted sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {u.username ? `@${u.username}` : "(no profile)"}
                      {u.is_admin && (
                        <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[10px] uppercase text-primary-foreground">
                          Admin
                        </span>
                      )}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {u.display_name ?? ""} {u.email ? `· ${u.email}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground sm:text-right">
                    <div>Joined {fmtDate(u.created_at)}</div>
                    <div>
                      {u.link_count} link{u.link_count === 1 ? "" : "s"}
                      {!u.email_confirmed && " · email not confirmed"}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE))}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * PAGE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
