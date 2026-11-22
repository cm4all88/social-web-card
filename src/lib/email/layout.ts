/**
 * One responsive HTML layout for every Yooits email, plus its plain-text
 * twin. Table-based with inline styles so it holds up in Gmail, Outlook
 * (desktop and web), Apple Mail/iCloud and phone apps.
 */
import { BRAND, SITE_URL } from "./brand";

export type Block =
  | { kind: "p"; text: string }
  | { kind: "details"; rows: [string, string][] }
  | { kind: "quote"; text: string; by?: string }
  | { kind: "callout"; text: string }
  | { kind: "small"; text: string }
  | { kind: "code"; text: string };

export type EmailContent = {
  subject: string;
  /** The grey line inboxes show after the subject. */
  preheader: string;
  heading: string;
  blocks: Block[];
  button?: { label: string; url: string };
  /** After the button, e.g. a fallback link or "If this wasn't you". */
  after?: Block[];
};

export type FooterContext = {
  /** Why they got it, e.g. "You're getting this because you have a Yooits account." */
  reason: string;
  /** Present for optional email: one-click unsubscribe from this kind. */
  unsubscribeUrl?: string;
  preferencesUrl?: string;
  /** Marketing only. */
  mailingAddress?: string | null;
};

const C = BRAND.colors;

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes, then turns **bold** into <strong>. Nothing else is interpreted. */
function inline(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.ink};">$1</strong>`);
}
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

/**
 * Only http(s) and mailto links ever go into an href. The one exception is a
 * bare Supabase template placeholder such as {{ .ConfirmationURL }}, which
 * Supabase fills in with its own link when it sends the auth email.
 */
export function safeHref(url: string): string {
  if (/^\{\{ \.[A-Za-z]+ \}\}$/.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:")
      return u.toString();
  } catch {
    /* fall through */
  }
  return SITE_URL;
}

const P = `margin:0 0 16px;font-family:${BRAND.font};font-size:16px;line-height:24px;color:${C.ink};`;

function blockHtml(b: Block): string {
  switch (b.kind) {
    case "p":
      return `<p style="${P}">${inline(b.text)}</p>`;
    case "small":
      return `<p style="margin:0 0 12px;font-family:${BRAND.font};font-size:13px;line-height:20px;color:${C.inkMuted};">${inline(b.text)}</p>`;
    case "callout":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr><td style="background:#fbeefe;border-left:4px solid ${C.primary};border-radius:8px;padding:12px 16px;font-family:${BRAND.font};font-size:14px;line-height:21px;color:${C.ink};">${inline(b.text)}</td></tr></table>`;
    case "quote":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr><td style="border-left:3px solid ${C.rule};padding:4px 0 4px 14px;font-family:${BRAND.font};font-size:15px;line-height:22px;color:${C.ink};font-style:italic;">${esc(b.text)}${b.by ? `<br><span style="font-style:normal;font-size:13px;color:${C.inkMuted};">${esc(b.by)}</span>` : ""}</td></tr></table>`;
    case "code":
      return `<p style="margin:0 0 16px;font-family:Menlo,Consolas,monospace;font-size:24px;letter-spacing:4px;font-weight:700;color:${C.ink};text-align:center;">${esc(b.text)}</p>`;
    case "details":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border:1px solid ${C.rule};border-radius:12px;border-collapse:separate;">${b.rows
        .map(
          ([k, v], i) =>
            `<tr><td style="padding:10px 14px;${i ? `border-top:1px solid ${C.rule};` : ""}font-family:${BRAND.font};font-size:14px;line-height:20px;color:${C.inkMuted};width:40%;vertical-align:top;">${esc(k)}</td><td style="padding:10px 14px;${i ? `border-top:1px solid ${C.rule};` : ""}font-family:${BRAND.font};font-size:14px;line-height:20px;color:${C.ink};font-weight:600;vertical-align:top;">${esc(v)}</td></tr>`,
        )
        .join("")}</table>`;
  }
}

function blockText(b: Block): string {
  switch (b.kind) {
    case "details":
      return b.rows.map(([k, v]) => `${k}: ${v}`).join("\n");
    case "quote":
      return `"${b.text}"${b.by ? `\n  ${b.by}` : ""}`;
    default:
      return plain(b.text);
  }
}

function button(label: string, url: string): string {
  const href = esc(safeHref(url));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td align="center" bgcolor="${C.primary}" style="border-radius:12px;background:${C.primary};">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="25%" stroke="f" fillcolor="${C.primary}"><center style="color:${C.primaryForeground};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${esc(label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${BRAND.font};font-size:16px;line-height:20px;font-weight:700;color:${C.primaryForeground};text-decoration:none;border-radius:12px;">${esc(label)}</a><!--<![endif]-->
</td></tr></table>`;
}

