import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
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
import {
  betaRpc,
  type BetaChannel,
  type BetaFeedbackRow,
  type BetaInviteRow,
  type BetaMemberRow,
  type BetaOverview,
} from "@/lib/beta/api";
import { betaInviteLink } from "@/lib/beta/invite";

/**
 * Founding Members (launch promotion): codes, who joined, who's active, and feedback.
 * Every read and write here is checked for admin in the database, and every
 * change is written to the audit log there.
 */
export const Route = createFileRoute("/owner/founding")({
  component: BetaPage,
});

const CHANNELS: { value: BetaChannel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "dm", label: "DM" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
];

const FEEDBACK_PAGE = 50;

const fmtDate = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";

type Pending =
  { kind: "invite"; id: string; title: string } | { kind: "grant"; id: string; title: string };

function BetaPage() {
  const [overview, setOverview] = useState<BetaOverview | null>(null);
  const [invites, setInvites] = useState<BetaInviteRow[] | null>(null);
  const [members, setMembers] = useState<BetaMemberRow[] | null>(null);
  const [feedback, setFeedback] = useState<BetaFeedbackRow[] | null>(null);
  const [moreFeedback, setMoreFeedback] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [count, setCount] = useState(1);
  const [label, setLabel] = useState("");
  const [channel, setChannel] = useState<BetaChannel | "">("");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);

  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, i, m, f] = await Promise.all([
        betaRpc("owner_beta_overview", {}),
        betaRpc("owner_beta_list_invites", { _limit: 200 }),
        betaRpc("owner_beta_list_members", { _limit: 200 }),
        betaRpc("owner_beta_list_feedback", { _limit: FEEDBACK_PAGE }),
      ]);
      setOverview(o);
      setInvites(i ?? []);
      setMembers(m ?? []);
      setFeedback(f ?? []);
      setMoreFeedback((f ?? []).length === FEEDBACK_PAGE);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadOlderFeedback = async () => {
    const last = feedback?.[feedback.length - 1];
    if (!last) return;
    setLoadingOlder(true);
    try {
      const older = await betaRpc("owner_beta_list_feedback", {
        _limit: FEEDBACK_PAGE,
        _before_id: last.id,
      });
      setFeedback((cur) => [...(cur ?? []), ...(older ?? [])]);
      setMoreFeedback((older ?? []).length === FEEDBACK_PAGE);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  };

  const setOpen = async (open: boolean) => {
    setBusy(true);
    try {
      await betaRpc("owner_beta_set_open", { _open: open });
      toast.success(open ? "Invites are on" : "Invites are off");
      setConfirmOpen(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "https://yooits.me";
  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  };

  const create = async () => {
    setCreating(true);
    try {
      const rows = await betaRpc("owner_beta_create_invites", {
        _count: count,
        _label: label.trim() || null,
        _channel: channel || null,
      });
      setFresh(rows.map((r) => r.code));
      setLabel("");
      toast.success(rows.length === 1 ? "Invite created" : `${rows.length} invites created`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const confirmRevoke = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "invite") {
        await betaRpc("owner_beta_revoke_invite", { _invite_id: pending.id, _reason: reason });
        toast.success("Code revoked");
      } else {
        await betaRpc("owner_beta_revoke_grant", { _user_id: pending.id, _reason: reason });
        toast.success("Founding Plus ended for this account");
      }
      setPending(null);
      setReason("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="text-muted-foreground">{error}</p>;
  if (!overview) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;

  const tiles = [
    { label: "Seats left", value: overview.seats_left, note: `of ${overview.max_seats}` },
    {
      label: "Invites created",
      value: overview.codes_created,
      note: `${overview.codes_open} still open`,
    },
    {
      label: "Signed up with a code",
      value: overview.signups,
      note: `${overview.existing_redeemed} existing accounts joined`,
    },
    { label: "On founding Plus now", value: overview.plus_now },
    { label: "Active (14 days)", value: overview.active_14d, note: "signed in recently" },
    { label: "Feedback notes", value: overview.feedback },
  ];

  return (
    <div className="max-w-5xl">
      <h1 className="text-3xl font-bold">Founding Members</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {overview.max_seats} seats, {overview.plus_months} months of Plus free each. No card is
        collected and nothing renews or turns into a paid plan.
      </p>
      <div
        className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-sm ${overview.open ? "border-primary/40 bg-primary/5" : "border-border bg-muted"}`}
      >
        <div>
          <div className="font-medium">{overview.open ? "Invites are on" : "Invites are off"}</div>
          <div className="text-muted-foreground">
            {overview.open
              ? "Anyone with an open code can claim their 3 months of Plus."
              : "You can create and copy codes, but none can be used until you turn invites on. People who open a link can still make a free page."}
          </div>
        </div>
        <Button
          variant={overview.open ? "outline" : "default"}
          onClick={() => setConfirmOpen(!overview.open)}
        >
          {overview.open ? "Turn invites off" : "Turn invites on"}
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t.label}
            </div>
            <div className="mt-1 text-2xl font-bold">{t.value.toLocaleString()}</div>
            {t.note && <div className="mt-1 text-xs text-muted-foreground">{t.note}</div>}
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-xl font-bold">Create invites</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Each code works once and holds a seat until it's used, revoked or expires (
        {overview.default_code_days} days).
      </p>
      <div className="mt-3 grid gap-3 rounded-2xl border border-border p-4 sm:grid-cols-[6rem_1fr_10rem_auto] sm:items-end">
        <div>
          <Label htmlFor="beta-count">How many</Label>
          <Input
            id="beta-count"
            type="number"
            min={1}
            max={10}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
          />
        </div>
        <div>
          <Label htmlFor="beta-label">Who it's for (only you see this)</Label>
          <Input
            id="beta-label"
            maxLength={80}
            value={label}
            placeholder="e.g. Pottery creator from the Seattle meetup"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="beta-channel">Sent by</Label>
          <select
            id="beta-channel"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={channel}
            onChange={(e) => setChannel(e.target.value as BetaChannel | "")}
          >
            <option value="">Not set</option>
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={create} disabled={creating || overview.seats_left < 1}>
          {creating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}{" "}
          Create
        </Button>
      </div>
      {fresh.length > 0 && (
        <div className="mt-3 rounded-2xl border border-primary/40 bg-primary/5 p-4 text-sm">
          <div className="font-medium">New invite links</div>
          <ul className="mt-2 space-y-1">
            {fresh.map((c) => (
              <li key={c} className="flex items-center gap-2">
                <code className="break-all font-mono text-xs">{betaInviteLink(c, origin)}</code>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Copy link"
                  onClick={() => copy(betaInviteLink(c, origin), "Link")}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 className="mt-10 text-xl font-bold">Invitations</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3">Code</th>
              <th className="p-3">For</th>
              <th className="p-3">Sent by</th>
              <th className="p-3">Status</th>
              <th className="p-3">Dates</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {invites?.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-muted-foreground">
                  No invites yet.
                </td>
              </tr>
            )}
            {invites?.map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="p-3 font-mono text-xs">{i.code}</td>
                <td className="p-3">{i.label}</td>
                <td className="p-3">{CHANNELS.find((c) => c.value === i.channel)?.label}</td>
                <td className="p-3">
                  {i.status === "redeemed"
                    ? `Joined${i.used_by_username ? ` as @${i.used_by_username}` : ""}`
                    : i.status}
                  {i.revoked_reason && (
                    <div className="text-xs text-muted-foreground">{i.revoked_reason}</div>
                  )}
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  Sent {fmtDate(i.created_at)}
                  {i.status === "redeemed"
                    ? ` · used ${fmtDate(i.used_at)}`
                    : i.expires_at
                      ? ` · expires ${fmtDate(i.expires_at)}`
                      : ""}
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  {i.status === "open" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label="Copy link"
                        onClick={() => copy(betaInviteLink(i.code, origin), "Link")}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>{" "}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setPending({ kind: "invite", id: i.id, title: `Revoke ${i.code}?` })
                        }
                      >
                        Revoke
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-bold">Members</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Active means signed in within the last 14 days.
      </p>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3">Creator</th>
              <th className="p-3">Joined</th>
              <th className="p-3">Plus ends</th>
              <th className="p-3">Status</th>
              <th className="p-3">Links</th>
              <th className="p-3">Feedback</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {members?.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-muted-foreground">
                  Nobody has joined yet.
                </td>
              </tr>
            )}
            {members?.map((m) => (
              <tr key={m.user_id} className="border-t border-border">
                <td className="p-3">
                  <div className="font-medium">@{m.username}</div>
                  <div className="text-xs text-muted-foreground">{m.email}</div>
                </td>
                <td className="p-3 text-xs">
                  {fmtDate(m.redeemed_at)}
                  <div className="text-muted-foreground">
                    {m.via_signup ? "new account" : "existing account"}
                  </div>
                </td>
                <td className="p-3 text-xs">{fmtDate(m.ends_at)}</td>
                <td className="p-3">
                  {m.status}
                  {m.revoked_reason && (
                    <div className="text-xs text-muted-foreground">{m.revoked_reason}</div>
                  )}
                </td>
                <td className="p-3">{m.link_count}</td>
                <td className="p-3">{m.feedback_count}</td>
                <td className="p-3 text-right">
                  {m.status !== "revoked" && m.status !== "ended" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPending({
                          kind: "grant",
                          id: m.user_id,
                          title: `End founding Plus for @${m.username}?`,
                        })
                      }
                    >
                      End Plus
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-bold">Feedback</h2>
      <div className="mt-3 space-y-2">
        {feedback?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No feedback yet.
          </div>
        )}
        {feedback?.map((f) => (
          <div key={f.id} className="rounded-xl border border-border bg-card p-3 text-sm">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                @{f.username ?? "deleted"} {f.in_beta ? "· founding member" : ""}{" "}
                {f.rating ? `· ${f.rating}/5` : ""}
              </span>
              <span>{fmtDate(f.created_at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{f.message}</p>
          </div>
        ))}
        {moreFeedback && (
          <Button variant="outline" onClick={loadOlderFeedback} disabled={loadingOlder}>
            {loadingOlder && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Load older feedback
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen !== null} onOpenChange={(o) => !o && setConfirmOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmOpen ? "Turn Founding Member invites on?" : "Turn invites off?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmOpen
                ? "Every open code starts working right away, including any you've already copied. This is logged."
                : "Open codes stop working until you turn invites back on. Nobody loses Plus they already have. This is logged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button disabled={busy} onClick={() => confirmOpen !== null && setOpen(confirmOpen)}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmOpen ? "Turn on" : "Turn off"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "invite"
                ? "The code stops working and its seat frees up. This is logged."
                : "Their account stays as it is and simply goes back to the free plan. Their seat frees up. This is logged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="beta-reason">Reason (for the audit log)</Label>
            <Textarea
              id="beta-reason"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy || reason.trim().length < 3}
              onClick={confirmRevoke}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
