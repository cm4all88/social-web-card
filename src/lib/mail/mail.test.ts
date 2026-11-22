import { describe, expect, it } from "vitest";
import {
  b64urlToText,
  buildMessage,
  bytesToB64url,
  forwardSubject,
  parseAddressList,
  parsePayload,
  quoteForReply,
  replySubject,
  sanitizeHeader,
} from "./mime";
import { sanitizeEmailHtml } from "./sanitize";
import { displayName, frameDocument } from "./view";

const enc = (s: string) => bytesToB64url(Buffer.from(s, "utf8"));

describe("Gmail message parts", () => {
  it("finds html, text and files in nested parts", () => {
    const p = parsePayload({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/related",
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [
                { mimeType: "text/plain", body: { data: enc("Hi there ☕") } },
                { mimeType: "text/html", body: { data: enc("<p>Hi <img src='cid:logo1'></p>") } },
              ],
            },
            {
              partId: "0.1",
              mimeType: "image/png",
              filename: "logo.png",
              headers: [{ name: "Content-ID", value: "<logo1>" }],
              body: { attachmentId: "A1", size: 100 },
            },
          ],
        },
        {
          partId: "1",
          mimeType: "application/pdf",
          filename: "invoice.pdf",
          headers: [{ name: "Content-Disposition", value: "attachment; filename=invoice.pdf" }],
          body: { attachmentId: "A2", size: 2048 },
        },
      ],
    });
    expect(p.text).toBe("Hi there ☕");
    expect(p.html).toContain("cid:logo1");
    expect(p.attachments.map((a) => [a.filename, a.inline, a.contentId])).toEqual([
      ["logo.png", true, "logo1"],
      ["invoice.pdf", false, null],
    ]);
  });
});

describe("addresses", () => {
  it("splits names with commas inside quotes", () => {
    expect(parseAddressList('"Doe, Jane" <jane@x.com>, bob@y.org; Ann <ann@z.io>')).toEqual([
      { name: "Doe, Jane", email: "jane@x.com" },
      { name: "", email: "bob@y.org" },
      { name: "Ann", email: "ann@z.io" },
    ]);
  });
  it("drops what isn't an address", () => {
    expect(parseAddressList("not an address, <>, ok@a.co")).toEqual([
      { name: "", email: "ok@a.co" },
    ]);
  });
  it("display names", () => {
    expect(displayName('"Ana B" <ana@x.com>')).toBe("Ana B");
    expect(displayName("<ana@x.com>")).toBe("ana@x.com");
    expect(displayName("ana@x.com")).toBe("ana@x.com");
  });
});

