import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { emailRpc, EmailNotInstalledError } from "@/lib/email/owner-api";

type Prefs = { messages: boolean; activity: boolean; marketing: boolean };

const ROWS: { key: keyof Prefs; title: string; body: string }[] = [
  {
    key: "messages",
    title: "Messages",
    body: "When someone messages you or sends a message request.",
  },
  {
    key: "activity",
    title: "Page activity",
    body: "Wishlists going live and other updates about your page.",
  },
  {
    key: "marketing",
    title: "News from Yooits.me",
    body: "New features and occasional announcements.",
  },
];

/**
 * Dashboard email choices. Account, security and payment email always goes
 * out. Shows nothing until email is switched on in the database.
 */
export function EmailPreferences() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    emailRpc("my_email_preferences", {})
      .then(setPrefs)
      .catch((e) => {
        if (e instanceof EmailNotInstalledError) setHidden(true);
      });
  }, []);

  if (hidden || !prefs) return null;

  const set = async (key: keyof Prefs, value: boolean) => {
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    setBusy(true);
    try {
      setPrefs(
        await emailRpc("set_my_email_preferences", {
          _messages: key === "messages" ? value : null,
          _activity: key === "activity" ? value : null,
          _marketing: key === "marketing" ? value : null,
        }),
      );
    } catch (e) {
      setPrefs(before);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border p-5">
      <div className="font-semibold">Email</div>
      <p className="mt-1 text-sm text-muted-foreground">
        Account, security and payment email always reaches you. Choose the rest.
      </p>
      <div className="mt-3 space-y-3">
        {ROWS.map((r) => (
          <div key={r.key} className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{r.title}</div>
              <div className="text-sm text-muted-foreground">{r.body}</div>
            </div>
            <Switch
              checked={prefs[r.key]}
              disabled={busy}
              onCheckedChange={(v) => set(r.key, v)}
              aria-label={r.title}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
