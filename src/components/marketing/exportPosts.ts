import { createElement } from "react";
import { PostGraphic, saveBlob, sizedSvg, svgToPng } from "@/lib/marketing/graphics";
import {
  imageName,
  postsCsv,
  reviewHtml,
  zipFiles,
  type ExportPost,
  type ZipFile,
} from "@/lib/marketing/export";
import { graphicSize } from "@/lib/marketing/platforms";
import type { Post } from "./api";
import { finalCaption, hasGraphic, postLink } from "./PostPreview";

/**
 * Downloads a ZIP of the posts for review: each graphic as a PNG, review.html
 * and posts.csv. Reads only; no post is changed.
 */
export async function exportForReview(
  posts: Post[],
  slugOf: (id: string | null) => string | undefined,
  onProgress?: (done: number, total: number) => void,
) {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const sorted = [...posts].sort(
    (a, b) =>
      (a.scheduled_at ?? "9999").localeCompare(b.scheduled_at ?? "9999") ||
      a.platform.localeCompare(b.platform),
  );
  const files: ZipFile[] = [];
  const rows: ExportPost[] = [];
  for (const [i, p] of sorted.entries()) {
    const slug = slugOf(p.campaign_id);
    const row: ExportPost = {
      platform: p.platform,
      format: p.format,
      status: p.status,
      title: p.title,
      caption: finalCaption(p, slug),
      hashtags: p.hashtags,
      link: postLink(p, slug),
      script: p.script,
      scheduled_at: p.scheduled_at,
      image: null,
    };
    if (hasGraphic(p.graphic)) {
      const size = graphicSize(p.platform, p.format);
      const markup = renderToStaticMarkup(
        createElement(PostGraphic, { spec: p.graphic, size, id: `export${i}` }),
      );
      const png = await svgToPng(sizedSvg(markup, size), size);
      row.image = imageName(i, p);
      files.push({ name: `images/${row.image}`, data: new Uint8Array(await png.arrayBuffer()) });
    }
    rows.push(row);
    onProgress?.(i + 1, sorted.length);
  }
  const enc = new TextEncoder();
  const title = "Yooits posts for review";
  files.unshift(
    { name: "review.html", data: enc.encode(reviewHtml(rows, { title })) },
    { name: "posts.csv", data: enc.encode(postsCsv(rows)) },
  );
  const day = new Date().toISOString().slice(0, 10);
  saveBlob(
    new Blob([zipFiles(files)], { type: "application/zip" }),
    `yooits-posts-review-${day}.zip`,
  );
}
