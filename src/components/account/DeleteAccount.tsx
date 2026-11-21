import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteMyAccount } from "@/lib/account/functions";

/** "Delete account" on the dashboard. The person types their username to confirm. */
export function DeleteAccount({ username }: { username: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = confirm.trim().toLowerCase() === username.toLowerCase();

  const run = async () => {
    setBusy(true);
    try {
      await deleteMyAccount({ data: { confirmUsername: confirm } });
      await supabase.auth.signOut();
      toast.success("Your account has been deleted.");
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "We couldn't delete your account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-destructive/40 p-5">
      <div className="font-semibold">Delete account</div>
      <p className="mt-1 text-sm text-muted-foreground">
        Permanently removes your page, links, wishlists and avatar, and your sign-in. This can't be undone.
      </p>
      {!open ? (
        <Button variant="outline" className="mt-3" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      ) : (
        <div className="mt-3 space-y-2">
          <Label htmlFor="confirm-delete">Type your username, {username}, to confirm</Label>
          <Input
            id="confirm-delete"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoCapitalize="none"
            autoComplete="off"
          />
          <div className="flex gap-2">
            <Button variant="destructive" disabled={!matches || busy} onClick={run}>
              {busy ? "Deleting…" : "Delete permanently"}
            </Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setConfirm(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
