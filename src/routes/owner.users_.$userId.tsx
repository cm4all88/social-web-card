import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { ownerRpc, type OwnerUserDetail } from "@/lib/owner/api";
import { safeLinkHref } from "@/lib/safe-url";

export const Route = createFileRoute("/owner/users_/$userId")({
  component: UserDetailPage,
});

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "Never");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <div className="w-40 shrink-0 text-sm text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words text-sm">{children}</div>
    </div>
  );
}

function UserDetailPage() {
  const { userId } = Route.useParams();
  const [user, setUser] = useState<OwnerUserDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUser(undefined);
    ownerRpc("owner_get_user", { _user_id: userId }).then(setUser, (e: Error) => setError(e.message));
  }, [userId]);

  return (
    <div>
      <Link to="/owner/users" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Users
      </Link>
      {error && <p className="mt-6 text-muted-foreground">{error}</p>}
      {user === undefined && !error && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
      {user === null && <p className="mt-6 text-muted-foreground">No account with that id.</p>}
      {user && (
        <>
          <h1 className="mt-4 break-words text-3xl font-bold">
            {user.profile ? `@${user.profile.username}` : "(no profile)"}
          </h1>
          {user.profile && (
            <a
              href={`/${user.profile.username}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Public page <ExternalLink className="h-3 w-3" />
            </a>
          )}

          <section className="mt-6 rounded-2xl border border-border p-4">
            <h2 className="mb-2 font-semibold">Account</h2>
            <Row label="Email">{user.email ?? "None"}</Row>
            <Row label="Email confirmed">{user.email_confirmed ? "Yes" : "No"}</Row>
            <Row label="Joined">{fmt(user.created_at)}</Row>
            <Row label="Last sign-in">{fmt(user.last_sign_in_at)}</Row>
            <Row label="Roles">{user.roles.join(", ") || "None"}</Row>
            <Row label="Display name">{user.profile?.display_name ?? ""}</Row>
            <Row label="Bio">{user.profile?.bio ?? ""}</Row>
          </section>

          <section className="mt-4 rounded-2xl border border-border p-4">
            <h2 className="mb-2 font-semibold">Links ({user.links.length})</h2>
            {user.links.length === 0 && <p className="text-sm text-muted-foreground">No links.</p>}
            {user.links.map((l, i) => {
              const href = safeLinkHref(l.url);
              return (
                <Row key={i} label={`${l.platform}${l.enabled ? "" : " (hidden)"}`}>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener nofollow" className="underline">
                      {l.url}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{l.url || "(empty)"}</span>
                  )}
                </Row>
              );
            })}
          </section>

          <section className="mt-4 rounded-2xl border border-border p-4">
            <h2 className="mb-2 font-semibold">Money and wishlists</h2>
            <Row label="Tipping">
              {user.tipping
                ? `${user.tipping.status}${user.tipping.charges_enabled ? ", can take payments" : ""}`
                : "Not set up"}
            </Row>
            {user.tipping?.suspended_at && (
              <Row label="Tips stopped">
                {fmt(user.tipping.suspended_at)}
                {user.tipping.suspended_reason ? `: ${user.tipping.suspended_reason}` : ""}
              </Row>
            )}
            <Row label="Wishlists">{user.wishlists}</Row>
            <p className="mt-2 text-xs text-muted-foreground">
              To stop or restore tips for this creator, use Money.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
