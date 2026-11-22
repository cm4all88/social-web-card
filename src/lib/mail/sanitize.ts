/**
 * Cleans an email's HTML before the Owner Console shows it. Server only.
 * Scripts, forms, frames, event handlers and javascript: links are removed.
 * Remote images are held back unless the owner asks for them (they can tell
 * the sender the mail was opened). The browser then shows the result in a
 * sandboxed frame with no scripts (see frameDocument in ./view).
 */
import sanitizeHtml from "sanitize-html";

export type SanitizeOptions = {
  showRemoteImages: boolean;
  /** cid -> data: URL for inline images that are part of the message. */
  inline?: Record<string, string>;
};

export function sanitizeEmailHtml(
  html: string,
  opts: SanitizeOptions,
): { html: string; blockedImages: number } {
  let blocked = 0;
  const inline = opts.inline ?? {};
  const clean = sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "style",
      "center",
      "font",
      "span",
      "div",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "caption",
      "colgroup",
      "col",
      "hr",
      "br",
      "u",
      "s",
      "small",
      "big",
    ],
    disallowedTagsMode: "discard",
    nonTextTags: [
      "script",
      "textarea",
      "option",
      "noscript",
      "title",
      "head",
      "iframe",
      "object",
      "embed",
    ],
    allowVulnerableTags: true, // <style>: only ever shown in a sandboxed frame without scripts
    allowedAttributes: {
      "*": [
        "style",
        "class",
        "align",
        "valign",
        "width",
        "height",
        "bgcolor",
        "color",
        "dir",
        "lang",
        "title",
      ],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "data-blocked-src"],
      font: ["face", "size", "color"],
      table: ["border", "cellpadding", "cellspacing", "role"],
      td: ["colspan", "rowspan", "nowrap"],
      th: ["colspan", "rowspan", "nowrap", "scope"],
      col: ["span"],
      colgroup: ["span"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
      }),
      img: (tagName, attribs) => {
        const src = (attribs.src ?? "").trim();
        const next = { ...attribs };
        if (/^cid:/i.test(src)) {
          const id = src.slice(4).replace(/^<|>$/g, "");
          if (inline[id]) next.src = inline[id];
          else delete next.src;
        } else if (/^data:image\/(png|jpe?g|gif|webp);/i.test(src)) {
          // part of the message itself
        } else if (/^https?:/i.test(src)) {
          if (!opts.showRemoteImages) {
            blocked += 1;
            next["data-blocked-src"] = src;
            delete next.src;
          }
        } else {
          delete next.src;
        }
        return { tagName, attribs: next };
      },
    },
  });
  return { html: clean, blockedImages: blocked };
}
