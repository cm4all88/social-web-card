/**
 * Owner Mail operations on the owner's Gmail mailbox. Server only. Gmail is
 * the only copy of the mail: every read and change goes straight to Gmail,
 * so the Owner Console and Gmail always show the same messages, labels and
 * read state.
 */
import { audit, gmail, gmailSendRaw } from "./google.server";
import {
  buildMessage,
  b64urlToBytes,
  forwardBlock,
  forwardSubject,
  header,
  htmlToText,
  isEmail,
  parseAddressList,
  parsePayload,
  quoteForReply,
  replySubject,
  searchQuery,
  type Address,
  type GmailPart,
  type OutgoingAttachment,
} from "./mime";
import { sanitizeEmailHtml } from "./sanitize";
import { textToHtml } from "./view";

export type Label = {
  id: string;
  name: string;
  type: "system" | "user";
  unread?: number;
};

export type ThreadSummary = {
  id: string;
  subject: string;
  from: string;
  to: string;
  snippet: string;
  date: number;
  unread: boolean;
  starred: boolean;
  count: number;
  labelIds: string[];
};

export type MailMessage = {
  id: string;
  from: string;
  to: string;
  cc: string;
  replyTo: string;
  date: number;
  subject: string;
  html: string;
  blockedImages: number;
  unread: boolean;
  labelIds: string[];
  attachments: { partId: string; filename: string; mimeType: string; size: number }[];
};

export type SendAs = { email: string; name: string; isDefault: boolean; isPrimary: boolean };

type RawMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

const LABEL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SYSTEM_SHOWN = ["INBOX", "STARRED", "SENT", "DRAFT", "IMPORTANT", "SPAM", "TRASH"];
const SYSTEM_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  STARRED: "Starred",
  SENT: "Sent",
  DRAFT: "Drafts",
  IMPORTANT: "Important",
  SPAM: "Spam",
  TRASH: "Trash",
};

/** Runs fn over items, a few at a time (Gmail limits calls per second). */
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const n = i++;
        out[n] = await fn(items[n]);
      }
    }),
  );
  return out;
}

export async function sendAsList(owner: string): Promise<SendAs[]> {
  const r = await gmail<{
    sendAs?: {
      sendAsEmail: string;
      displayName?: string;
      isDefault?: boolean;
      isPrimary?: boolean;
      verificationStatus?: string;
    }[];
  }>(owner, "settings/sendAs");
  return (r.sendAs ?? [])
    .filter((s) => s.isPrimary || !s.verificationStatus || s.verificationStatus === "accepted")
    .map((s) => ({
      email: s.sendAsEmail.toLowerCase(),
      name: s.displayName ?? "",
      isDefault: !!s.isDefault,
      isPrimary: !!s.isPrimary,
    }));
}

