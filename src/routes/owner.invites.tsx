import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

/** Invite codes (moved here from the old /admin page). Admin-only by RLS; logged by the database. */
export const Route = createFileRoute("/owner/invites")({
  component: InvitesPage,
});

type Invite = { id: string; code: string; used_by: string | null; used_at: string | null; created_at: string };

function InvitesPage() {
  const [invites, setInvites] = useState<Invite[] | null>(null);

  useEffect(() => {
    supabase
      .from("invites")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setInvites((data ?? []) as Invite[]);
      });
  }, []);

  const createInvite = async () => {
    const { data: session } = await supabase.auth.getSession();
    const uid = session.session?.user.id;
    if (!uid) return;
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31])
      .join("");
    const { data, error } = await supabase.from("invites").insert({ code, created_by: uid }).select().single();
    if (error) toast.error(error.message);
    else if (data) {
      setInvites((p) => [data as Invite, ...(p ?? [])]);
      toast.success(`Invite created: ${code}`);
    }
  };

  const revokeInvite = async (id: string) => {
    const { error } = await supabase.from("invites").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      setInvites((p) => (p ?? []).filter((i) => i.id !== id));
      toast.success("Invite revoked");
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold">Invites</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign-up is open, so codes are optional. Create one to track who joined from it.
      </p>
      <div className="mt-4">
        <Button onClick={createInvite}>
          <Plus className="mr-2 h-4 w-4" /> Generate invite code
        </Button>
      </div>
      {!invites && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
      <div className="mt-4 space-y-2">
        {invites?.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No invites yet.</div>
        )}
        {invites?.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-3">
              <code className="rounded-md bg-muted px-2 py-1 font-mono text-sm">{inv.code}</code>
              <span className={`text-xs ${inv.used_by ? "text-muted-foreground" : "text-primary"}`}>
                {inv.used_by ? "Used" : "Available"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!inv.used_by && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Copy code"
                  onClick={() => {
                    navigator.clipboard.writeText(inv.code);
                    toast.success("Code copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              )}
              <Button size="sm" variant="ghost" aria-label="Revoke" onClick={() => revokeInvite(inv.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
