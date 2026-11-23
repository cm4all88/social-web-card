import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { rpc } from "@/components/marketing/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Owner > Users > one account: give it a username, including protected ones
 * like "yooits" that nobody can pick at sign-up. Site paths are refused, and
 * every change is in the audit log.
 */
export function UsernameControl({
  userId,
  username,
  onChanged,
}: {
  userId: string;
  username: string;
  onChanged: () => void;
}) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const next = value.trim().toLowerCase();

  const assign = async () => {
    setBusy(true);
    const { data, error } = await rpc<{ username: string; protected?: boolean; changed: boolean }>(
      "owner_assign_username",
      { _user_id: userId, _username: next, _reason: reason },
    );
    setBusy(false);
    if (error) return toast.error(/^Not authorized/.test(error.message) ? "Only Yooits admins can do this." : error.message);
    toast.success(data.changed ? `Username is now @${data.username}` : "That's already the username");
    setValue("");
    setReason("");
    onChanged();
  };

  return (
    <section className="mt-4 rounded-2xl border border-border p-4">
      <h2 className="font-semibold">Assign username</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Changes @{username} to a name you choose, including protected names like yooits that are blocked at
        sign-up. Their old page address stops working.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="assign-username">New username</Label>
          <Input
            id="assign-username"
            maxLength={30}
            placeholder="yooits"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\s+/g, ""))}
          />
        </div>
        <div>
          <Label htmlFor="assign-reason">Reason (for the audit log)</Label>
          <Input
            id="assign-reason"
            maxLength={200}
            placeholder="Official Yooits account"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <Button onClick={assign} disabled={busy || next.length < 2 || next === username || reason.trim().length < 3}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Assign
        </Button>
      </div>
    </section>
  );
}
