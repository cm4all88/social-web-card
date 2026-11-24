import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Copy,
  Forward,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  PenSquare,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  disconnectMail,
  getMailStatus,
  mailCreateLabel,
  mailLabels,
  mailModify,
  mailPrepare,
  mailSend,
  mailThread,
  mailThreads,
  startMailConnect,
} from "@/lib/mail/functions";
import {
  displayName,
  formatBytes,
  frameDocument,
  listDate,
  MAX_UPLOAD_BYTES,
} from "@/lib/mail/view";
import { emailRpc, type EmailLogRow } from "@/lib/email/owner-api";
import { renderEmail } from "@/lib/email/render";

export const Route = createFileRoute("/owner/mail")({
  component: MailPage,
});

type Status = Awaited<ReturnType<typeof getMailStatus>>;
type Reconnect = { reconnect: true; message: string };
const isReconnect = (v: unknown): v is Reconnect =>
  !!v && typeof v === "object" && (v as Reconnect).reconnect === true;
type Labels = Exclude<Awaited<ReturnType<typeof mailLabels>>, Reconnect>;
type ThreadList = Exclude<Awaited<ReturnType<typeof mailThreads>>, Reconnect>;
type Thread = Exclude<Awaited<ReturnType<typeof mailThread>>, Reconnect>;

const ERRORS: Record<string, string> = {
  denied: "Google sign-in was cancelled, so nothing changed.",
  expired: "That sign-in took too long. Press Connect Gmail again.",
  scope: "Gmail access wasn't allowed. Press Connect Gmail again and allow it.",
  no_refresh: "Google didn't give a lasting sign-in. Press Connect Gmail again.",
  exchange: "Google didn't accept the sign-in. Check the client settings, then try again.",
  not_configured: "Google sign-in isn't set up on the server yet.",
};

