import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, Pencil, Plus } from "lucide-react";
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
import {
  CHANNEL_LABELS,
  codeLink,
  INVITE_STATUS_LABELS,
  usesLine,
  type InviteChannel,
  type InviteRow,
  type RedemptionRow,
} from "@/lib/owner/codes";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export const siteOrigin = () =>
  typeof window !== "undefined" ? window.location.origin : "https://yooits.me";

export function copyText(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error("Couldn't copy. Select the text and copy it instead."),
  );
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc<T>(fn, args);
  if (error) throw new Error(/^Not authorized/.test(error.message) ? "Only Yooits.me admins can do this." : error.message);
  return data;
}

/** A private note on who a code is for, edited in place. Founding codes too. */
export function LabelEdit({
  id,
  label,
  onSaved,
}: {
  id: string;
  label: string | null;
  onSaved: (label: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label ?? "");
  const [busy, setBusy] = useState(false);
  if (!editing)
    return (
      <button
        type="button"
        className="group inline-flex items-center gap-1 text-left hover:text-foreground"
        onClick={() => {
          setValue(label ?? "");
          setEditing(true);
        }}
        aria-label="Edit note"
      >
        <span className={label ? "" : "text-muted-foreground"}>{label || "Add a note"}</span>
        <Pencil className="h-3 w-3 opacity-40 group-hover:opacity-100" />
      </button>
    );
  const save = async () => {
    setBusy(true);
    try {
      const v = await call<string | null>("owner_invite_set_label", { _invite_id: id, _label: value });
      onSaved(v);
      setEditing(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        autoFocus
        className="h-8 w-44"
        maxLength={80}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={save} aria-label="Save note">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </Button>
    </span>
  );
}

/** Who used which code, newest first. */
export function Redemptions({
  inviteId,
  promotionId,
  refreshKey,
}: {
  inviteId?: string;
  promotionId?: string;
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<RedemptionRow[] | null>(null);
  useEffect(() => {
    setRows(null);
    call<RedemptionRow[]>("owner_invite_redemptions", {
      _invite_id: inviteId ?? null,
      _promotion_id: promotionId ?? null,
      _limit: 200,
    })
      .then(setRows)
      .catch((e) => {
        toast.error((e as Error).message);
        setRows([]);
      });
  }, [inviteId, promotionId, refreshKey]);
  if (!rows) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">Nobody has used {inviteId ? "this code" : "these codes"} yet.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3">When</th>
            <th className="p-3">Who</th>
            <th className="p-3">Code</th>
            <th className="p-3">How</th>
            <th className="p-3">Plan now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.invite_id}-${r.user_id}`} className="border-t border-border">
              <td className="p-3 text-xs text-muted-foreground">{fmt(r.redeemed_at)}</td>
              <td className="p-3">{r.username ? `@${r.username}` : "Deleted account"}</td>
              <td className="p-3 font-mono text-xs">{r.code}</td>
              <td className="p-3 text-xs">{r.via_signup ? "Signed up with it" : "Added to an existing account"}</td>
              <td className="p-3 text-xs">
                {r.plan === "plus" ? "Plus" : "Free"}
                {r.plus_until && ` · free Plus until ${fmt(r.plus_until)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Make, copy, label and revoke invite codes, on their own or for one
 * promotion. Founding Member codes have their own page and never show here.
 */
export function InviteCodes({
  promotionId,
  defaultUses = 1,
  onChanged,
}: {
  promotionId?: string;
  defaultUses?: number;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<InviteRow[] | null>(null);
  const [count, setCount] = useState(1);
  const [custom, setCustom] = useState("");
  const [uses, setUses] = useState(defaultUses);
  const [days, setDays] = useState<string>("");
  const [label, setLabel] = useState("");
  const [channel, setChannel] = useState<InviteChannel | "">("");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | InviteRow["status"]>("all");
  const [revoking, setRevoking] = useState<InviteRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [showUses, setShowUses] = useState<string | null>(null);
  const origin = siteOrigin();

  const load = useCallback(async () => {
    try {
      const all = await call<InviteRow[]>("owner_invite_list", {
        _promotion_id: promotionId ?? null,
        _limit: 500,
      });
      setRows(promotionId ? all : all.filter((r) => !r.promotion_id));
    } catch (e) {
      toast.error((e as Error).message);
      setRows([]);
    }
  }, [promotionId]);
  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const made = await call<{ code: string }[]>("owner_invite_create", {
        _count: custom.trim() ? 1 : count,
        _label: label.trim() || null,
        _channel: channel || null,
        _days: days ? Number(days) : null,
        _max_uses: uses,
        _promotion_id: promotionId ?? null,
        _code: custom.trim() || null,
      });
      setFresh(made.map((m) => m.code));
      setCustom("");
      setLabel("");
      toast.success(made.length === 1 ? "Code created" : `${made.length} codes created`);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await call("owner_invite_revoke", { _invite_id: revoking.id, _reason: reason });
      toast.success("Code revoked");
      setRevoking(null);
      setReason("");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shown = (rows ?? []).filter((r) => filter === "all" || r.status === filter);
  const openLinks = (rows ?? []).filter((r) => r.status === "open").map((r) => codeLink(r.code, origin));

  return (
    <div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="code-custom">Your own code (optional)</Label>
            <Input
              id="code-custom"
              placeholder="e.g. launch-week"
              maxLength={40}
              value={custom}
              onChange={(e) => setCustom(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            />
          </div>
          <div>
            <Label htmlFor="code-count">How many codes</Label>
            <Input
              id="code-count"
              type="number"
              min={1}
              max={50}
              disabled={!!custom.trim()}
              value={custom.trim() ? 1 : count}
              onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            />
          </div>
          <div>
            <Label htmlFor="code-uses">Uses per code</Label>
            <Input
              id="code-uses"
              type="number"
              min={1}
              max={100000}
              value={uses}
              onChange={(e) => setUses(Math.max(1, Math.min(100000, Number(e.target.value) || 1)))}
            />
          </div>
          <div>
            <Label htmlFor="code-days">Expires after (days, blank for never)</Label>
            <Input
              id="code-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="code-label">Who it's for (only you see this)</Label>
            <Input id="code-label" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="code-channel">Shared by</Label>
            <select
              id="code-channel"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={channel}
              onChange={(e) => setChannel(e.target.value as InviteChannel | "")}
            >
              <option value="">Not set</option>
              {(Object.keys(CHANNEL_LABELS) as InviteChannel[]).map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={create} disabled={creating}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Create {custom.trim() ? "code" : count === 1 ? "code" : `${count} codes`}
          </Button>
          <span className="text-xs text-muted-foreground">
            Creating a code sends nothing. You share it yourself.
          </span>
        </div>
      </div>

      {fresh.length > 0 && (
        <div className="mt-3 rounded-2xl border border-primary/40 bg-primary/5 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">New codes</span>
            {fresh.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyText(fresh.map((c) => codeLink(c, origin)).join("\n"), "Links")}
              >
                <Copy className="mr-1 h-3 w-3" /> Copy all links
              </Button>
            )}
          </div>
          <ul className="mt-2 space-y-1">
            {fresh.map((c) => (
              <li key={c} className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-xs">{c}</code>
                <code className="break-all font-mono text-xs text-muted-foreground">{codeLink(c, origin)}</code>
                <Button size="sm" variant="outline" aria-label="Copy link" onClick={() => copyText(codeLink(c, origin), "Link")}>
                  <Link2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(["all", "open", "used_up", "expired", "revoked"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : INVITE_STATUS_LABELS[f]}
              {rows && ` (${f === "all" ? rows.length : rows.filter((r) => r.status === f).length})`}
            </Button>
          ))}
        </div>
        {openLinks.length > 1 && (
          <Button size="sm" variant="outline" onClick={() => copyText(openLinks.join("\n"), `${openLinks.length} links`)}>
            <Copy className="mr-1 h-3 w-3" /> Copy all open links
          </Button>
        )}
      </div>

      {!rows && <Loader2 className="mt-6 h-6 w-6 animate-spin text-muted-foreground" />}
      {rows && (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">Code</th>
                <th className="p-3">For</th>
                <th className="p-3">Status</th>
                <th className="p-3">Uses</th>
                <th className="p-3">Dates</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-muted-foreground">
                    No codes here yet.
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="p-3 font-mono text-xs">{r.code}</td>
                  <td className="p-3">
                    <LabelEdit
                      id={r.id}
                      label={r.label}
                      onSaved={(l) => setRows((p) => (p ?? []).map((x) => (x.id === r.id ? { ...x, label: l } : x)))}
                    />
                    {r.channel && <div className="text-xs text-muted-foreground">{CHANNEL_LABELS[r.channel]}</div>}
                  </td>
                  <td className="p-3">
                    {INVITE_STATUS_LABELS[r.status]}
                    {r.revoked_reason && <div className="text-xs text-muted-foreground">{r.revoked_reason}</div>}
                  </td>
                  <td className="p-3">
                    {r.use_count > 0 ? (
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => setShowUses(showUses === r.id ? null : r.id)}
                      >
                        {usesLine(r)}
                      </button>
                    ) : (
                      usesLine(r)
                    )}
                    {r.last_used_by_username && (
                      <div className="text-xs text-muted-foreground">last @{r.last_used_by_username}</div>
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    Created {fmt(r.created_at)}
                    {r.expires_at && ` · ${new Date(r.expires_at) > new Date() ? "expires" : "expired"} ${fmt(r.expires_at)}`}
                    {r.last_used_at && ` · last used ${fmt(r.last_used_at)}`}
                  </td>
                  <td className="whitespace-nowrap p-3 text-right">
                    <Button size="sm" variant="outline" aria-label="Copy code" onClick={() => copyText(r.code, "Code")}>
                      <Copy className="h-3 w-3" />
                    </Button>{" "}
                    {r.status === "open" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label="Copy link"
                          onClick={() => copyText(codeLink(r.code, origin), "Link")}
                        >
                          <Link2 className="h-3 w-3" />
                        </Button>{" "}
                      </>
                    )}
                    {r.status !== "revoked" && (
                      <Button size="sm" variant="ghost" onClick={() => setRevoking(r)}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showUses && (
        <div className="mt-4">
          <h3 className="mb-2 font-semibold">Who used {rows?.find((r) => r.id === showUses)?.code}</h3>
          <Redemptions inviteId={showUses} />
        </div>
      )}

      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              The code stops working for anyone who hasn't used it yet. People who already used it keep
              what they got. The code and its history stay on record, and this is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label htmlFor="revoke-reason">Reason (for the audit log)</Label>
            <Textarea id="revoke-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={revoke}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Revoke
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
