import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type Prefs = { messages: boolean; activity: boolean; marketing: boolean; email?: string };
type Kind = "messages" | "activity" | "marketing" | "all";
const KINDS: Kind[] = ["messages", "activity", "marketing", "all"];

export const Route = createFileRoute("/email/preferences")({
  validateSearch: (s: Record<string, unknown>): { t?: string; unsubscribe?: Kind } => ({
    t: typeof s.t === "string" ? s.t : undefined,
    unsubscribe: KINDS.includes(s.unsubscribe as Kind) ? (s.unsubscribe as Kind) : undefined,
  }),
  component: EmailPreferencesPage,
  head: () => ({
    meta: [{ title: "Email preferences — Yooits.me" }, { name: "robots", content: "noindex" }],
  }),
});

const LABELS: Record<Exclude<Kind, "all">, { title: string; body: string }> = {
  messages: { title: "Messages", body: "When someone sends you a message or a message request." },
  activity: {
    title: "Page activity",
    body: "Wishlists going live, rewards and other updates about your page.",
  },
  marketing: { title: "News from Yooits.me", body: "New features and occasional announcements." },
};

const rpc = (fn: string, args: object) =>
  (
    supabase as unknown as {
      rpc: (
        f: string,
        a: object,
      ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    }
  ).rpc(fn, args);

/**
 * Where the unsubscribe and "Email preferences" links in Yooits.me email land.
 * The link's token identifies the person, so no sign-in is needed. Account,
 * security and billing email can't be turned off here: those are about the
 * account itself.
 */
function EmailPreferencesPage() {
  const { t, unsubscribe } = Route.useSearch();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "error">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const did = useRef(false);

  useEffect(() => {
    if (did.current) return;
    did.current = true;
    if (!t || !/^[a-f0-9]{48}$/.test(t)) {
      setState("invalid");
      return;
    }
    (async () => {
      const { data, error } = unsubscribe
        ? await rpc("email_unsubscribe", { _token: t, _category: unsubscribe })
        : await rpc("email_preferences_by_token", { _token: t });
      if (error) return setState("error");
      if (!data) return setState("invalid");
      setPrefs(data as Prefs);
      setState("ready");
      if (unsubscribe) {
        setNotice(
          unsubscribe === "all"
            ? "You're unsubscribed from all optional email."
            : `You're unsubscribed from ${LABELS[unsubscribe].title.toLowerCase()} email.`,
        );
      }
    })();
  }, [t, unsubscribe]);

  const toggle = async (k: Exclude<Kind, "all">, v: boolean) => {
    if (!prefs || !t) return;
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    setSaving(true);
    const { data, error } = await rpc("email_set_preferences_by_token", {
      _token: t,
      _messages: next.messages,
      _activity: next.activity,
      _marketing: next.marketing,
    });
    setSaving(false);
    if (error || !data) {
      setPrefs(prefs);
      setNotice("That didn't save. Please try again.");
      return;
    }
    setPrefs(data as Prefs);
    setNotice("Saved.");
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div
        className="w-full max-w-md rounded-3xl border border-border bg-card p-8"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <h1 className="text-2xl font-bold">Email preferences</h1>
        {state === "loading" && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
        {state === "invalid" && (
          <p className="mt-4 text-sm text-muted-foreground">
            This link isn't valid any more. You can change your email choices from your{" "}
            <Link to="/dashboard" className="underline">
              dashboard
            </Link>
            .
          </p>
        )}
        {state === "error" && (
          <p className="mt-4 text-sm text-muted-foreground">
            Something went wrong. Please try the link again in a minute.
          </p>
        )}
        {state === "ready" && prefs && (
          <div className="mt-4 space-y-5">
            {prefs.email && <p className="text-sm text-muted-foreground">For {prefs.email}</p>}
            {notice && (
              <p
                role="status"
                className="rounded-xl border border-border bg-background/40 px-3 py-2 text-sm"
              >
                {notice}
              </p>
            )}
            {(Object.keys(LABELS) as Exclude<Kind, "all">[]).map((k) => (
              <div key={k} className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor={`pref-${k}`} className="text-base font-semibold">
                    {LABELS[k].title}
                  </Label>
                  <p className="text-sm text-muted-foreground">{LABELS[k].body}</p>
                </div>
                <Switch
                  id={`pref-${k}`}
                  checked={prefs[k]}
                  disabled={saving}
                  onCheckedChange={(v) => toggle(k, v)}
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Account, security and payment email always goes out, because it's about your account
              itself.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
