import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { ownerRpc, type MessagingStatus } from "@/lib/owner/api";

export const Route = createFileRoute("/owner/messaging")({
  component: MessagingPage,
});

function MessagingPage() {
  const [status, setStatus] = useState<MessagingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await ownerRpc("owner_messaging_status", {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await ownerRpc("owner_set_messaging_enabled", { _enabled: on });
      toast.success(on ? "Messages are on for everyone" : "Messages are off for everyone");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold">Messages</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Direct messages between people on Yooits. Each person chooses whether to accept messages,
        and only adults who confirm they're 18 or older can turn them on. Admins can use messages
        while they're off for everyone.
      </p>
      {error && <p className="mt-6 text-muted-foreground">{error}</p>}
      {!status && !error && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
      {status && (
        <>
          <div className="mt-6 flex items-center justify-between rounded-2xl border border-border p-4">
            <div>
              <div className="font-medium">Messages for everyone</div>
              <div className="text-sm text-muted-foreground">
                {status.enabled
                  ? "On. Everyone can turn on messages in their settings."
                  : "Off. Only admins can use messages."}
              </div>
            </div>
            <Switch
              checked={status.enabled}
              disabled={busy}
              onCheckedChange={toggle}
              aria-label="Messages for everyone"
            />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["People with messages on", status.people_with_messages_on],
              ["Conversations", status.conversations],
              ["Messages, last 7 days", status.messages_7d],
              ["People suspended from messages", status.suspended],
              ["Open message reports", status.open_message_reports],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-2xl border border-border p-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-2xl font-bold">{n}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            Reported messages are on the{" "}
            <Link to="/owner/reports" className="underline">
              Reports
            </Link>{" "}
            page, where you can remove a message or suspend someone's messaging. You can also
            suspend messaging from a person's page under Users.
          </p>
        </>
      )}
    </div>
  );
}
