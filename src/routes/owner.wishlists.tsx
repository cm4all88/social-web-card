import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { rpc } from "@/components/marketing/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Owner > Wishlists: every list, its activity, and hiding one that breaks the rules. */
export const Route = createFileRoute("/owner/wishlists")({
  component: WishlistsPage,
  head: () => ({ meta: [{ title: "Wishlists — Yooits.me" }, { name: "robots", content: "noindex" }] }),
});

type ListRow = {
  id: string;
  title: string;
  slug: string;
  username: string | null;
  visibility: "public" | "private";
  show_on_profile: boolean;
  occasion: string | null;
  event_date: string | null;
  for_someone_else: boolean;
  created_at: string;
  items: number;
  claims: number;
  open_reports: number;
};
type Data = {
  totals: Record<"lists" | "public_lists" | "for_someone_else" | "items" | "claims" | "owners" | "open_reports", number>;
  lists: ListRow[];
  claims: { enabled: boolean; max_claims_per_list: number } | null;
  gift_money: { enabled: boolean; checkout_enabled: boolean; stripe_approved: boolean } | null;
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

function WishlistsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<ListRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (query: string) => {
    const { data, error } = await rpc<Data>("owner_wishlists", { _q: query || null, _limit: 200 });
    if (error) toast.error(error.message);
    else setData(data);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const change = async () => {
    if (!target) return;
    setBusy(true);
    const to = target.visibility === "public" ? "private" : "public";
    const { error } = await rpc("owner_wishlist_set_visibility", { _id: target.id, _visibility: to, _reason: reason });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(to === "private" ? "List hidden from the public" : "List public again");
    setTarget(null);
    setReason("");
    load(q);
  };

  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl font-bold">Wishlists</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every wishlist on Yooits.me. Reported lists are handled on{" "}
        <Link to="/owner/reports" className="text-primary hover:underline">
          Reports
        </Link>
        ; you can also hide a list here.
      </p>

      {!data && <Loader2 className="mt-6 h-6 w-6 animate-spin text-muted-foreground" />}
      {data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Lists", value: data.totals.lists, note: `${data.totals.public_lists} public` },
              { label: "Made for someone else", value: data.totals.for_someone_else, note: "e.g. a child's list" },
              { label: "Items", value: data.totals.items, note: `${data.totals.claims} claimed` },
              { label: "Open reports", value: data.totals.open_reports, note: `${data.totals.owners} people with lists` },
            ].map((t) => (
              <div key={t.label} className="rounded-2xl border border-border bg-card p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</div>
                <div className="mt-1 text-2xl font-bold">{t.value}</div>
                <div className="text-xs text-muted-foreground">{t.note}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-4 text-sm">
              <div className="font-medium">Claiming</div>
              <div className="text-muted-foreground">
                {data.claims?.enabled
                  ? `On, up to ${data.claims.max_claims_per_list} per person per list.`
                  : "Off."}{" "}
                <Link to="/owner/settings" className="text-primary hover:underline">
                  Change
                </Link>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-sm">
              <div className="font-medium">Gift money</div>
              <div className="text-muted-foreground">
                {data.gift_money?.enabled && data.gift_money.checkout_enabled
                  ? "On."
                  : "Off. It needs Stripe's written approval first."}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-sm">
              <div className="font-medium">Retailer affiliate tags</div>
              <div className="text-muted-foreground">
                Off. Item links go to the shop exactly as people pasted them, with no Yooits.me tag added.
              </div>
            </div>
          </div>

          <div className="mt-6 max-w-sm">
            <Label htmlFor="wl-q">Search by title or username</Label>
            <Input id="wl-q" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3">List</th>
                  <th className="p-3">Owner</th>
                  <th className="p-3">Shown</th>
                  <th className="p-3">Items</th>
                  <th className="p-3">Reports</th>
                  <th className="p-3">Created</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {data.lists.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-4 text-muted-foreground">
                      No wishlists{q ? " match that" : " yet"}.
                    </td>
                  </tr>
                )}
                {data.lists.map((w) => (
                  <tr key={w.id} className="border-t border-border">
                    <td className="p-3">
                      {w.visibility === "public" && w.username ? (
                        <a
                          href={`/${w.username}/wishlist/${w.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-primary hover:underline"
                        >
                          {w.title}
                        </a>
                      ) : (
                        <span className="font-medium">{w.title}</span>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {[w.occasion, w.event_date && fmt(w.event_date), w.for_someone_else && "for someone else"]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td className="p-3">{w.username ? `@${w.username}` : "Deleted account"}</td>
                    <td className="p-3">
                      {w.visibility === "public" ? "Public" : "Private"}
                      {w.visibility === "public" && !w.show_on_profile && (
                        <div className="text-xs text-muted-foreground">not on profile</div>
                      )}
                    </td>
                    <td className="p-3">
                      {w.items}
                      {w.claims > 0 && <span className="text-xs text-muted-foreground"> · {w.claims} claimed</span>}
                    </td>
                    <td className="p-3">
                      {w.open_reports > 0 ? (
                        <Link to="/owner/reports" className="font-medium text-destructive hover:underline">
                          {w.open_reports} open
                        </Link>
                      ) : (
                        "None"
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{fmt(w.created_at)}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setTarget(w)}>
                        {w.visibility === "public" ? "Hide" : "Make public"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <AlertDialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {target?.visibility === "public" ? `Hide "${target?.title}"?` : `Make "${target?.title}" public again?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {target?.visibility === "public"
                ? "The list becomes private: only its owner can see it. Nothing on it is deleted, and the owner isn't told automatically."
                : "Anyone with the link can see the list again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="wl-reason">Reason (for the audit log)</Label>
            <Textarea id="wl-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant={target?.visibility === "public" ? "destructive" : "default"}
              disabled={busy || reason.trim().length < 3}
              onClick={change}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {target?.visibility === "public" ? "Hide list" : "Make public"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
