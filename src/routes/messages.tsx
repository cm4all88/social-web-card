import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Send, Settings } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessagingSettings } from "@/components/messages/MessagingSettings";
import {
  dm,
  MESSAGE_MAX,
  shortTime,
  type CanMessage,
  type ConversationSummary,
  type MySettings,
} from "@/lib/messages/api";

/** Inbox: conversations, message requests, settings, and a new message to ?to=username. */
export const Route = createFileRoute("/messages")({
  component: MessagesPage,
  validateSearch: z.object({ to: z.string().max(30).optional() }),
  head: () => ({ meta: [{ title: "Messages — Yooits.me" }, { name: "robots", content: "noindex" }] }),
});

const POLL_MS = 15_000;

function MessagesPage() {
  const navigate = useNavigate();
  const { to } = Route.useSearch();
  const [settings, setSettings] = useState<MySettings | null>(null);
  const [list, setList] = useState<ConversationSummary[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<"inbox" | "requests">("inbox");

  const load = useCallback(async () => {
    try {
      setList(await dm("dm_list_conversations", {}));
    } catch {
      setList((l) => l ?? []);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      try {
        const s = await dm("dm_my_settings", {});
        setSettings(s);
        if (s.mode === "off") setShowSettings(true);
      } catch (e) {
        toast.error((e as Error).message);
      }
      load();
    })();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [navigate, load]);

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const requests = (list ?? []).filter((c) => c.status === "request" && !c.i_requested);
  const inbox = (list ?? []).filter((c) => !(c.status === "request" && !c.i_requested));
  const shown = tab === "requests" ? requests : inbox;

  return (
    <div className="min-h-screen px-4 py-10">
      <Toaster />
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings((v) => !v)}>
            <Settings className="mr-2 h-4 w-4" /> Settings
          </Button>
        </div>
        <h1 className="text-3xl font-bold">Messages</h1>

        {!settings.available ? (
          <p className="mt-4 text-muted-foreground">
            Messages aren't available yet. Check back soon.
          </p>
        ) : (
          <>
            {!settings.site_enabled && (
              <p className="mt-2 text-xs text-muted-foreground">
                Admin preview: messages are switched off for everyone else.
              </p>
            )}
            {showSettings && (
              <div className="mt-6 rounded-2xl border border-border bg-card p-5">
                <MessagingSettings settings={settings} onChanged={setSettings} />
              </div>
            )}

            {to && settings.mode !== "off" && (
              <NewMessage
                username={to}
                onSent={(id) =>
                  navigate({ to: "/messages/$conversationId", params: { conversationId: id } })
                }
              />
            )}

            <div className="mt-6 flex gap-2">
              <Button
                size="sm"
                variant={tab === "inbox" ? "default" : "outline"}
                onClick={() => setTab("inbox")}
              >
                Inbox
              </Button>
              <Button
                size="sm"
                variant={tab === "requests" ? "default" : "outline"}
                onClick={() => setTab("requests")}
              >
                Requests{requests.length > 0 ? ` (${requests.length})` : ""}
              </Button>
            </div>

            {list === null ? (
              <Loader2 className="mt-8 h-6 w-6 animate-spin text-muted-foreground" />
            ) : shown.length === 0 ? (
              <p className="mt-6 text-muted-foreground">
                {tab === "requests"
                  ? "No message requests."
                  : settings.mode === "off"
                    ? "Turn on messages above to start talking."
                    : "No messages yet. Open someone's Yooits.me page and tap Message."}
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border rounded-2xl border border-border">
                {shown.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/messages/$conversationId"
                      params={{ conversationId: c.id }}
                      className="flex items-center gap-3 p-4 hover:bg-muted/40"
                    >
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarImage
                          src={c.other_avatar_url ?? undefined}
                          alt=""
                          className="object-cover"
                        />
                        <AvatarFallback>
                          {(c.other_display_name || c.other_username || "?")
                            .slice(0, 1)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate ${c.unread > 0 ? "font-semibold" : "font-medium"}`}
                          >
                            {c.other_display_name || c.other_username || "Deleted account"}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {shortTime(c.last_message_at)}
                          </span>
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {c.status === "request" && c.i_requested
                            ? "Request sent, waiting for them to accept"
                            : c.preview === null
                              ? "Message removed"
                              : `${c.preview_is_mine ? "You: " : ""}${c.preview}`}
                        </div>
                      </div>
                      {c.unread > 0 && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                          {c.unread}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NewMessage({
  username,
  onSent,
}: {
  username: string;
  onSent: (conversationId: string) => void;
}) {
  const [check, setCheck] = useState<CanMessage | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dm("dm_can_message", { _username: username }).then(setCheck, () =>
      setCheck({ status: "closed", conversation_id: null }),
    );
  }, [username]);

  useEffect(() => {
    if (check?.conversation_id) onSent(check.conversation_id);
  }, [check, onSent]);

  if (!check || check.conversation_id) return null;
  if (check.status !== "ok" && check.status !== "request") {
    return (
      <p className="mt-6 text-sm text-muted-foreground">You can't message @{username} right now.</p>
    );
  }

  const send = async () => {
    setBusy(true);
    try {
      const r = await dm("dm_start", { _username: username, _body: body });
      onSent(r.conversation_id);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-4">
      <div className="text-sm font-medium">New message to @{username}</div>
      {check.status === "request" && (
        <p className="mt-1 text-xs text-muted-foreground">
          This goes as a request. You can send one message, without links, until they accept.
        </p>
      )}
      <Textarea
        className="mt-3"
        rows={3}
        maxLength={MESSAGE_MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Say hello"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" disabled={busy || !body.trim()} onClick={send}>
          <Send className="mr-2 h-4 w-4" /> Send
        </Button>
      </div>
    </div>
  );
}
