import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Sites creators' links may not point to, and the exceptions list for
 * mistakes. The database refuses new links to a blocked site and hides
 * existing ones from the public; nothing is deleted. Every change is logged.
 */
export const Route = createFileRoute("/owner/blocked-sites")({
  component: BlockedSitesPage,
});

type Block = {
  domain: string;
  source: string;
  reason: string | null;
  created_at: string;
  links_hidden: number;
};
type Allow = { domain: string; reason: string | null; created_at: string };
type Lists = { blocks: Block[]; allows: Allow[] };

// Not in the generated types yet.
const rpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc.bind(supabase) as unknown as (
      f: string,
      a?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn, args);

function BlockedSitesPage() {
  const [lists, setLists] = useState<Lists | null>(null);
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await rpc("owner_link_domain_lists");
    if (error) toast.error(error.message);
    setLists((data as Lists) ?? { blocks: [], allows: [] });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const change = async (list: "block" | "allow", d: string, on: boolean, r?: string) => {
    setBusy(true);
    const { data, error } = await rpc("owner_set_link_domain", {
      _list: list,
      _domain: d,
      _on: on,
      _reason: r ?? null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    const verb =
      list === "block" ? (on ? "Blocked" : "Unblocked") : on ? "Allowed" : "Removed exception for";
    toast.success(`${verb} ${String(data)}`);
    if (on) {
      setDomain("");
      setReason("");
    }
    await load();
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold">Blocked sites</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A blocked site covers its subdomains. New links to it are refused, and existing links are
        hidden from everyone but their creator. Exceptions win over blocks, for sites blocked by
        mistake.
      </p>

      <div className="mt-4 space-y-2 rounded-xl border border-border bg-card p-4">
        <Input
          placeholder="Site, e.g. example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        />
        <Input
          placeholder="Reason (optional)"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex gap-2">
          <Button
            disabled={busy || !domain.trim()}
            variant="destructive"
            onClick={() => change("block", domain, true, reason)}
          >
            Block site
          </Button>
          <Button
            disabled={busy || !domain.trim()}
            variant="outline"
            onClick={() => change("allow", domain, true, reason)}
          >
            Add exception
          </Button>
        </div>
      </div>

      {!lists && <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />}
      {lists && (
        <>
          <h2 className="mt-6 text-lg font-semibold">Blocked ({lists.blocks.length})</h2>
          <div className="mt-2 space-y-2">
            {lists.blocks.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No blocked sites.
              </div>
            )}
            {lists.blocks.map((b) => (
              <Row
                key={b.domain}
                domain={b.domain}
                note={[
                  b.reason,
                  b.source === "feed" ? "from threat feed" : null,
                  `${b.links_hidden} link(s) hidden`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onRemove={() => change("block", b.domain, false)}
                label="Unblock"
                busy={busy}
              />
            ))}
          </div>
          <h2 className="mt-6 text-lg font-semibold">Exceptions ({lists.allows.length})</h2>
          <div className="mt-2 space-y-2">
            {lists.allows.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No exceptions.
              </div>
            )}
            {lists.allows.map((a) => (
              <Row
                key={a.domain}
                domain={a.domain}
                note={a.reason ?? ""}
                onRemove={() => change("allow", a.domain, false)}
                label="Remove exception"
                busy={busy}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Row(props: {
  domain: string;
  note: string;
  label: string;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
      <div className="min-w-0">
        <code className="font-mono text-sm">{props.domain}</code>
        {props.note && <div className="truncate text-xs text-muted-foreground">{props.note}</div>}
      </div>
      <Button
        size="sm"
        variant="ghost"
        aria-label={props.label}
        disabled={props.busy}
        onClick={props.onRemove}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
