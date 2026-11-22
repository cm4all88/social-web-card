import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ownerRemoveBackground } from "@/lib/owner/background-functions";
import { safeBackgroundUrl } from "@/lib/backgrounds";

/**
 * The creator's custom background, for moderation: see it, and take it off
 * their page with a reason (kept in the audit log). Shows nothing when they
 * have none.
 */
export function BackgroundControl({ userId }: { userId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("background_url" as "*")
      .eq("user_id", userId)
      .maybeSingle();
    setUrl(safeBackgroundUrl((data as { background_url?: string | null } | null)?.background_url));
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!url) return null;

  const remove = async () => {
    setBusy(true);
    try {
      const r = await ownerRemoveBackground({ data: { userId, reason: reason.trim() } });
      if (!r.removed) toast("They had no background to remove.");
      else if (r.fileDeleted)
        toast.success("Background removed and the photo deleted. It's in the audit log.");
      else if (r.kept === "is_profile_photo")
        toast.warning(
          "Background removed. It's also their profile photo, so that photo still loads.",
        );
      else
        toast.warning(
          "Background removed, but the photo file couldn't be deleted. Try again or remove it in Supabase.",
        );
      setOpen(false);
      setReason("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 rounded-2xl border border-border p-4">
      <h2 className="font-semibold">Custom background</h2>
      <img
        src={url}
        alt="This creator's custom background"
        className="mt-3 max-h-48 rounded-lg object-cover"
      />
      {!open ? (
        <Button size="sm" variant="destructive" className="mt-3" onClick={() => setOpen(true)}>
          Remove background
        </Button>
      ) : (
        <div className="mt-3 space-y-2">
          <Label htmlFor="bg-reason">Reason (kept in the audit log, not shown to them)</Label>
          <Textarea
            id="bg-reason"
            value={reason}
            maxLength={200}
            rows={2}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Reported photo, not safe for work"
          />
          <p className="text-xs text-muted-foreground">
            It comes off their page straight away and the photo file is deleted, so its address
            stops loading. They can upload another; suspend the account if it keeps happening.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || reason.trim().length < 3}
              onClick={remove}
            >
              {busy ? "Removing…" : "Remove background"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