export async function listLabels(owner: string): Promise<Label[]> {
  const r = await gmail<{ labels?: { id: string; name: string; type: string }[] }>(owner, "labels");
  const all = r.labels ?? [];
  const inbox = await gmail<{ messagesUnread?: number; threadsUnread?: number }>(
    owner,
    "labels/INBOX",
  ).catch(() => null);
  const system = SYSTEM_SHOWN.filter((id) => all.some((l) => l.id === id)).map<Label>((id) => ({
    id,
    name: SYSTEM_NAMES[id],
    type: "system",
    ...(id === "INBOX" && inbox
      ? { unread: inbox.threadsUnread ?? inbox.messagesUnread ?? 0 }
      : {}),
  }));
  const user = all
    .filter((l) => l.type === "user")
    .map<Label>((l) => ({ id: l.id, name: l.name, type: "user" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...system, ...user];
}

export async function createLabel(owner: string, name: string): Promise<Label> {
  const clean = name
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 100);
  if (!clean) throw new Error("Give the label a name.");
  const r = await gmail<{ id: string; name: string }>(owner, "labels", {
    method: "POST",
    body: JSON.stringify({
      name: clean,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  return { id: r.id, name: r.name, type: "user" };
}

export async function listThreads(
  owner: string,
  opts: { label?: string | null; q?: string | null; pageToken?: string | null },
): Promise<{ threads: ThreadSummary[]; nextPageToken: string | null; estimate: number }> {
  const params = new URLSearchParams({ maxResults: "20" });
  const label = opts.label && LABEL_ID.test(opts.label) ? opts.label : null;
  if (label) params.append("labelIds", label);
  const q = searchQuery(opts.q);
  if (q) params.set("q", q);
  if (opts.pageToken && /^[\w-]{1,200}$/.test(opts.pageToken))
    params.set("pageToken", opts.pageToken);
  if (label === "SPAM" || label === "TRASH") params.set("includeSpamTrash", "true");
  const list = await gmail<{
    threads?: { id: string; snippet?: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(owner, `threads?${params.toString()}`);
  const meta =
    "format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date";
  const threads = await pool(list.threads ?? [], 6, async (t) => {
    const full = await gmail<{ id: string; messages?: RawMessage[] }>(
      owner,
      `threads/${t.id}?${meta}`,
    );
    const msgs = full.messages ?? [];
    const last = msgs[msgs.length - 1];
    const first = msgs[0];
    const labels = new Set(msgs.flatMap((m) => m.labelIds ?? []));
    return {
      id: t.id,
      subject: header(first?.payload?.headers, "Subject") || "(no subject)",
      from: header(last?.payload?.headers, "From"),
      to: header(last?.payload?.headers, "To"),
      snippet: last?.snippet ?? t.snippet ?? "",
      date: Number(last?.internalDate ?? 0),
      unread: msgs.some((m) => m.labelIds?.includes("UNREAD")),
      starred: labels.has("STARRED"),
      count: msgs.length,
      labelIds: [...labels],
    } satisfies ThreadSummary;
  });
  return {
    threads,
    nextPageToken: list.nextPageToken ?? null,
    estimate: list.resultSizeEstimate ?? 0,
  };
}

const INLINE_LIMIT = 1_500_000;

/** One conversation, cleaned for display. Opening it marks it read in Gmail. */
export async function getThread(owner: string, id: string, showImages: boolean, markRead = true) {
  if (!LABEL_ID.test(id)) throw new Error("Unknown conversation.");
  const t = await gmail<{ id: string; messages?: RawMessage[] }>(
    owner,
    `threads/${id}?format=full`,
  );
  const msgs = t.messages ?? [];
  const messages: MailMessage[] = [];
  for (const m of msgs) {
    const parsed = parsePayload(m.payload);
    const h = m.payload?.headers;
    // Inline pictures that are part of the message itself (cid:), up to a size cap.
    const inline: Record<string, string> = {};
    let used = 0;
    if (parsed.html) {
      for (const a of parsed.attachments.filter(
        (x) => x.inline && x.contentId && /^image\//.test(x.mimeType),
      )) {
        if (used + a.size > INLINE_LIMIT) break;
        const d = await gmail<{ data?: string }>(
          owner,
          `messages/${m.id}/attachments/${a.attachmentId}`,
        ).catch(() => null);
        if (!d?.data) continue;
        used += a.size;
        inline[a.contentId!] =
          `data:${a.mimeType};base64,${Buffer.from(b64urlToBytes(d.data)).toString("base64")}`;
      }
    }
    const clean = parsed.html
      ? sanitizeEmailHtml(parsed.html, { showRemoteImages: showImages, inline })
      : { html: textToHtml(parsed.text ?? m.snippet ?? ""), blockedImages: 0 };
    messages.push({
      id: m.id,
      from: header(h, "From"),
      to: header(h, "To"),
      cc: header(h, "Cc"),
      replyTo: header(h, "Reply-To"),
      date: Number(m.internalDate ?? 0),
      subject: header(h, "Subject"),
      html: clean.html,
      blockedImages: clean.blockedImages,
      unread: !!m.labelIds?.includes("UNREAD"),
      labelIds: m.labelIds ?? [],
      attachments: partsWithFiles(m.payload)
        .filter((p) => !(p.inline && parsed.html))
        .map((p) => ({
          partId: p.partId,
          filename: p.filename,
          mimeType: p.mimeType,
          size: p.size,
        })),
    });
  }
  const unread = msgs.some((m) => m.labelIds?.includes("UNREAD"));
  if (markRead && unread) {
    await gmail(owner, `threads/${id}/modify`, {
      method: "POST",
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    });
  }
  const labels = new Set(msgs.flatMap((m) => m.labelIds ?? []));
  if (markRead) labels.delete("UNREAD");
  return {
    id,
    subject: messages[0]?.subject || "(no subject)",
    labelIds: [...labels],
    messages,
  };
}

/** Parts that carry a file, with their stable part id (Gmail attachment ids change between reads). */
function partsWithFiles(payload: GmailPart | undefined) {
  const out: {
    partId: string;
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
    inline: boolean;
  }[] = [];
  const walk = (p: GmailPart) => {
    if (p.body?.attachmentId && p.partId) {
      const disposition = header(p.headers, "Content-Disposition").toLowerCase();
      const cid = header(p.headers, "Content-ID");
      out.push({
        partId: p.partId,
        filename: p.filename || "attachment",
        mimeType: p.mimeType || "application/octet-stream",
        size: p.body.size ?? 0,
        attachmentId: p.body.attachmentId,
        inline: !!cid && !disposition.startsWith("attachment"),
      });
    }
    for (const c of p.parts ?? []) walk(c);
  };
  if (payload) walk(payload);
  return out;
}

export async function getAttachment(owner: string, messageId: string, partId: string) {
  if (!LABEL_ID.test(messageId) || !/^[\d.]{1,40}$/.test(partId)) throw new Error("Unknown file.");
  const m = await gmail<RawMessage>(owner, `messages/${messageId}?format=full`);
  const part = partsWithFiles(m.payload).find((p) => p.partId === partId);
  if (!part) throw new Error("That file isn't on the message any more.");
  const d = await gmail<{ data?: string }>(
    owner,
    `messages/${messageId}/attachments/${part.attachmentId}`,
  );
  return { filename: part.filename, mimeType: part.mimeType, bytes: b64urlToBytes(d.data ?? "") };
}

/** Label changes on a whole conversation (read/unread, star, archive, move, spam). */
export async function modifyThread(owner: string, id: string, add: string[], remove: string[]) {
  if (!LABEL_ID.test(id)) throw new Error("Unknown conversation.");
  const ok = (l: string) => LABEL_ID.test(l) && l !== "SENT" && l !== "DRAFT" && l !== "TRASH";
  const addLabelIds = add.filter(ok).slice(0, 10);
  const removeLabelIds = remove.filter(ok).slice(0, 10);
  if (!addLabelIds.length && !removeLabelIds.length) return;
  await gmail(owner, `threads/${id}/modify`, {
    method: "POST",
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
}

/** Trash (Gmail empties it after 30 days) or bring back. Never deletes for good. */
export async function trashThread(owner: string, id: string, restore: boolean) {
  if (!LABEL_ID.test(id)) throw new Error("Unknown conversation.");
  await gmail(owner, `threads/${id}/${restore ? "untrash" : "trash"}`, { method: "POST" });
  if (!restore) await audit(owner, "mail.trashed", id, {});
}

/* ---------- compose, reply, forward ---------- */

export type Draft = {
  mode: "new" | "reply" | "replyAll" | "forward";
  messageId?: string | null;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachments?: { filename: string; mimeType: string; base64: string }[];
  keepAttachments?: boolean;
};

/** What the compose box starts with for a reply or forward. */
export async function prepare(
  owner: string,
  mode: "reply" | "replyAll" | "forward",
  messageId: string,
  me: string[],
) {
  if (!LABEL_ID.test(messageId)) throw new Error("Unknown message.");
  const m = await gmail<RawMessage>(owner, `messages/${messageId}?format=full`);
  const h = m.payload?.headers;
  const from = header(h, "From");
  const subject = header(h, "Subject");
  const date = new Date(Number(m.internalDate ?? 0)).toUTCString();
  const parsed = parsePayload(m.payload);
  const text = parsed.text ?? (parsed.html ? htmlToText(parsed.html) : (m.snippet ?? ""));
  const mine = new Set(me.map((e) => e.toLowerCase()));
  const sentByMe = parseAddressList(from).some((a) => mine.has(a.email.toLowerCase()));
  const fmt = (list: Address[]) =>
    list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ");
  if (mode === "forward") {
    return {
      to: "",
      cc: "",
      subject: forwardSubject(subject),
      body: forwardBlock({ from, date, subject, to: header(h, "To"), text }),
      files: partsWithFiles(m.payload)
        .filter((p) => !p.inline)
        .map((p) => ({ filename: p.filename, size: p.size })),
    };
  }
  const replyTarget = sentByMe
    ? parseAddressList(header(h, "To"))
    : parseAddressList(header(h, "Reply-To") || from);
  let cc: Address[] = [];
  if (mode === "replyAll") {
    const seen = new Set([...mine, ...replyTarget.map((a) => a.email.toLowerCase())]);
    cc = [...parseAddressList(header(h, "To")), ...parseAddressList(header(h, "Cc"))].filter(
      (a) => {
        const k = a.email.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      },
    );
  }
  return {
    to: fmt(replyTarget),
    cc: fmt(cc),
    subject: replySubject(subject),
    body: quoteForReply(text, from, date),
    files: [] as { filename: string; size: number }[],
  };
}

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_FORWARD_BYTES = 20 * 1024 * 1024;

export async function send(owner: string, d: Draft, sendAs: SendAs[]) {
  const fromAlias = sendAs.find((s) => s.email === d.from.trim().toLowerCase());
  if (!fromAlias) throw new Error("Pick a From address that this Gmail account can send as.");
  const to = parseAddressList(d.to);
  const cc = parseAddressList(d.cc ?? "");
  const bcc = parseAddressList(d.bcc ?? "");
  const bad = [d.to, d.cc ?? "", d.bcc ?? ""]
    .flatMap((v) => v.split(/[,;]/))
    .map((s) => s.trim())
    .filter((s) => s && !isEmail(s.replace(/^.*<([^>]+)>\s*$/, "$1").trim()));
  if (bad.length) throw new Error(`Check these addresses: ${bad.slice(0, 3).join(", ")}`);
  if (to.length + cc.length + bcc.length === 0) throw new Error("Add at least one recipient.");
  if (to.length + cc.length + bcc.length > 50) throw new Error("Up to 50 recipients at a time.");

  const files: OutgoingAttachment[] = [];
  let uploaded = 0;
  for (const f of d.attachments ?? []) {
    const bytes = Uint8Array.from(Buffer.from(f.base64, "base64"));
    uploaded += bytes.length;
    files.push({
      filename: f.filename,
      mimeType: f.mimeType || "application/octet-stream",
      data: bytes,
    });
  }
  if (uploaded > MAX_UPLOAD_BYTES)
    throw new Error("Attached files can be up to 3 MB in total here.");

  let threadId: string | null = null;
  let inReplyTo: string | null = null;
  let references: string | null = null;
  if (d.mode !== "new") {
    if (!d.messageId || !LABEL_ID.test(d.messageId)) throw new Error("Unknown message.");
    const src = await gmail<RawMessage>(owner, `messages/${d.messageId}?format=full`);
    if (d.mode !== "forward") {
      threadId = src.threadId;
      const mid =
        header(src.payload?.headers, "Message-ID") || header(src.payload?.headers, "Message-Id");
      if (mid) {
        inReplyTo = mid;
        references = [header(src.payload?.headers, "References"), mid]
          .filter(Boolean)
          .join(" ")
          .slice(-1900);
      }
    } else if (d.keepAttachments) {
      let total = 0;
      for (const p of partsWithFiles(src.payload).filter((x) => !x.inline)) {
        total += p.size;
        if (total > MAX_FORWARD_BYTES)
          throw new Error(
            "The original files are too big to forward from here. Forward it in Gmail.",
          );
        const a = await gmail<{ data?: string }>(
          owner,
          `messages/${src.id}/attachments/${p.attachmentId}`,
        );
        files.push({
          filename: p.filename,
          mimeType: p.mimeType,
          data: b64urlToBytes(a.data ?? ""),
        });
      }
    }
  }

  const raw = buildMessage({
    from: { name: fromAlias.name, email: fromAlias.email },
    to,
    cc,
    bcc,
    subject: d.subject.slice(0, 300),
    text: d.body,
    inReplyTo,
    references,
    attachments: files,
  });
  const sent = await gmailSendRaw(owner, raw, threadId);
  await audit(owner, "mail.sent", sent.id, {
    mode: d.mode,
    from: fromAlias.email,
    recipients: to.length + cc.length + bcc.length,
    files: files.length,
  });
  return { id: sent.id, threadId: sent.threadId };
}
