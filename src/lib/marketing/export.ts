/**
 * "Export for review": every chosen post as a ZIP holding its graphic, one
 * review page (review.html) and a spreadsheet (posts.csv). Read-only: it
 * changes no post and publishes nothing. The pure parts live here so the
 * owner page and tests share them.
 */
import {
  FORMAT_LABELS,
  PLATFORMS,
  graphicSize,
  type PlatformId,
  type PostFormat,
} from "./platforms";
import { STATUS_LABELS, type PostStatus } from "./types";

export type ExportPost = {
  platform: PlatformId;
  format: PostFormat;
  status: PostStatus;
  title: string;
  /** The caption as it will be posted: link filled in, hashtags on the end. */
  caption: string;
  hashtags: string[];
  link: string;
  script: string | null;
  scheduled_at: string | null;
  /** File name of its graphic inside the ZIP, or null when it has none. */
  image: string | null;
};

// ---------------------------------------------------------------------------
// ZIP (stored, no compression: PNGs are already compressed)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipFile = { name: string; data: Uint8Array };

/** A ZIP archive of the files, stored without compression. */
export function zipFiles(files: ZipFile[], when = new Date()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const time =
    ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff;
  const date =
    (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, f.data);
    centrals.push(central);
    offset += local.length + f.data.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names, dates, CSV and the review page
// ---------------------------------------------------------------------------

/** "03-2026-11-27-instagram-black-friday", safe as a file name. */
export function imageName(i: number, p: Pick<ExportPost, "platform" | "title" | "scheduled_at">) {
  const day = p.scheduled_at ? p.scheduled_at.slice(0, 10) : "unscheduled";
  const slug = p.title
    .toLowerCase()
    .replace(/^day \d+:\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${String(i + 1).padStart(2, "0")}-${day}-${p.platform}${slug ? `-${slug}` : ""}.png`;
}

export function formatWhen(iso: string | null, timeZone?: string): string {
  if (!iso) return "Not scheduled";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });
}

/** Byte-order mark so Excel reads the CSV as UTF-8. */
const BOM = String.fromCharCode(0xfeff);

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function postsCsv(rows: ExportPost[], timeZone?: string): string {
  const head = [
    "#",
    "When",
    "Platform",
    "Format",
    "Status",
    "Title",
    "Caption",
    "Hashtags",
    "Link",
    "Video script",
    "Graphic file",
  ];
  const lines = rows.map((r, i) =>
    [
      String(i + 1),
      formatWhen(r.scheduled_at, timeZone),
      PLATFORMS[r.platform].label,
      FORMAT_LABELS[r.format] ?? r.format,
      STATUS_LABELS[r.status],
      r.title,
      r.caption,
      r.hashtags.map((t) => `#${t}`).join(" "),
      r.link,
      r.script ?? "",
      r.image ? `images/${r.image}` : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return `${BOM}${[head.join(","), ...lines].join("\r\n")}\r\n`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * One page showing every post: graphic, platform, time, status, caption,
 * hashtags, link and script. `src` gives each image's address (a path in
 * the ZIP, or an embedded data URL).
 */
export function reviewHtml(
  rows: ExportPost[],
  opts: { title: string; timeZone?: string; src?: (image: string) => string; made?: Date },
): string {
  const src = opts.src ?? ((f: string) => `images/${f}`);
  const made = (opts.made ?? new Date()).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: opts.timeZone,
  });
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const summary = [...counts]
    .map(([s, n]) => `${n} ${STATUS_LABELS[s as PostStatus].toLowerCase()}`)
    .join(", ");
  const cards = rows
    .map((r, i) => {
      const size = graphicSize(r.platform, r.format);
      const img = r.image
        ? `<img src="${esc(src(r.image))}" width="${size.w}" height="${size.h}" alt="Graphic for post ${i + 1}" loading="lazy">`
        : `<div class="noimg">No graphic</div>`;
      return `<article>
  <div class="pic">${img}</div>
  <div class="txt">
    <p class="meta"><b>#${i + 1} ${esc(PLATFORMS[r.platform].label)}</b> · ${esc(FORMAT_LABELS[r.format] ?? r.format)} · <span class="st st-${r.status}">${esc(STATUS_LABELS[r.status])}</span></p>
    <p class="when">${esc(formatWhen(r.scheduled_at, opts.timeZone))}</p>
    <h2>${esc(r.title)}</h2>
    <pre class="cap">${esc(r.caption)}</pre>
    ${r.hashtags.length ? `<p class="tags">${esc(r.hashtags.map((t) => `#${t}`).join(" "))}</p>` : ""}
    <p class="link"><a href="${esc(r.link)}">${esc(r.link)}</a></p>
    ${r.script ? `<details><summary>Video script</summary><pre>${esc(r.script)}</pre></details>` : ""}
  </div>
</article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>
:root{--bg:#f6f5fb;--card:#fff;--ink:#17122b;--muted:#6b6580;--line:#e4e1ee;--accent:#7b4ffa}
@media (prefers-color-scheme:dark){:root{--bg:#0f0c1c;--card:#1a1630;--ink:#f2f0fa;--muted:#a19bb8;--line:#2c2645;--accent:#a98bff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:24px 16px 8px;max-width:1100px;margin:0 auto}h1{margin:0 0 4px;font-size:22px}
header p{margin:0;color:var(--muted)}main{max-width:1100px;margin:0 auto;padding:8px 16px 48px;display:grid;gap:16px}
article{display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:20px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
@media (max-width:760px){article{grid-template-columns:1fr}}
.pic img{width:100%;height:auto;border-radius:10px;display:block}.noimg{aspect-ratio:1;display:grid;place-items:center;border:1px dashed var(--line);border-radius:10px;color:var(--muted)}
.meta,.when{margin:0;color:var(--muted);font-size:13px}.meta b{color:var(--ink)}h2{margin:8px 0;font-size:17px}
pre{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0 0 10px}.tags{color:var(--accent);margin:0 0 8px}
.link{margin:0 0 8px;font-size:13px;word-break:break-all}.link a{color:var(--accent)}
details{border-top:1px solid var(--line);padding-top:8px}summary{cursor:pointer;color:var(--muted)}
.st{padding:1px 8px;border-radius:99px;border:1px solid var(--line)}.st-approved,.st-scheduled{border-color:var(--accent);color:var(--accent)}
</style></head><body>
<header><h1>${esc(opts.title)}</h1><p>${rows.length} post${rows.length === 1 ? "" : "s"}${summary ? ` (${esc(summary)})` : ""}. Exported ${esc(made)}. Nothing here has been posted.</p></header>
<main>
${cards}
</main></body></html>`;
}
