/** Who can message me, the 18+ confirmation, and the people I've blocked. */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { dm, type MessageMode, type MySettings } from "@/lib/messages/api";

const MODES: { id: MessageMode; label: string; help: string }[] = [
  { id: "off", label: "Off", help: "Nobody can message you, and you can't send messages." },
  {
    id: "requests",
    label: "Requests",
    help: "New people send one message, without links, and you choose whether to accept.",
  },
  {
    id: "everyone",
    label: "Everyone",
    help: "Anyone with messages on can message you straight away.",
  },
];

export function MessagingSettings({
  settings,
  onChanged,
}: {
  settings: MySettings;
  onChanged: (s: MySettings) => void;
}) {
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocks, setBlocks] = useState<{ username: string; display_name: string | null }[] | null>(
    null,
  );

  const loadBlocks = useCallback(() => {
    dm("dm_list_blocks", {}).then(setBlocks, () => setBlocks([]));
  }, []);
  useEffect(loadBlocks, [loadBlocks]);

  const choose = async (mode: MessageMode) => {
    if (mode !== "off" && !settings.adult_confirmed && !adult) {
      toast.error("Please confirm you're 18 or older first.");
      return;
    }
    setBusy(true);
    try {
      onChanged(await dm("dm_set_mode", { _mode: mode, _confirm_adult: mode !== "off" && adult }));
      toast.success(mode === "off" ? "Messages turned off" : "Message settings saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unblock = async (username: string) => {
    try {
      await dm("dm_set_block", { _username: username, _blocked: false });
      toast.success(`Unblocked @${username}`);
      loadBlocks();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="font-semibold">Who can message you</div>
      <div className="grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={busy || settings.suspended}
            onClick={() => choose(m.id)}
            aria-pressed={settings.mode === m.id}
            className={`rounded-xl border p-3 text-left transition ${
              settings.mode === m.id
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="font-medium">{m.label}</div>
            <div className="mt-1 text-xs text-muted-foreground">{m.help}</div>
          </button>
        ))}
      </div>
      {!settings.adult_confirmed && (
        <div className="flex items-start gap-2">
          <Checkbox id="dm-adult" checked={adult} onCheckedChange={(v) => setAdult(v === true)} />
          <Label htmlFor="dm-adult" className="text-sm font-normal leading-snug">
            I'm 18 or older. Messages are for adults only for now.
          </Label>
        </div>
      )}
      {settings.suspended && (
        <p className="text-destructive">Messaging is turned off for your account by Yooits.me.</p>
      )}
      <p className="text-xs text-muted-foreground">
        Messages are text only. Yooits.me can read a message if someone reports it, and removes
        messages that break the Terms.
      </p>
      <div>
        <div className="font-semibold">Blocked people</div>
        {blocks === null ? null : blocks.length === 0 ? (
          <p className="mt-1 text-muted-foreground">You haven't blocked anyone.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {blocks.map((b) => (
              <li key={b.username} className="flex items-center justify-between gap-2">
                <span>
                  {b.display_name || b.username}{" "}
                  <span className="text-muted-foreground">@{b.username}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => unblock(b.username)}>
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
