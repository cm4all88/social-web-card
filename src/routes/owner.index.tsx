import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ownerRpc, type OwnerOverview } from "@/lib/owner/api";
import { OWNER_SECTIONS } from "@/lib/owner/nav";

export const Route = createFileRoute("/owner/")({
  component: OverviewPage,
});

function OverviewPage() {
  const [data, setData] = useState<OwnerOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ownerRpc("owner_overview", {}).then(setData, (e: Error) => setError(e.message));
  }, []);

  const tiles: { label: string; value: number | undefined; note?: string }[] = data
    ? [
        { label: "Accounts", value: data.total_users },
        { label: "New this week", value: data.signups_7d, note: `${data.signups_30d} in 30 days` },
        { label: "Email not confirmed", value: data.unconfirmed_emails },
        { label: "Pages with links", value: data.profiles_with_links },
        { label: "Creators taking tips", value: data.connected_creators, note: `${data.tipping_suspended} stopped` },
        { label: "Public wishlists", value: data.public_wishlists },
        { label: "Unpublished pages", value: data.unpublished },
        { label: "Suspended accounts", value: data.suspended },
        { label: "Open invite codes", value: data.open_invites },
        { label: "Admins", value: data.admins },
      ]
    : [];

  return (
    <div>
      <h1 className="text-3xl font-bold">Overview</h1>
      {error && <p className="mt-6 text-muted-foreground">{error}</p>}
      {!data && !error && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
      {data && (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border border-border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.label}</div>
              <div className="mt-1 text-2xl font-bold">{(t.value ?? 0).toLocaleString()}</div>
              {t.note && <div className="mt-1 text-xs text-muted-foreground">{t.note}</div>}
            </div>
          ))}
        </div>
      )}
      <h2 className="mt-10 text-lg font-semibold">Sections</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {OWNER_SECTIONS.filter((s) => s.id !== "overview").map((s) => (
          <Link key={s.id} to={s.to} className="rounded-2xl border border-border p-4 hover:bg-muted">
            <div className="flex items-center justify-between font-medium">
              {s.label}
              {s.status === "planned" && <span className="text-xs text-muted-foreground">Not built yet</span>}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{s.summary}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