describe("building a message", () => {
  const base = {
    from: { name: "Yooits", email: "admin@yooits.me" },
    to: [{ name: "", email: "c88mike@gmail.com" }],
    subject: "Hello",
    text: "Line one\nLine two",
    boundarySeed: "seed",
    date: new Date("2026-11-22T12:00:00Z"),
  };

  it("plain text with headers", () => {
    const m = buildMessage(base);
    expect(m).toContain('From: "Yooits" <admin@yooits.me>\r\n');
    expect(m).toContain("To: c88mike@gmail.com\r\n");
    expect(m).toContain("Subject: Hello\r\n");
    expect(m).toContain("MIME-Version: 1.0");
    const body = m.split("Content-Transfer-Encoding: base64\r\n\r\n")[1];
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString()).toBe(
      "Line one\r\nLine two",
    );
  });

  it("can't be used to add headers (no line breaks in values)", () => {
    const m = buildMessage({ ...base, subject: "Hi\r\nBcc: evil@x.com" });
    expect(m).not.toMatch(/\r\nBcc: evil/);
    expect(sanitizeHeader("a\r\nb")).toBe("a b");
  });

  it("encodes non-ASCII subjects and names", () => {
    const m = buildMessage({
      ...base,
      subject: "Café ☕",
      from: { name: "Zoë", email: "admin@yooits.me" },
    });
    expect(m).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(m).toMatch(/From: =\?UTF-8\?B\?.+\?= <admin@yooits.me>/);
  });

  it("reply headers, cc, bcc and files", () => {
    const m = buildMessage({
      ...base,
      cc: [{ name: "", email: "a@b.co" }],
      bcc: [{ name: "", email: "c@d.co" }],
      inReplyTo: "<abc@mail.gmail.com>",
      references: "<x@y> <abc@mail.gmail.com>",
      attachments: [
        { filename: 'r"e\\port.pdf', mimeType: "application/pdf", data: new Uint8Array([1, 2, 3]) },
      ],
    });
    expect(m).toContain("Cc: a@b.co\r\n");
    expect(m).toContain("Bcc: c@d.co\r\n");
    expect(m).toContain("In-Reply-To: <abc@mail.gmail.com>\r\n");
    expect(m).toContain("References: <x@y> <abc@mail.gmail.com>\r\n");
    expect(m).toContain('Content-Type: multipart/mixed; boundary="mix_seed"');
    expect(m).toContain('Content-Disposition: attachment; filename="r_e_port.pdf"');
    expect(m).toContain("AQID");
    expect(m.trimEnd().endsWith("--mix_seed--")).toBe(true);
  });

  it("refuses bad addresses and no recipients", () => {
    expect(() => buildMessage({ ...base, to: [] })).toThrow(/recipient/);
    expect(() => buildMessage({ ...base, to: [{ name: "", email: "nope" }] })).toThrow(/valid/);
  });

  it("subjects and quotes", () => {
    expect(replySubject("Hi")).toBe("Re: Hi");
    expect(replySubject("RE: Hi")).toBe("RE: Hi");
    expect(forwardSubject("Fwd: Hi")).toBe("Fwd: Hi");
    expect(forwardSubject("Hi")).toBe("Fwd: Hi");
    expect(quoteForReply("a\nb", "Ana", "Sun")).toBe("\n\nOn Sun, Ana wrote:\n> a\n> b");
  });

  it("base64url round trip", () => {
    expect(b64urlToText(enc("héllo ✓ ?>"))).toBe("héllo ✓ ?>");
  });
});

describe("cleaning email HTML", () => {
  it("removes scripts, handlers, forms, frames and javascript links", () => {
    const { html } = sanitizeEmailHtml(
      `<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>
       <iframe src="https://evil"></iframe><form action="https://evil"><input name=a></form>
       <img src="x" onerror="alert(1)"><svg><script>1</script></svg><a href="https://ok.com">ok</a>`,
      { showRemoteImages: false },
    );
    expect(html).not.toMatch(/script|onclick|onerror|javascript:|<iframe|<form|<input|<svg/i);
    expect(html).toContain(
      '<a href="https://ok.com" target="_blank" rel="noopener noreferrer nofollow">ok</a>',
    );
  });

  it("holds back remote pictures until asked", () => {
    const off = sanitizeEmailHtml(
      '<img src="https://t.example/p.gif"><img src="http://t.example/q.gif">',
      { showRemoteImages: false },
    );
    expect(off.blockedImages).toBe(2);
    expect(off.html).not.toMatch(/ src=/);
    const on = sanitizeEmailHtml('<img src="https://t.example/p.gif">', { showRemoteImages: true });
    expect(on.blockedImages).toBe(0);
    expect(on.html).toContain('src="https://t.example/p.gif"');
  });

  it("shows inline pictures from the message itself", () => {
    const { html } = sanitizeEmailHtml('<img src="cid:logo1"><img src="cid:missing">', {
      showRemoteImages: false,
      inline: { logo1: "data:image/png;base64,AAAA" },
    });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html.match(/src=/g)?.length).toBe(1);
  });

  it("the frame blocks scripts and remote loads by policy", () => {
    const doc = frameDocument("<p>x</p>", { showRemoteImages: false });
    expect(doc).toContain("default-src 'none'; img-src data:;");
    expect(frameDocument("", { showRemoteImages: true })).toContain("img-src https: data:");
  });
});