function MailPage() {
  const [tab, setTab] = useState<"mailbox" | "system">("mailbox");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Mail</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your Gmail, here. Gmail stays the mailbox, so both show the same mail and read state.
          </p>
        </div>
        <div className="flex rounded-lg border border-border p-1 text-sm">
          {(["mailbox", "system"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 ${tab === t ? "bg-muted font-medium" : "text-muted-foreground"}`}
            >
              {t === "mailbox" ? "Mailbox" : "System emails"}
            </button>
          ))}
        </div>
      </div>
      {tab === "mailbox" ? <Mailbox /> : <SystemEmails />}
    </div>
  );
}

/* ---------------- mailbox ---------------- */

function Mailbox() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await getMailStatus());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const u = new URL(window.location.href);
    const err = u.searchParams.get("mail_error");
    if (u.searchParams.get("connected")) toast.success("Gmail is connected.");
    if (err) toast.error(ERRORS[err] ?? "Gmail didn't connect. Try again.");
    if (err || u.searchParams.get("connected")) {
      u.searchParams.delete("mail_error");
      u.searchParams.delete("connected");
      window.history.replaceState(null, "", u.pathname + u.search);
    }
    load();
  }, [load]);

  if (error) return <p className="text-muted-foreground">{error}</p>;
  if (!status) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  if (!status.configured) return <SetupCard status={status} />;
  if (!status.account || status.account.status !== "connected")
    return <ConnectCard status={status} />;
  return <MailApp status={status} onChanged={load} />;
}

function SetupCard({ status }: { status: Status }) {
  return (
    <section className="max-w-2xl space-y-3 rounded-2xl border border-border p-5">
      <h2 className="text-lg font-semibold">Google sign-in isn't set up yet</h2>
      <p className="text-sm text-muted-foreground">
        Once the server has a Google sign-in client, you connect your Gmail here once. The client
        needs this sign-in return address:
      </p>
      <CopyLine value={status.redirectUri} />
      <p className="text-sm text-muted-foreground">
        Then add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to the Vercel project.
      </p>
    </section>
  );
}

function CopyLine({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs">
      <span className="min-w-0 flex-1 break-all">{value}</span>
      <button
        aria-label="Copy"
        onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Copied"))}
      >
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}

function ConnectCard({ status }: { status: Status }) {
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await startMailConnect({ data: {} });
      window.location.assign(url);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  const broken = status.account?.status === "needs_reconnect";
  return (
    <section className="max-w-2xl space-y-3 rounded-2xl border border-border p-5">
      <h2 className="text-lg font-semibold">{broken ? "Reconnect Gmail" : "Connect Gmail"}</h2>
      <p className="text-sm text-muted-foreground">
        {broken
          ? `Google stopped accepting the sign-in for ${status.account?.google_email}. Connect again to keep using Mail here.`
          : "Sign in with the Google account that receives admin@yooits.me. Yooits.me keeps the sign-in encrypted on its server and only you can open the mailbox here."}
      </p>
      <Button onClick={connect} disabled={busy}>
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Mail className="mr-2 h-4 w-4" />
        )}
        {broken ? "Reconnect Gmail" : "Connect Gmail"}
      </Button>
    </section>
  );
}

type Compose = {
  mode: "new" | "reply" | "replyAll" | "forward";
  messageId: string | null;
  threadId: string | null;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  files: File[];
  originalFiles: { filename: string; size: number }[];
  keepAttachments: boolean;
};

function MailApp({ status, onChanged }: { status: Status; onChanged: () => void }) {
  const [labels, setLabels] = useState<Labels>([]);
  const [label, setLabel] = useState<string>("INBOX");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [list, setList] = useState<ThreadList | null>(null);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [loadingList, setLoadingList] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState<Compose | null>(null);
  const [reconnect, setReconnect] = useState<string | null>(null);

  const sendAs = status.sendAs;
  const defaultFrom = useMemo(
    () =>
      sendAs.find((s) => s.email === "admin@yooits.me")?.email ??
      sendAs.find((s) => s.isDefault)?.email ??
      sendAs[0]?.email ??
      "",
    [sendAs],
  );

  const loadLabels = useCallback(async () => {
    const r = await mailLabels().catch(() => null);
    if (isReconnect(r)) setReconnect(r.message);
    else if (r) setLabels(r);
  }, []);

  const pageToken = pages[pages.length - 1];
  const loadList = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoadingList(true);
      try {
        const r = await mailThreads({
          data: { label: search ? null : label, q: search || null, pageToken },
        });
        if (isReconnect(r)) setReconnect(r.message);
        else setList(r);
      } catch (e) {
        if (!quiet) toast.error((e as Error).message);
      } finally {
        setLoadingList(false);
      }
    },
    [label, search, pageToken],
  );

  useEffect(() => {
    loadLabels();
  }, [loadLabels]);
  useEffect(() => {
    loadList();
  }, [loadList]);

  // Keep in step with Gmail: refresh every minute and when the tab comes back.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        loadList(true);
        loadLabels();
      }
    };
    const id = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [loadList, loadLabels]);

  const pick = (id: string) => {
    setLabel(id);
    setSearch("");
    setQuery("");
    setPages([null]);
    setOpenId(null);
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Gmail from Yooits.me? Your mail stays in Gmail.")) return;
    try {
      await disconnectMail();
      toast.success("Disconnected. Your mail is still in Gmail.");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (reconnect)
    return (
      <ConnectCard
        status={{
          ...status,
          account: status.account && { ...status.account, status: "needs_reconnect" },
        }}
      />
    );

  const userLabels = labels.filter((l) => l.type === "user");
  const noYooits = sendAs.length > 0 && !sendAs.some((s) => s.email.endsWith("@yooits.me"));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          Connected: <span className="text-foreground">{status.account?.google_email}</span>
        </span>
        <button className="underline" onClick={disconnect}>
          Disconnect
        </button>
      </div>
      {noYooits && (
        <p className="rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm">
          This Gmail account can't send as a yooits.me address yet, so replies go out from{" "}
          {defaultFrom}. Add admin@yooits.me under Gmail settings, Accounts, "Send mail as".
        </p>
      )}
      {status.problem && <p className="text-sm text-muted-foreground">{status.problem}</p>}

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className={`space-y-3 ${openId ? "hidden lg:block" : ""}`}>
          <Button
            className="w-full"
            onClick={() =>
              setCompose({
                mode: "new",
                messageId: null,
                threadId: null,
                to: "",
                cc: "",
                bcc: "",
                subject: "",
                body: "",
                files: [],
                originalFiles: [],
                keepAttachments: false,
              })
            }
          >
            <PenSquare className="mr-2 h-4 w-4" /> Compose
          </Button>
          <nav className="flex gap-1 overflow-x-auto lg:flex-col">
            {labels
              .filter((l) => l.type === "system")
              .map((l) => (
                <FolderButton
                  key={l.id}
                  active={!search && label === l.id}
                  onClick={() => pick(l.id)}
                >
                  <span>{l.name}</span>
                  {!!l.unread && <span className="text-xs font-semibold">{l.unread}</span>}
                </FolderButton>
              ))}
            {userLabels.length > 0 && (
              <p className="hidden px-3 pt-2 text-xs uppercase tracking-wide text-muted-foreground lg:block">
                Labels
              </p>
            )}
            {userLabels.map((l) => (
              <FolderButton
                key={l.id}
                active={!search && label === l.id}
                onClick={() => pick(l.id)}
              >
                <span className="truncate">{l.name}</span>
              </FolderButton>
            ))}
          </nav>
          <NewLabel onCreated={loadLabels} />
        </aside>

        <main className="min-w-0">
          {openId ? (
            <ThreadView
              id={openId}
              labels={labels}
              onBack={() => setOpenId(null)}
              onChanged={() => {
                loadList(true);
                loadLabels();
              }}
              onCompose={setCompose}
            />
          ) : (
            <div className="space-y-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearch(query.trim());
                  setPages([null]);
                }}
              >
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search mail (same as Gmail search, e.g. from:ana has:attachment)"
                    className="pl-9"
                  />
                </div>
                {search && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSearch("");
                      setQuery("");
                      setPages([null]);
                    }}
                  >
                    Clear
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Refresh"
                  onClick={() => loadList()}
                >
                  <RefreshCw className={`h-4 w-4 ${loadingList ? "animate-spin" : ""}`} />
                </Button>
              </form>
              {search && <p className="text-sm text-muted-foreground">Results for “{search}”</p>}
              <ThreadRows
                list={list}
                loading={loadingList}
                sent={!search && label === "SENT"}
                onOpen={setOpenId}
                onStar={async (t) => {
                  await mailModify({
                    data: {
                      id: t.id,
                      add: t.starred ? [] : ["STARRED"],
                      remove: t.starred ? ["STARRED"] : [],
                    },
                  });
                  loadList(true);
                }}
              />
              <div className="flex justify-between text-sm">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pages.length < 2}
                  onClick={() => setPages((p) => p.slice(0, -1))}
                >
                  Newer
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!list?.nextPageToken}
                  onClick={() => list?.nextPageToken && setPages((p) => [...p, list.nextPageToken])}
                >
                  Older
                </Button>
              </div>
            </div>
          )}
        </main>
      </div>

      {compose && (
        <ComposeBox
          draft={compose}
          sendAs={sendAs}
          defaultFrom={defaultFrom}
          onChange={setCompose}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null);
            loadList(true);
          }}
        />
      )}
    </div>
  );
}

function FolderButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function NewLabel({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button
        className="hidden px-3 text-xs text-muted-foreground underline lg:block"
        onClick={() => setOpen(true)}
      >
        New label
      </button>
    );
  return (
    <form
      className="hidden gap-1 lg:flex"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await mailCreateLabel({ data: { name } });
          if (!isReconnect(r)) toast.success(`Label “${r.name}” added in Gmail.`);
          setName("");
          setOpen(false);
          onCreated();
        } catch (err) {
          toast.error((err as Error).message);
        }
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Label name"
        className="h-8"
      />
      <Button size="sm" type="submit" disabled={!name.trim()}>
        Add
      </Button>
    </form>
  );
}

function ThreadRows({
  list,
  loading,
  sent,
  onOpen,
  onStar,
}: {
  list: ThreadList | null;
  loading: boolean;
  sent: boolean;
  onOpen: (id: string) => void;
  onStar: (t: ThreadList["threads"][number]) => void;
}) {
  if (!list) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  if (list.threads.length === 0)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {loading ? "Loading…" : "No mail here."}
      </p>
    );
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {list.threads.map((t) => (
        <li
          key={t.id}
          className={`flex items-start gap-2 px-3 py-2.5 ${t.unread ? "bg-muted/40" : ""}`}
        >
          <button
            aria-label={t.starred ? "Unstar" : "Star"}
            onClick={() => onStar(t)}
            className="mt-0.5 shrink-0 text-muted-foreground"
          >
            <Star className={`h-4 w-4 ${t.starred ? "fill-amber-400 text-amber-400" : ""}`} />
          </button>
          <button onClick={() => onOpen(t.id)} className="min-w-0 flex-1 text-left">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`truncate text-sm ${t.unread ? "font-semibold" : ""}`}>
                {sent ? `To: ${displayName(t.to)}` : displayName(t.from)}
                {t.count > 1 && (
                  <span className="ml-1 text-xs text-muted-foreground">{t.count}</span>
                )}
              </span>
              <span
                className={`shrink-0 text-xs ${t.unread ? "font-semibold" : "text-muted-foreground"}`}
              >
                {listDate(t.date)}
              </span>
            </div>
            <div className={`truncate text-sm ${t.unread ? "font-medium" : ""}`}>{t.subject}</div>
            <div
              className="truncate text-xs text-muted-foreground"
              // Gmail snippets arrive HTML-escaped; decode them as text only.
            >
              {decodeEntities(t.snippet)}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function ThreadView({
  id,
  labels,
  onBack,
  onChanged,
  onCompose,
}: {
  id: string;
  labels: Labels;
  onBack: () => void;
  onChanged: () => void;
  onCompose: (c: Compose) => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [showImages, setShowImages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [labelMenu, setLabelMenu] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await mailThread({ data: { id, showImages } });
      if (!isReconnect(r)) {
        setThread(r);
        onChanged();
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on id/images only
  }, [id, showImages]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (
    data: { add?: string[]; remove?: string[]; trash?: "trash" | "restore" },
    done: string,
    leave = false,
  ) => {
    setBusy(true);
    try {
      await mailModify({
        data: { id, add: data.add ?? [], remove: data.remove ?? [], trash: data.trash },
      });
      toast.success(done);
      onChanged();
      if (leave) onBack();
      else await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reply = async (mode: "reply" | "replyAll" | "forward", messageId: string) => {
    try {
      const p = await mailPrepare({ data: { mode, messageId } });
      if (isReconnect(p)) return toast.error(p.message);
      onCompose({
        mode,
        messageId,
        threadId: id,
        to: p.to,
        cc: p.cc,
        bcc: "",
        subject: p.subject,
        body: p.body,
        files: [],
        originalFiles: p.files,
        keepAttachments: p.files.length > 0,
      });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!thread) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  const has = (l: string) => thread.labelIds.includes(l);
  const last = thread.messages[thread.messages.length - 1];
  const blocked = thread.messages.reduce((n, m) => n + m.blockedImages, 0);
  const userLabels = labels.filter((l) => l.type === "user");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        {has("TRASH") ? (
          <ToolButton
            icon={Undo2}
            label="Restore"
            disabled={busy}
            onClick={() => act({ trash: "restore" }, "Moved out of Trash.")}
          />
        ) : (
          <>
            {has("INBOX") ? (
              <ToolButton
                icon={Archive}
                label="Archive"
                disabled={busy}
                onClick={() => act({ remove: ["INBOX"] }, "Archived.", true)}
              />
            ) : (
              <ToolButton
                icon={Inbox}
                label="Move to Inbox"
                disabled={busy}
                onClick={() => act({ add: ["INBOX"], remove: ["SPAM"] }, "Moved to Inbox.")}
              />
            )}
            <ToolButton
              icon={MailOpen}
              label="Mark unread"
              disabled={busy}
              onClick={() => act({ add: ["UNREAD"] }, "Marked unread.", true)}
            />
            <ToolButton
              icon={Star}
              label={has("STARRED") ? "Unstar" : "Star"}
              disabled={busy}
              onClick={() =>
                act(
                  has("STARRED") ? { remove: ["STARRED"] } : { add: ["STARRED"] },
                  has("STARRED") ? "Unstarred." : "Starred.",
                )
              }
            />
            {has("SPAM") ? (
              <ToolButton
                icon={ShieldAlert}
                label="Not spam"
                disabled={busy}
                onClick={() => act({ remove: ["SPAM"], add: ["INBOX"] }, "Moved to Inbox.")}
              />
            ) : (
              <ToolButton
                icon={ShieldAlert}
                label="Spam"
                disabled={busy}
                onClick={() => act({ add: ["SPAM"], remove: ["INBOX"] }, "Marked as spam.", true)}
              />
            )}
            <ToolButton
              icon={Trash2}
              label="Trash"
              disabled={busy}
              onClick={() =>
                act({ trash: "trash" }, "Moved to Trash. Gmail empties it after 30 days.", true)
              }
            />
            {userLabels.length > 0 && (
              <div className="relative">
                <ToolButton
                  icon={Tag}
                  label="Labels"
                  disabled={busy}
                  onClick={() => setLabelMenu((v) => !v)}
                />
                {labelMenu && (
                  <div className="absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-auto rounded-lg border border-border bg-background p-1 shadow-lg">
                    {userLabels.map((l) => (
                      <label
                        key={l.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={has(l.id)}
                          onChange={(e) =>
                            act(
                              e.target.checked ? { add: [l.id] } : { remove: [l.id] },
                              e.target.checked ? `Labelled ${l.name}.` : `Removed ${l.name}.`,
                            )
                          }
                        />
                        <span className="truncate">{l.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <h2 className="text-xl font-semibold">{thread.subject}</h2>
      {blocked > 0 && !showImages && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          Pictures from the web are hidden, so senders can't tell you opened this.
          <button className="underline" onClick={() => setShowImages(true)}>
            Show pictures
          </button>
        </p>
      )}

      <div className="space-y-3">
        {thread.messages.map((m) => (
          <MessageCard
            key={m.id}
            m={m}
            showImages={showImages}
            onReply={(mode) => reply(mode, m.id)}
          />
        ))}
      </div>
      {last && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => reply("reply", last.id)}>
            <Reply className="mr-2 h-4 w-4" /> Reply
          </Button>
          <Button variant="secondary" onClick={() => reply("replyAll", last.id)}>
            <ReplyAll className="mr-2 h-4 w-4" /> Reply all
          </Button>
          <Button variant="secondary" onClick={() => reply("forward", last.id)}>
            <Forward className="mr-2 h-4 w-4" /> Forward
          </Button>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Archive;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled} title={label}>
      <Icon className="h-4 w-4 sm:mr-1" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

function MessageCard({
  m,
  showImages,
  onReply,
}: {
  m: Thread["messages"][number];
  showImages: boolean;
  onReply: (mode: "reply" | "replyAll" | "forward") => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const doc = useMemo(
    () => frameDocument(m.html, { showRemoteImages: showImages }),
    [m.html, showImages],
  );
  const fit = () => {
    const d = frame.current?.contentDocument;
    if (d?.body) setHeight(Math.min(Math.max(d.documentElement.scrollHeight, 80), 4000));
  };
  return (
    <article className="rounded-xl border border-border">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3 text-sm">
        <div className="min-w-0">
          <div className="font-medium">{m.from}</div>
          <div className="truncate text-xs text-muted-foreground">To: {m.to}</div>
          {m.cc && <div className="truncate text-xs text-muted-foreground">Cc: {m.cc}</div>}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {new Date(m.date).toLocaleString()}
          <button aria-label="Reply" title="Reply" className="p-1" onClick={() => onReply("reply")}>
            <Reply className="h-4 w-4" />
          </button>
          <button
            aria-label="Forward"
            title="Forward"
            className="p-1"
            onClick={() => onReply("forward")}
          >
            <Forward className="h-4 w-4" />
          </button>
        </div>
      </header>
      <iframe
        ref={frame}
        title={`Message from ${displayName(m.from)}`}
        // No scripts can run; links open in a new tab.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        onLoad={fit}
        style={{ height }}
        className="w-full rounded-b-xl bg-white"
      />
      {m.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          {m.attachments.map((a) => (
            <AttachmentChip key={a.partId} messageId={m.id} a={a} />
          ))}
        </div>
      )}
    </article>
  );
}

function AttachmentChip({
  messageId,
  a,
}: {
  messageId: string;
  a: { partId: string; filename: string; mimeType: string; size: number };
}) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/owner/mail/attachment?m=${encodeURIComponent(messageId)}&p=${encodeURIComponent(a.partId)}`,
        { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } },
      );
      if (!res.ok)
        throw new Error(res.status === 409 ? "Reconnect Gmail first." : await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't download that file.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={download}
      disabled={busy}
      className="flex max-w-full items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
      <span className="truncate">{a.filename}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.size)}</span>
    </button>
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    r.readAsDataURL(file);
  });
}

