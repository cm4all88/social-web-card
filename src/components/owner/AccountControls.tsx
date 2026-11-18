import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ownerRpc, type OwnerUserDetail } from "@/lib/owner/api";

type ControlId = "unpublish" | "suspend" | "tips";

/** What each switch does, in the words the confirmation shows. */
const CONTROLS: Record<
  ControlId,
  {
    title: string;
    offLabel: string;
    onLabel: string;
    effectOn: string;
    effectOff: string;
    restoreTitle: string;
  }
> = {
  unpublish: {
    title: "Public page",
    offLabel: "Unpublish page",
    onLabel: "Republish page",
    effectOn:
      "Their public page, links and wishlists stop showing to everyone, including direct links. Tips stop too. They can still sign in and edit. Nothing is deleted.",
    effectOff: "Their page, links and public wishlists show again (unless the account is suspended).",
    restoreTitle: "Republish this page?",
  },
  suspend: {
    title: "Account",
    offLabel: "Suspend account",
    onLabel: "Reactivate account",
    effectOn:
      "Their page is hidden like an unpublished page, tips stop, and they can no longer change their page, links, wishlists, tip settings or photo. They can still sign in and see their data. Nothing is deleted.",
    effectOff:
      "They can edit again and their page shows again (unless it's also unpublished). Tips stay off on their profile until they turn them back on.",
    restoreTitle: "Reactivate this account?",
  },
  tips: {
    title: "Tips",
    offLabel: "Turn off tips",
    onLabel: "Turn tips back on",
    effectOn:
      "New tips and Stripe setup stop for this creator straight away, checked on the server at checkout. Their page and past tips are unaffected.",
    effectOff:
      "They can take tips again once they switch tips on and their Stripe account is ready.",
    restoreTitle: "Turn tips back on?",
  },
};

function isOn(user: OwnerUserDetail, id: ControlId) {
  const s = user.status;
  if (id === "unpublish") return !!s?.unpublished_at;
  if (id === "suspend") return !!s?.suspended_at;
  return !!s?.tips_disabled_at || !!user.tipping?.suspended_at;
}

function since(user: OwnerUserDetail, id: ControlId) {
  const s = user.status;
  const at = id === "unpublish" ? s?.unpublished_at : id === "suspend" ? s?.suspended_at : s?.tips_disabled_at;
  const by = id === "unpublish" ? s?.unpublished_by : id === "suspend" ? s?.suspended_by : s?.tips_disabled_by;
  const why =
    id === "unpublish" ? s?.unpublished_reason : id === "suspend" ? s?.suspended_reason : s?.tips_disabled_reason;
  if (!at) return null;
  return `Since ${new Date(at).toLocaleString()}${by ? ` by @${by}` : ""}${why ? `: ${why}` : ""}`;
}

export function AccountControls({ user, onChanged }: { user: OwnerUserDetail; onChanged: () => void }) {
  const [open, setOpen] = useState<ControlId | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const isAdmin = user.roles.includes("admin");
  const suspendBlocked = user.is_self
    ? "You can't suspend your own account."
    : isAdmin
      ? "Admin accounts can't be suspended. Remove their admin access first."
      : null;

  const current = open ? CONTROLS[open] : null;
  const turningOn = open ? !isOn(user, open) : false;

  const confirm = async () => {
    if (!open) return;
    setBusy(true);
    try {
      const r = turningOn ? reason.trim() : null;
      if (open === "unpublish") {
        await ownerRpc("owner_set_unpublished", { _user_id: user.user_id, _unpublished: turningOn, _reason: r });
      } else if (open === "suspend") {
        await ownerRpc("owner_set_suspended", { _user_id: user.user_id, _suspended: turningOn, _reason: r });
      } else {
        await ownerRpc("owner_set_tips_disabled", { _user_id: user.user_id, _disabled: turningOn, _reason: r });
      }
      toast.success("Done. It's in the audit log.");
      setOpen(null);
      setReason("");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 rounded-2xl border border-border p-4">
      <h2 className="font-semibold">Account controls</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Three separate switches. Each one asks you to confirm, needs a reason, and is recorded in the audit log.
      </p>
      <div className="mt-3 divide-y divide-border">
        {(Object.keys(CONTROLS) as ControlId[]).map((id) => {
          const c = CONTROLS[id];
          const on = isOn(user, id);
          const blocked = id === "suspend" && !on ? suspendBlocked : null;
          return (
            <div key={id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {c.title}:{" "}
                  <span className={on ? "text-destructive" : "text-muted-foreground"}>
                    {id === "unpublish" ? (on ? "Unpublished" : "Published") : id === "suspend" ? (on ? "Suspended" : "Active") : on ? "Off" : "Allowed"}
                  </span>
                </div>
                {on && <div className="break-words text-xs text-muted-foreground">{since(user, id)}</div>}
                {blocked && <div className="text-xs text-muted-foreground">{blocked}</div>}
              </div>
              <Button
                size="sm"
                variant={on ? "secondary" : "destructive"}
                disabled={!!blocked}
                onClick={() => {
                  setReason("");
                  setOpen(id);
                }}
              >
                {on ? c.onLabel : c.offLabel}
              </Button>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!open} onOpenChange={(o) => !o && !busy && setOpen(null)}>
        <AlertDialogContent>
          {current && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {turningOn
                    ? `${current.offLabel} for @${user.profile?.username ?? "this account"}?`
                    : current.restoreTitle}
                </AlertDialogTitle>
                <AlertDialogDescription>{turningOn ? current.effectOn : current.effectOff}</AlertDialogDescription>
              </AlertDialogHeader>
              {turningOn && (
                <div className="space-y-2">
                  <Label htmlFor="reason">Reason (kept in the audit log, not shown to them)</Label>
                  <Textarea
                    id="reason"
                    value={reason}
                    maxLength={200}
                    rows={2}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Reported spam links"
                  />
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <Button
                  variant={turningOn ? "destructive" : "default"}
                  disabled={busy || (turningOn && reason.trim().length < 3)}
                  onClick={confirm}
                >
                  {busy ? "Saving…" : turningOn ? current.offLabel : current.onLabel}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
