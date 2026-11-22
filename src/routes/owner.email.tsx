import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AUTH_TEMPLATES, renderAuthTemplate } from "@/lib/email/auth-templates";
import {
  getEmailServerStatus,
  runEmailQueueNow,
  sendAnnouncement,
  sendTestEmail,
} from "@/lib/email/functions";
import {
  emailRpc,
  EmailNotInstalledError,
  type EmailLogRow,
  type EmailSettings,
  type EmailStatus,
  type Suppression,
} from "@/lib/email/owner-api";
import { renderEmail } from "@/lib/email/render";
import { CATEGORY_LABELS, TEMPLATES, type EmailCategory } from "@/lib/email/templates";

export const Route = createFileRoute("/owner/email")({
  component: EmailPage,
});

type ServerStatus = Awaited<ReturnType<typeof getEmailServerStatus>>;

const SWITCHES: { key: keyof EmailSettings; label: string; body: string }[] = [
  {
    key: "sending_enabled",
    label: "All email",
    body: "The master switch. Off: nothing is queued except owner test sends.",
  },
  {
    key: "account_enabled",
    label: "Account",
    body: "Welcome, account changes, report updates, account deleted.",
  },
  { key: "security_enabled", label: "Security", body: "Password and sign-in email changes." },
  {
    key: "billing_enabled",
    label: "Plus, tips and payouts",
    body: "Plan changes and tips. Stripe sends the receipts.",
  },
  {
    key: "messages_enabled",
    label: "Messages",
    body: "New messages and message requests. People can turn these off.",
  },
  {
    key: "activity_enabled",
    label: "Activity",
    body: "Wishlists going live. People can turn these off.",
  },
  {
    key: "admin_enabled",
    label: "Owner alerts",
    body: "New reports, feedback and payment disputes, to the admin address.",
  },
  {
    key: "marketing_enabled",
    label: "News and offers",
    body: "Announcements to people who opted in. Needs the postal address first.",
  },
];

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  delayed: "Delayed",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  skipped: "Not sent",
  expired: "Expired",
};

const SKIP_LABEL: Record<string, string> = {
  category_off: "that kind of email is off",
  suppressed: "address bounced or unsubscribed",
  opted_out: "they turned this email off",
  hourly_cap: "too many in an hour",
  no_consent: "no news opt-in",
  too_old: "waited too long to send",
};