function ComposeBox({
  draft,
  sendAs,
  defaultFrom,
  onChange,
  onClose,
  onSent,
}: {
  draft: Compose;
  sendAs: Status["sendAs"];
  defaultFrom: string;
  onChange: (c: Compose) => void;
  onClose: () => void;
  onSent: () => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [showCc, setShowCc] = useState(!!draft.cc || !!draft.bcc);
  const [sending, setSending] = useState(false);
  const set = (patch: Partial<Compose>) => onChange({ ...draft, ...patch });
  const total = draft.files.reduce((n, f) => n + f.size, 0);
  const title = { new: "New message", reply: "Reply", replyAll: "Reply all", forward: "Forward" }[
    draft.mode
  ];

  const submit = async () => {
    if (!draft.to.trim() && !draft.cc.trim() && !draft.bcc.trim())
      return toast.error("Add at least one recipient.");
    if (total > MAX_UPLOAD_BYTES)
      return toast.error("Attached files can be up to 3 MB in total here.");
    setSending(true);
    try {
      const attachments = await Promise.all(
        draft.files.map(async (f) => ({
          filename: f.name,
          mimeType: f.type || "application/octet-stream",
          base64: await readBase64(f),
        })),
      );
      const r = await mailSend({
        data: {
          mode: draft.mode,
          messageId: draft.messageId,
          from,
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          body: draft.body,
          attachments,
          keepAttachments: draft.mode === "forward" && draft.keepAttachments,
        },
      });
      if (isReconnect(r)) throw new Error(r.message);
      toast.success("Sent. It's in Sent in Gmail too.");
      onSent();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-label={title}
    >
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col rounded-t-2xl bg-background shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button aria-label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="w-14 text-muted-foreground">From</span>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            >
              {sendAs.map((s) => (
                <option key={s.email} value={s.email}>
                  {s.name ? `${s.name} <${s.email}>` : s.email}
                </option>
              ))}
            </select>
          </label>
          <AddressField label="To" value={draft.to} onChange={(to) => set({ to })} />
          {showCc ? (
            <>
              <AddressField label="Cc" value={draft.cc} onChange={(cc) => set({ cc })} />
              <AddressField label="Bcc" value={draft.bcc} onChange={(bcc) => set({ bcc })} />
            </>
          ) : (
            <button
              className="ml-16 text-xs text-muted-foreground underline"
              onClick={() => setShowCc(true)}
            >
              Cc and Bcc
            </button>
          )}
          <Input
            value={draft.subject}
            onChange={(e) => set({ subject: e.target.value })}
            placeholder="Subject"
          />
          <Textarea
            value={draft.body}
            onChange={(e) => set({ body: e.target.value })}
            rows={12}
            className="font-[inherit]"
            autoFocus
          />
          {draft.mode === "forward" && draft.originalFiles.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.keepAttachments}
                onChange={(e) => set({ keepAttachments: e.target.checked })}
              />
              Include the original files ({draft.originalFiles.map((f) => f.filename).join(", ")})
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <Paperclip className="h-4 w-4" /> Attach files
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  set({ files: [...draft.files, ...picked].slice(0, 10) });
                  e.target.value = "";
                }}
              />
            </label>
            {draft.files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {f.name} ({formatBytes(f.size)})
                <button
                  aria-label={`Remove ${f.name}`}
                  onClick={() => set({ files: draft.files.filter((_, j) => j !== i) })}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {total > MAX_UPLOAD_BYTES && (
              <span className="text-xs text-red-500">
                Up to 3 MB of files here; send bigger ones from Gmail.
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={onClose}>
            Discard
          </Button>
          <Button onClick={submit} disabled={sending || !from}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddressField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-14 text-muted-foreground">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="name@example.com, another@example.com"
        className="flex-1"
        inputMode="email"
        autoComplete="off"
      />
    </label>
  );
}

/* ---------------- system emails ---------------- */

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

type Detail = EmailLogRow & {
  payload: Record<string, unknown>;
  provider_id: string | null;
  events: { type: string; detail: string | null; at: string }[];
};

function SystemEmails() {
  const [filter, setFilter] = useState("");
  const [rows, setRows] = useState<EmailLogRow[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(
        await emailRpc("owner_email_log", { _status: filter || null, _limit: 50, _offset: offset }),
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter, offset]);
  useEffect(() => {
    load();
  }, [load]);

  const open = async (id: string) => {
    const client = supabase as unknown as {
      rpc: (
        f: string,
        a: object,
      ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error: err } = await client.rpc("owner_email_detail", { _id: id });
    if (err) return toast.error(err.message);
    setDetail(data as Detail);
  };

  if (detail) return <SystemEmailDetail d={detail} onBack={() => setDetail(null)} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Automatic Yooits.me email sent through Resend (welcome, security, messages, owner alerts), with
        each one's delivery. These aren't in Gmail.
      </p>
      <div className="flex flex-wrap gap-2">
        {[
          ["", "All"],
          ["delivered", "Delivered"],
          ["sent", "Sent"],
          ["problems", "Problems"],
          ["skipped", "Not sent"],
        ].map(([v, l]) => (
          <Button
            key={v}
            size="sm"
            variant={filter === v ? "secondary" : "ghost"}
            onClick={() => {
              setFilter(v);
              setOffset(0);
            }}
          >
            {l}
          </Button>
        ))}
        <Button size="sm" variant="ghost" aria-label="Refresh" onClick={load}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
      {!rows && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {rows && rows.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing here.</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => open(r.id)}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.subject || r.template}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.to_email}
                    {r.username ? ` (@${r.username})` : ""}
                    {r.is_test ? " · test" : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div
                    className={
                      /failed|bounced|complained|expired/.test(r.status) ? "text-red-500" : ""
                    }
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </div>
                  <div className="text-muted-foreground">
                    {listDate(new Date(r.created_at).getTime())}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - 50))}
        >
          Newer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!rows || rows.length < 50}
          onClick={() => setOffset((o) => o + 50)}
        >
          Older
        </Button>
      </div>
    </div>
  );
}

