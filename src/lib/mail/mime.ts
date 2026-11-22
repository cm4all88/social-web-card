/**
 * Plain helpers for Owner Mail: reading Gmail's message format and building
 * the RFC 5322 messages Gmail sends. No network, no secrets; used by the
 * server code and tested on their own.
 */

/* ---------- base64url ---------- */

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Uint8Array.from(Buffer.from(b64 + pad, "base64"));
}

export function b64urlToText(s: string): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(b64urlToBytes(s));
}

export function bytesToB64url(b: Uint8Array | Buffer): string {
  return Buffer.from(b)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ---------- Gmail message parts ---------- */

export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};

export type ParsedAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
};

export type ParsedBody = {
  html: string | null;
  text: string | null;
  attachments: ParsedAttachment[];
};

export function header(headers: GmailHeader[] | undefined, name: string): string {
  const n = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
}

/** Walks a Gmail payload: the best HTML and plain-text bodies, and every attachment. */
export function parsePayload(payload: GmailPart | undefined): ParsedBody {
  const out: ParsedBody = { html: null, text: null, attachments: [] };
  if (!payload) return out;
  const walk = (p: GmailPart) => {
    const type = (p.mimeType ?? "").toLowerCase();
    const disposition = header(p.headers, "Content-Disposition").toLowerCase();
    const cid = header(p.headers, "Content-ID").replace(/^<|>$/g, "").trim() || null;
    if (p.body?.attachmentId) {
      out.attachments.push({
        attachmentId: p.body.attachmentId,
        filename: p.filename || (cid ? `${cid}` : "attachment"),
        mimeType: type || "application/octet-stream",
        size: p.body.size ?? 0,
        contentId: cid,
        inline: !!cid && !disposition.startsWith("attachment"),
      });
    } else if (p.body?.data && !disposition.startsWith("attachment")) {
      if (type === "text/html" && out.html === null) out.html = b64urlToText(p.body.data);
      else if (type === "text/plain" && out.text === null) out.text = b64urlToText(p.body.data);
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  return out;
}

/* ---------- addresses ---------- */

export type Address = { name: string; email: string };

const EMAIL_RE = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

export function isEmail(s: string): boolean {
  return s.length <= 254 && EMAIL_RE.test(s);
}

/** Splits an address header ("A <a@x.com>, b@y.com") into addresses. */
export function parseAddressList(value: string): Address[] {
  const out: Address[] = [];
  let buf = "";
  let quoted = false;
  let angle = false;
  const flush = () => {
    const s = buf.trim();
    buf = "";
    if (!s) return;
    const m = s.match(/^(.*)<([^>]+)>\s*$/);
    if (m) {
      const email = m[2].trim();
      const name = m[1].trim().replace(/^"|"$/g, "").replace(/\\"/g, '"');
      if (isEmail(email)) out.push({ name, email });
    } else if (isEmail(s)) out.push({ name: "", email: s });
  };
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "<") angle = true;
    if (!quoted && ch === ">") angle = false;
    if ((ch === "," || ch === ";") && !quoted && !angle) flush();
    else buf += ch;
  }
  flush();
  return out;
}

export function formatAddress(a: Address): string {
  const name = sanitizeHeader(a.name);
  if (!name) return a.email;
  const plain = /^[\x20-\x7e]*$/.test(name);
  if (!plain) return `${encodeWord(name)} <${a.email}>`;
  return `"${name.replace(/(["\\])/g, "\\$1")}" <${a.email}>`;
}

/* ---------- headers ---------- */

/** No line breaks or control characters in a header value (no header injection). */
export function sanitizeHeader(v: string): string {
  return (
    v
      .replace(/[\r\n\0]+/g, " ")
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
      .trim()
  );
}

function encodeWord(s: string): string {
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

export function encodeSubject(s: string): string {
  const v = sanitizeHeader(s);
  return /^[\x20-\x7e]*$/.test(v) ? v : encodeWord(v);
}

/** "Re: " once, "Fwd: " once. */
export function replySubject(subject: string): string {
  return /^\s*re:/i.test(subject) ? subject : `Re: ${subject}`;
}
export function forwardSubject(subject: string): string {
  return /^\s*(fwd?|fw):/i.test(subject) ? subject : `Fwd: ${subject}`;
}

/* ---------- building a message ---------- */

export type OutgoingAttachment = { filename: string; mimeType: string; data: Uint8Array };

export type Outgoing = {
  from: Address;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  text: string;
  html?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: OutgoingAttachment[];
  /** For tests: fixed boundary and date. */
  boundarySeed?: string;
  date?: Date;
};

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").replace(/\r\n$/, "");
}

function quotedFilename(name: string): string {
  const clean =
    sanitizeHeader(name)
      .replace(/["\\/]/g, "_")
      .slice(0, 180) || "attachment";
  if (/^[\x20-\x7e]*$/.test(clean)) return `filename="${clean}"`;
  return `filename*=UTF-8''${encodeURIComponent(clean)}`;
}

function textPart(type: "plain" | "html", body: string): string {
  return [
    `Content-Type: text/${type}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64")),
  ].join("\r\n");
}

/** Builds the whole message as text with CRLF line ends. */
export function buildMessage(m: Outgoing): string {
  if (!isEmail(m.from.email)) throw new Error("The From address isn't valid.");
  const all = [...m.to, ...(m.cc ?? []), ...(m.bcc ?? [])];
  if (all.length === 0) throw new Error("Add at least one recipient.");
  for (const a of all) if (!isEmail(a.email)) throw new Error(`${a.email} isn't a valid address.`);
  const seed = m.boundarySeed ?? crypto.randomUUID().replace(/-/g, "");
  const headers = [
    `From: ${formatAddress(m.from)}`,
    `To: ${m.to.map(formatAddress).join(", ")}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.map(formatAddress).join(", ")}`] : []),
    ...(m.bcc?.length ? [`Bcc: ${m.bcc.map(formatAddress).join(", ")}`] : []),
    `Subject: ${encodeSubject(m.subject)}`,
    `Date: ${(m.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    "MIME-Version: 1.0",
    ...(m.inReplyTo ? [`In-Reply-To: ${sanitizeHeader(m.inReplyTo)}`] : []),
    ...(m.references ? [`References: ${sanitizeHeader(m.references)}`] : []),
  ];
  const alt = `alt_${seed}`;
  const bodyPart = m.html
    ? [
        `Content-Type: multipart/alternative; boundary="${alt}"`,
        "",
        `--${alt}`,
        textPart("plain", m.text),
        `--${alt}`,
        textPart("html", m.html),
        `--${alt}--`,
      ].join("\r\n")
    : textPart("plain", m.text);

  const files = m.attachments ?? [];
  if (files.length === 0) return [...headers, bodyPart].join("\r\n");
  const mixed = `mix_${seed}`;
  const parts = [`Content-Type: multipart/mixed; boundary="${mixed}"`, "", `--${mixed}`, bodyPart];
  for (const f of files) {
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(f.mimeType) ? f.mimeType : "application/octet-stream";
    parts.push(
      `--${mixed}`,
      [
        `Content-Type: ${type}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; ${quotedFilename(f.filename)}`,
        "",
        wrap76(Buffer.from(f.data).toString("base64")),
      ].join("\r\n"),
    );
  }
  parts.push(`--${mixed}--`);
  return [...headers, parts.join("\r\n")].join("\r\n");
}

/* ---------- quoting ---------- */

export function quoteForReply(text: string, from: string, date: string): string {
  const quoted = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `\n\nOn ${date}, ${from} wrote:\n${quoted}`;
}

export function forwardBlock(o: {
  from: string;
  date: string;
  subject: string;
  to: string;
  text: string;
}): string {
  return [
    "",
    "",
    "---------- Forwarded message ---------",
    `From: ${o.from}`,
    `Date: ${o.date}`,
    `Subject: ${o.subject}`,
    `To: ${o.to}`,
    "",
    o.text,
  ].join("\n");
}

/** Rough plain text from HTML, for quoting when a message has no text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Gmail search text from the search box: kept as typed, length-capped. */
export function searchQuery(q: string | undefined | null): string {
  return (q ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 500);
}