const link = (label: string, url: string) =>
  `<a href="${esc(safeHref(url))}" style="color:${C.mutedForeground};text-decoration:underline;">${esc(label)}</a>`;

export function renderHtml(content: EmailContent, footer: FooterContext): string {
  const year = new Date().getUTCFullYear();
  const footerLinks = [
    link("Terms", `${SITE_URL}/legal/terms`),
    link("Privacy", `${SITE_URL}/legal/privacy`),
    footer.preferencesUrl ? link("Email preferences", footer.preferencesUrl) : null,
    footer.unsubscribeUrl ? link("Unsubscribe", footer.unsubscribeUrl) : null,
  ]
    .filter(Boolean)
    .join(` <span style="color:${C.mutedForeground};">&middot;</span> `);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(content.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${C.accent}; }
  @media only screen and (max-width:620px) {
    .yo-shell { width:100% !important; }
    .yo-card { padding:24px 20px !important; border-radius:0 !important; }
    .yo-pad { padding-left:16px !important; padding-right:16px !important; }
    h1.yo-h1 { font-size:22px !important; line-height:28px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.background};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.background};">${esc(content.preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.background}" style="background:${C.background};">
<tr><td align="center" style="padding:24px 0 40px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="yo-shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td align="center" class="yo-pad" style="padding:8px 24px 20px;">
  <a href="${SITE_URL}" target="_blank" style="text-decoration:none;"><img src="${BRAND.logoUrl}" width="${BRAND.logoWidth}" height="${BRAND.logoHeight}" alt="Yooits" style="display:block;width:${BRAND.logoWidth}px;height:auto;border:0;"></a>
</td></tr>
<tr><td style="padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="background:${C.paper};border-radius:16px;border-collapse:separate;overflow:hidden;">
  <tr><td height="6" bgcolor="${C.accent}" style="height:6px;line-height:6px;font-size:6px;background:${C.accent};background-image:linear-gradient(135deg, ${C.gradientFrom} 0%, ${C.gradientVia} 50%, ${C.gradientTo} 100%);">&nbsp;</td></tr>
  <tr><td class="yo-card" style="padding:36px 40px 28px;">
    <h1 class="yo-h1" style="margin:0 0 20px;font-family:${BRAND.font};font-size:26px;line-height:32px;font-weight:800;color:${C.ink};">${esc(content.heading)}</h1>
    ${content.blocks.map(blockHtml).join("\n    ")}
    ${content.button ? button(content.button.label, content.button.url) : ""}
    ${(content.after ?? []).map(blockHtml).join("\n    ")}
  </td></tr>
  </table>
</td></tr>
<tr><td align="center" class="yo-pad" style="padding:24px 32px 0;font-family:${BRAND.font};font-size:12px;line-height:18px;color:${C.mutedForeground};">
  <p style="margin:0 0 8px;">${esc(footer.reason)}</p>
  <p style="margin:0 0 8px;">${footerLinks}</p>
  <p style="margin:0 0 8px;">&copy; ${year} ${esc(BRAND.name)} &middot; ${esc(BRAND.site)} is operated by ${esc(BRAND.operator)}, Washington, USA.${footer.mailingAddress ? `<br>${esc(footer.mailingAddress)}` : ""}</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

export function renderText(content: EmailContent, footer: FooterContext): string {
  const parts = [
    content.heading,
    "",
    ...content.blocks.map(blockText).flatMap((t) => [t, ""]),
    ...(content.button ? [`${content.button.label}: ${safeHref(content.button.url)}`, ""] : []),
    ...(content.after ?? []).map(blockText).flatMap((t) => [t, ""]),
    "--",
    footer.reason,
    ...(footer.preferencesUrl ? [`Email preferences: ${footer.preferencesUrl}`] : []),
    ...(footer.unsubscribeUrl ? [`Unsubscribe: ${footer.unsubscribeUrl}`] : []),
    `${BRAND.name} (${BRAND.site}) is operated by ${BRAND.operator}, Washington, USA.`,
    ...(footer.mailingAddress ? [footer.mailingAddress] : []),
  ];
  return (
    parts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}