function SystemEmailDetail({ d, onBack }: { d: Detail; onBack: () => void }) {
  const preview = useMemo(() => {
    try {
      return renderEmail(d.template, d.payload ?? {}, { isTest: d.is_test }).html;
    } catch {
      return null;
    }
  }, [d]);
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Back
      </Button>
      <div>
        <h2 className="text-xl font-semibold">{d.subject || d.template}</h2>
        <p className="text-sm text-muted-foreground">
          To {d.to_email}
          {d.username ? ` (@${d.username})` : ""} · {STATUS_LABEL[d.status] ?? d.status}
          {d.skip_reason ? ` (${d.skip_reason.replace(/_/g, " ")})` : ""} · {d.attempts} attempt
          {d.attempts === 1 ? "" : "s"}
        </p>
        {d.last_error && <p className="mt-1 text-sm text-red-500">{d.last_error}</p>}
      </div>
      <ol className="space-y-1 text-sm">
        <li>Created {new Date(d.created_at).toLocaleString()}</li>
        {d.events.map((e, i) => (
          <li key={i}>
            {e.type.charAt(0).toUpperCase() + e.type.slice(1)} {new Date(e.at).toLocaleString()}
            {e.detail && e.detail !== e.type ? (
              <span className="text-muted-foreground"> · {e.detail}</span>
            ) : null}
          </li>
        ))}
      </ol>
      {preview ? (
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={preview}
          className="h-[600px] w-full rounded-xl border border-border bg-white"
        />
      ) : (
        <p className="text-sm text-muted-foreground">No preview for this template.</p>
      )}
    </div>
  );
}
