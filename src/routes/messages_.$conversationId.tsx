import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Ban, Flag, Loader2, MoreVertical, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReportLink } from "@/components/reports/ReportLink";
import { dm, MESSAGE_MAX, messageError, type Conversation, type Message } from "@/lib/messages/api";
import { REPORT_DETAILS_MAX, REPORT_REASONS, type ReportReason } from "@/lib/reports/reasons";

export const Route = createFileRoute("/messages_/$conversationId")({
  component: ConversationPage,
  head: () => ({ meta: [{ title: "Messages — Yooits" }, { name: "robots", content: "noindex" }] }),
});

const POLL_MS = 5_000;

function ConversationPage() {
  const { conversationId } = Route.useParams();
  const navigate = useNavigate();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState<Message | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const c = await dm("dm_get_conversation", { _conversation_id: conversationId });
      setConv(c);
      setError(null);
      if (c.messages.length !== lastCount.current) {
        lastCount.current = c.messages.length;
        dm("dm_mark_read", { _conversation_id: conversationId }).catch(() => {});
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [conversationId]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({ to: "/auth" });
        return;
      }
      load();
    })();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [navigate, load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [conv?.messages.length]);

  const send = async () => {
    setBusy(true);
    try {
      await dm("dm_send", { _conversation_id: conversationId, _body: body });
      setBody("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const respond = async (accept: boolean) => {
    try {
      await dm("dm_respond", { _conversation_id: conversationId, _accept: accept });
      if (accept) {
        toast.success("Request accepted");
        load();
      } else {
        toast.success("Request declined");
        navigate({ to: "/messages" });
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const setBlocked = async (blocked: boolean) => {
    if (!conv?.other) return;
    try {
      await dm("dm_set_block", { _username: conv.other.username, _blocked: blocked });
      toast.success(
        blocked ? `Blocked @${conv.other.username}` : `Unblocked @${conv.other.username}`,
      );
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (error && !conv) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Link
          to="/messages"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Messages
        </Link>
        <p className="mt-6 text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!conv) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const other = conv.other;
  const name = other?.display_name || other?.username || "Deleted account";
  const incomingRequest = conv.status === "request" && !conv.i_requested;
  const waiting =
    conv.status === "request" && conv.i_requested && conv.messages.some((m) => m.mine);

  return (
    <div className="flex min-h-screen flex-col">
      <Toaster />
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Link
            to="/messages"
            aria-label="Back to messages"
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{name}</div>
            {other && (
              <a
                href={`/${other.username}`}
                className="text-xs text-muted-foreground hover:underline"
              >
                @{other.username}
              </a>
            )}
          </div>
          {other && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Conversation options">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setBlocked(!conv.i_blocked)}>
                  <Ban className="mr-2 h-4 w-4" /> {conv.i_blocked ? "Unblock" : "Block"} @
                  {other.username}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {incomingRequest && (
          <div className="mb-4 rounded-2xl border border-border bg-card p-4 text-sm">
            <p>
              <span className="font-medium">{name}</span> wants to message you. They won't know
              you've seen this unless you accept or reply.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => respond(true)}>
                Accept
              </Button>
              <Button size="sm" variant="outline" onClick={() => respond(false)}>
                Decline
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBlocked(true)}>
                Block
              </Button>
            </div>
          </div>
        )}
        <ul className="space-y-2">
          {conv.messages.map((m) => (
            <li key={m.id} className={`group flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[80%]">
                <div
                  className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                    m.removed
                      ? "border border-dashed border-border italic text-muted-foreground"
                      : m.mine
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                  }`}
                >
                  {m.removed ? "This message was removed by Yooits." : m.body}
                </div>
                <div
                  className={`mt-0.5 flex gap-2 text-[11px] text-muted-foreground ${m.mine ? "justify-end" : ""}`}
                >
                  <span>
                    {new Date(m.created_at).toLocaleString([], {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                  {!m.mine && !m.removed && (
                    <button
                      type="button"
                      className="hover:text-foreground hover:underline"
                      onClick={() => setReporting(m)}
                    >
                      Report
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div ref={bottom} />
      </main>

      <footer className="sticky bottom-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          {conv.can_send ? (
            <p className="text-sm text-muted-foreground">{messageError(conv.can_send)}</p>
          ) : conv.status === "declined" && conv.i_requested ? (
            <p className="text-sm text-muted-foreground">{messageError("closed")}</p>
          ) : waiting ? (
            <p className="text-sm text-muted-foreground">
              Request sent. You can write again once they accept.
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <Textarea
                rows={2}
                maxLength={MESSAGE_MAX}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && body.trim() && !busy) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={incomingRequest ? "Reply to accept" : "Write a message"}
                aria-label="Message"
              />
              <Button disabled={busy || !body.trim()} onClick={send} aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}
          {other && (
            <div className="mt-2 text-right">
              <ReportLink username={other.username} />
            </div>
          )}
        </div>
      </footer>
      <ReportMessageDialog message={reporting} onClose={() => setReporting(null)} />
    </div>
  );
}

function ReportMessageDialog({
  message,
  onClose,
}: {
  message: Message | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReason(null);
    setDetails("");
  }, [message?.id]);

  const send = async () => {
    if (!message || !reason) return;
    setBusy(true);
    try {
      const r = await dm("dm_report_message", {
        _message_id: message.id,
        _reason: reason,
        _details: details || null,
      });
      if (r === "rate_limited")
        toast.error("You've sent several reports recently. Please try again later.");
      else {
        toast.success("Thanks. Yooits will review this message.");
        onClose();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!message} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report this message</DialogTitle>
          <DialogDescription>
            Yooits will see this message and your note. The sender isn't told who reported it. To
            stop hearing from them, block them too.
          </DialogDescription>
        </DialogHeader>
        {message?.body && (
          <blockquote className="max-h-32 overflow-auto rounded-lg border border-border p-2 text-sm">
            {message.body}
          </blockquote>
        )}
        <div className="grid gap-2">
          {REPORT_REASONS.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="dm-reason"
                checked={reason === r.id}
                onChange={() => setReason(r.id)}
              />
              {r.label}
            </label>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="dm-report-details">Anything else (optional)</Label>
          <Textarea
            id="dm-report-details"
            rows={3}
            maxLength={REPORT_DETAILS_MAX}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!reason || busy} onClick={send}>
            <Flag className="mr-2 h-4 w-4" /> Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
