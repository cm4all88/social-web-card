/** Owner: a person's message settings, and suspending their messaging. */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ownerRpc, type UserMessaging } from "@/lib/owner/api";

const MODE_LABELS = { off: "Off", requests: "Requests only", everyone: "Everyone" } as const;

export function MessagingControls({ userId }: { userId: string }) {
  const [m, setM] = useState<UserMessaging | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    ownerRpc("owner_user_messaging", { _user_id: userId }).then(setM, () => setM(null));
  }, [userId]);
  useEffect(load, [load]);

  if (!m) return null;

  const set = async (suspended: boolean) => {
    setBusy(true);
    try {
      await ownerRpc("owner_set_messaging_suspended", {
        _user_id: userId,
        _suspended: suspended,
        _reason: reason || null,
      });
      toast.success(suspended ? "Messaging suspended" : "Messaging restored");
      setReason("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 rounded-2xl border border-border p-4 text-sm">
      <div className="font-semibold">Messages</div>
      <p className="mt-1 text-muted-foreground">
        Accepts: {MODE_LABELS[m.mode]} · Sent in the last 7 days: {m.messages_sent_7d} · Message
        reports about them: {m.reports_about}
      </p>
      {m.suspended && (
        <p className="mt-1 text-destructive">
          Messaging suspended{m.suspended_reason ? `: ${m.suspended_reason}` : ""}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Reason (optional)"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
        {m.suspended ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => set(false)}>
            Restore messaging
          </Button>
        ) : (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => set(true)}>
            Suspend messaging
          </Button>
        )}
      </div>
    </section>
  );
}
