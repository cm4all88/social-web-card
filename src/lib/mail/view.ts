/**
 * Browser-safe helpers for showing mail. The HTML given here has already
 * been cleaned on the server; the frame adds a second wall: no scripts, no
 * same-origin access, and a content policy that only lets remote images load
 * when the owner chose to show them.
 */

export function frameDocument(cleanHtml: string, opts: { showRemoteImages: boolean }): string {
  const img = opts.showRemoteImages ? "https: data:" : "data:";
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'`;
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="referrer" content="no-referrer">',
    "<style>html,body{margin:0;padding:0;background:#fff;color:#111;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;word-wrap:break-word}body{padding:12px}img{max-width:100%;height:auto}pre{white-space:pre-wrap}blockquote{margin:0 0 0 8px;padding-left:8px;border-left:2px solid #ccc;color:#555}</style>",
    "</head><body>",
    cleanHtml,
    "</body></html>",
  ].join("");
}

/** Plain text shown as HTML (escaped, links kept as text). */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<pre style="font:inherit;margin:0">${esc}</pre>`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Display name from a header like "Ana <ana@x.com>". */
export function displayName(from: string): string {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return m[1].trim() || m[2].trim();
  return from.trim();
}

/** Short date for the list: time today, "Nov 21" this year, else "11/21/25". */
export function listDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString())
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === n.getFullYear())
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { year: "2-digit", month: "numeric", day: "numeric" });
}

/** Total size limit for files picked in compose (the request must stay under the host's limit). */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