function EmailPage() {
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [installed, setInstalled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setServer(await getEmailServerStatus());
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    try {
      setStatus(await emailRpc("owner_email_status", {}));
      setInstalled(true);
    } catch (e) {
      if (e instanceof EmailNotInstalledError) setInstalled(false);
      else setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="text-3xl font-bold">Email</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every email Yooits sends: what turns it on, what it looks like, test sends to you,
          announcements and whether each one arrived. Stripe sends payment receipts itself, so none
          are repeated here.
        </p>
      </div>
      {error && <p className="text-muted-foreground">{error}</p>}
      {!server && !error && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
      {server && <SetupCard server={server} installed={installed} status={status} onRun={load} />}
      {server && installed && status && <SettingsCard status={status} onChange={setStatus} />}
      {server && <TemplatesCard server={server} />}
      <AuthTemplatesCard />
      {server && <AnnouncementCard server={server} status={status} installed={installed} />}
      {server && installed && <LogCard />}
    </div>
  );
}

function Row({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`}
      />
      <span>
        {label}
        {hint && !ok && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </li>
  );
}

function SetupCard({
  server,
  installed,
  status,
  onRun,
}: {
  server: ServerStatus;
  installed: boolean;
  status: EmailStatus | null;
  onRun: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await runEmailQueueNow();
      if (!r.configured) toast.error("The sender isn't connected yet.");
      else if (!r.ready) toast.error("Email isn't switched on in the database yet.");
      else toast.success(`Sent ${r.sent}, retrying ${r.retrying}, failed ${r.failed}.`);
      onRun();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const c24 = status?.counts_24h ?? {};
  return (
    <section className="rounded-2xl border border-border p-5">
      <h2 className="text-lg font-semibold">Setup</h2>
      <ul className="mt-3 space-y-2">
        <Row
          ok={server.resend}
          label="Sender connected (Resend)"
          hint="Needs RESEND_API_KEY in the Vercel project."
        />
        <Row
          ok={installed}
          label="Email tables in the database"
          hint="The email migration is ready and waits for approval."
        />
        <Row
          ok={!!status?.settings.dispatch_url}
          label="Sends within a minute of each event"
          hint="Needs the one-minute database schedule (prepared, waits for approval)."
        />
        <Row
          ok={server.mailingAddress}
          label="Postal address for news email"
          hint="Required by law in marketing email. Account email doesn't need it."
        />
        <Row
          ok={server.webhookSecret}
          label="Instant delivery updates (optional)"
          hint="Without it, delivery is checked every few minutes."
        />
      </ul>
      {status && (
        <p className="mt-4 text-sm text-muted-foreground">
          Last 24 hours: {c24.delivered ?? 0} delivered, {c24.sent ?? 0} sent, {c24.failed ?? 0}{" "}
          failed, {(c24.bounced ?? 0) + (c24.complained ?? 0)} bounced or spam, {status.queued}{" "}
          waiting. {status.marketing_opted_in} people want news.
        </p>
      )}
      <Button
        className="mt-4"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={busy || !server.resend}
      >
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        Send waiting email now
      </Button>
    </section>
  );
}

function SettingsCard({
  status,
  onChange,
}: {
  status: EmailStatus;
  onChange: (s: EmailStatus) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState(status.settings.admin_email);
  const [limit, setLimit] = useState(String(status.settings.daily_optional_limit));

  const save = async (key: string, value: string) => {
    setBusy(key);
    try {
      const settings = await emailRpc("owner_email_set_setting", { _key: key, _value: value });
      onChange({ ...status, settings });
      toast.success("Saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border p-5">
      <h2 className="text-lg font-semibold">What Yooits sends</h2>
      <div className="mt-3 divide-y divide-border">
        {SWITCHES.map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-4 py-3">
            <div>
              <div className="font-medium">{s.label}</div>
              <div className="text-sm text-muted-foreground">{s.body}</div>
            </div>
            <Switch
              checked={!!status.settings[s.key]}
              disabled={busy === s.key}
              onCheckedChange={(v) => save(s.key, String(v))}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium">Admin address</span>
          <span className="block text-xs text-muted-foreground">
            Owner alerts and test sends go here.
          </span>
          <div className="mt-1 flex gap-2">
            <Input
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              type="email"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "admin_email"}
              onClick={() => save("admin_email", adminEmail)}
            >
              Save
            </Button>
          </div>
        </label>
        <label className="text-sm">
          <span className="font-medium">Daily limit for optional email</span>
          <span className="block text-xs text-muted-foreground">
            Messages, activity and news. Account email is never held back.
          </span>
          <div className="mt-1 flex gap-2">
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" />
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "daily_optional_limit" || !/^\d+$/.test(limit)}
              onClick={() => save("daily_optional_limit", limit)}
            >
              Save
            </Button>
          </div>
        </label>
      </div>
    </section>
  );
}

function Preview({ html }: { html: string }) {
  return (
    <iframe
      title="Email preview"
      sandbox=""
      srcDoc={html}
      className="h-[560px] w-full rounded-xl border border-border bg-white"
    />
  );
}

function TemplatesCard({ server }: { server: ServerStatus }) {
  const [id, setId] = useState(TEMPLATES[0].id);
  const [showText, setShowText] = useState(false);
  const [width, setWidth] = useState<"phone" | "desktop">("desktop");
  const [busy, setBusy] = useState<"me" | "admin" | null>(null);
  const def = TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
  const rendered = useMemo(
    () =>
      renderEmail(def.id, def.sample, {
        unsubscribeToken: "0".repeat(48),
        isTest: def.category === "marketing",
      }),
    [def],
  );
  const groups = useMemo(() => {
    const m = new Map<EmailCategory, typeof TEMPLATES>();
    for (const t of TEMPLATES) m.set(t.category, [...(m.get(t.category) ?? []), t]);
    return [...m.entries()];
  }, []);

  const test = async (to: "me" | "admin") => {
    setBusy(to);
    try {
      const r = await sendTestEmail({ data: { template: def.id, to } });
      if (r.status === "failed")
        toast.error(`Test to ${r.to} failed: ${r.error ?? "unknown error"}`);
      else toast.success(`Test sent to ${r.to}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border p-5">
      <h2 className="text-lg font-semibold">Templates</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {TEMPLATES.length} emails. Pick one to see it with sample details. Test sends go only to
        you.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="max-h-[640px] space-y-4 overflow-y-auto pr-1">
          {groups.map(([cat, list]) => (
            <div key={cat}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {CATEGORY_LABELS[cat]}
              </div>
              <ul className="mt-1 space-y-0.5">
                {list.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setId(t.id)}
                      className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${t.id === id ? "bg-primary/20 font-medium" : "hover:bg-muted"}`}
                    >
                      {t.label}
                      {!t.wired && (
                        <span className="ml-1 text-xs text-muted-foreground">(not sent yet)</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-3">
          <div className="text-sm">
            <div className="font-medium">{rendered.subject}</div>
            <div className="text-muted-foreground">
              From {rendered.from}. {def.trigger}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={width === "desktop" ? "default" : "outline"}
              onClick={() => setWidth("desktop")}
            >
              Desktop
            </Button>
            <Button
              size="sm"
              variant={width === "phone" ? "default" : "outline"}
              onClick={() => setWidth("phone")}
            >
              Phone
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowText((v) => !v)}>
              {showText ? "Show design" : "Show plain text"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!server.resend || !!busy}
              onClick={() => test("me")}
            >
              {busy === "me" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send test to me
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!server.resend || !!busy}
              onClick={() => test("admin")}
            >
              {busy === "admin" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send test to{" "}
              {server.adminEmail}
            </Button>
          </div>
          {showText ? (
            <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-xl border border-border p-4 text-xs">
              {rendered.text}
            </pre>
          ) : (
            <div className={width === "phone" ? "mx-auto max-w-[390px]" : ""}>
              <Preview html={rendered.html} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AuthTemplatesCard() {
  const [id, setId] = useState(AUTH_TEMPLATES[0].id);
  const [copied, setCopied] = useState<string | null>(null);
  const t = AUTH_TEMPLATES.find((x) => x.id === id) ?? AUTH_TEMPLATES[0];
  const html = useMemo(() => renderAuthTemplate(t), [t]);
  const copy = async (what: "subject" | "html") => {
    await navigator.clipboard.writeText(what === "html" ? html : t.subject);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <section className="rounded-2xl border border-border p-5">
      <h2 className="text-lg font-semibold">Sign-in emails (sent by Supabase)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Supabase sends these itself through the same sender. To brand them, paste each subject and
        body into Supabase under Authentication, Emails, Templates.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {AUTH_TEMPLATES.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant={a.id === id ? "default" : "outline"}
            onClick={() => setId(a.id)}
          >
            {a.label}
          </Button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Subject:</span> {t.subject}
        <Button size="sm" variant="outline" onClick={() => copy("subject")}>
          {copied === "subject" ? (
            <Check className="mr-1 h-4 w-4" />
          ) : (
            <Copy className="mr-1 h-4 w-4" />
          )}
          Copy subject
        </Button>
        <Button size="sm" variant="outline" onClick={() => copy("html")}>
          {copied === "html" ? (
            <Check className="mr-1 h-4 w-4" />
          ) : (
            <Copy className="mr-1 h-4 w-4" />
          )}
          Copy body
        </Button>
      </div>
      <div className="mt-3">
        <Preview html={html} />
      </div>
    </section>
  );
}

function AnnouncementCard({
  server,
  status,
  installed,
}: {
  server: ServerStatus;
  status: EmailStatus | null;
  installed: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [buttonLabel, setButtonLabel] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState<"test" | "everyone" | null>(null);

  const payload = { subject, heading, body, button_label: buttonLabel, button_url: buttonUrl };
  const html = useMemo(
    () =>
      renderEmail("announcement", payload, { unsubscribeToken: "0".repeat(48), isTest: true }).html,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject, heading, body, buttonLabel, buttonUrl],
  );
  const filled =
    subject.trim().length >= 3 && heading.trim().length >= 3 && body.trim().length >= 10;
  const canSendAll =
    filled &&
    server.resend &&
    installed &&
    server.mailingAddress &&
    !!status?.settings.sending_enabled &&
    !!status?.settings.marketing_enabled &&
    confirm === "SEND";

  const send = async (mode: "test" | "everyone") => {
    setBusy(mode);
    try {
      const r = await sendAnnouncement({
        data: {
          subject,
          heading,
          body,
          button_label: buttonLabel || undefined,
          button_url: buttonUrl || undefined,
          mode,
          confirm: mode === "everyone" ? confirm : undefined,
        },
      });
      toast.success(r.mode === "test" ? `Test sent to ${r.to}` : `Queued for ${r.queued} people`);
      if (mode === "everyone") setConfirm("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border p-5">
      <h2 className="text-lg font-semibold">Announcement</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Goes only to people who switched on News from Yooits ({status?.marketing_opted_in ?? 0}{" "}
        now), with an unsubscribe link. For in-app announcements, use the dashboard announcement
        banner.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={120}
          />
          <Input
            placeholder="Heading"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
            maxLength={120}
          />
          <Textarea
            placeholder="Message. A blank line starts a new paragraph."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            maxLength={4000}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Button words (optional)"
              value={buttonLabel}
              onChange={(e) => setButtonLabel(e.target.value)}
              maxLength={40}
            />
            <Input
              placeholder="https://yooits.me/…"
              value={buttonUrl}
              onChange={(e) => setButtonUrl(e.target.value)}
              maxLength={500}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!filled || !server.resend || !installed || !!busy}
            onClick={() => send("test")}
          >
            {busy === "test" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send test to{" "}
            {server.adminEmail}
          </Button>
          <div className="rounded-xl border border-border p-3 text-sm">
            <div className="font-medium">Send to everyone who opted in</div>
            {!server.mailingAddress && (
              <p className="text-muted-foreground">Needs the postal address in the footer first.</p>
            )}
            {server.mailingAddress && !status?.settings.marketing_enabled && (
              <p className="text-muted-foreground">Turn on News and offers above first.</p>
            )}
            <div className="mt-2 flex gap-2">
              <Input
                placeholder="Type SEND"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Button size="sm" disabled={!canSendAll || !!busy} onClick={() => send("everyone")}>
                {busy === "everyone" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send
              </Button>
            </div>
          </div>
        </div>
        <Preview html={html} />
      </div>
    </section>
  );
}

const FILTERS = [
  { id: "", label: "All" },
  { id: "problems", label: "Problems" },
  { id: "queued", label: "Waiting" },
  { id: "delivered", label: "Delivered" },
  { id: "skipped", label: "Not sent" },
];

function LogCard() {
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<EmailLogRow[] | null>(null);
  const [supp, setSupp] = useState<Suppression[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await emailRpc("owner_email_log", { _status: filter || null, _limit: 100 }));
      setSupp(await emailRpc("owner_email_suppressions", {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter]);
  useEffect(() => {
    load();
  }, [load]);

  const retry = async (id: string) => {
    try {
      await emailRpc("owner_email_retry", { _id: id });
      toast.success("Back in the queue");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const unsuppress = async (email: string) => {
    try {
      await emailRpc("owner_email_unsuppress", { _email: email });
      toast.success(`${email} can get email again`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section className="rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Delivery log</h2>
        <Button size="sm" variant="ghost" onClick={load}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "default" : "outline"}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-muted-foreground">{error}</p>}
      {!rows && !error && <Loader2 className="mt-4 h-5 w-5 animate-spin text-muted-foreground" />}
      {rows && rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">Nothing here yet.</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="mt-4 divide-y divide-border text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {r.subject ?? r.template}
                  {r.is_test && <span className="ml-1 text-xs text-muted-foreground">test</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {r.username ? `@${r.username} · ` : ""}
                  {r.to_email} · {new Date(r.created_at).toLocaleString()}
                  {r.attempts > 1 ? ` · ${r.attempts} tries` : ""}
                </div>
                {(r.last_error || r.skip_reason) && (
                  <div className="text-xs text-muted-foreground">
                    {r.skip_reason ? (SKIP_LABEL[r.skip_reason] ?? r.skip_reason) : r.last_error}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                {(r.status === "failed" || r.status === "expired") && (
                  <Button size="sm" variant="outline" onClick={() => retry(r.id)}>
                    Retry
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {supp.length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold">Addresses Yooits won't email</h3>
          <p className="text-xs text-muted-foreground">
            Added when an email bounces or is marked as spam.
          </p>
          <ul className="mt-2 divide-y divide-border text-sm">
            {supp.map((s) => (
              <li key={s.email} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {s.email} <span className="text-xs text-muted-foreground">({s.reason})</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => unsuppress(s.email)}>
                  Allow again
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
