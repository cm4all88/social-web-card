import { PLATFORMS, FORMAT_LABELS, graphicSize } from "@/lib/marketing/platforms";
import { PostGraphic } from "@/lib/marketing/graphics";
import { campaignLink, countedLength, displayLink, fillCaption } from "@/lib/marketing/links";
import type { GraphicSpec } from "@/lib/marketing/types";
import type { Post } from "./api";

export function postLink(
  p: Pick<Post, "platform" | "code" | "landing_path">,
  slug: string | null | undefined,
) {
  return campaignLink({
    platform: p.platform,
    campaign: slug || "organic",
    code: p.code,
    landing: p.landing_path,
  });
}

/** The caption as it will be posted: link filled in, hashtags on the end. */
export function finalCaption(
  p: Pick<Post, "platform" | "caption" | "hashtags" | "code" | "landing_path">,
  slug: string | null | undefined,
) {
  const link = postLink(p, slug);
  const text = fillCaption(p.caption, p.platform === "x" ? link : displayLink(link));
  const tags = p.hashtags.length
    ? `${p.platform === "x" ? " " : "\n\n"}${p.hashtags.map((t) => `#${t}`).join(" ")}`
    : "";
  return `${text}${tags}`;
}

export function hasGraphic(g: Post["graphic"]): g is GraphicSpec {
  return (
    !!g && typeof (g as GraphicSpec).headline === "string" && (g as GraphicSpec).headline.length > 0
  );
}

/** A phone-ish preview: platform, graphic at its real proportions, caption with the fold marked. */
export function PostPreview({
  post,
  slug,
  graphicId,
}: {
  post: Post;
  slug: string | null | undefined;
  graphicId?: string;
}) {
  const spec = PLATFORMS[post.platform];
  const size = graphicSize(post.platform, post.format);
  const text = finalCaption(post, slug);
  const used = countedLength(post.platform, text);
  const over = used > spec.captionMax;
  const above = [...text].slice(0, spec.foldAt).join("");
  const below = [...text].slice(spec.foldAt).join("");
  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
        <span className="font-semibold">{spec.label}</span>
        <span className="text-muted-foreground">
          {FORMAT_LABELS[post.format]} · {size.label}
        </span>
      </div>
      {hasGraphic(post.graphic) && (
        <div className="bg-black/20">
          <PostGraphic spec={post.graphic} size={size} id={graphicId} />
        </div>
      )}
      <div className="space-y-2 p-3 text-sm">
        <p className="whitespace-pre-wrap break-words">
          {above}
          {below && spec.foldAt < spec.captionMax && (
            <span className="text-muted-foreground"> …more</span>
          )}
          {below && spec.foldAt < spec.captionMax ? (
            <span className="block text-muted-foreground/70">{below}</span>
          ) : (
            below
          )}
        </p>
        <p className={`text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}>
          {used} / {spec.captionMax} characters
          {spec.foldAt < spec.captionMax ? `, first ${spec.foldAt} show before "more"` : ""}
          {!spec.linksClickable && " · links here aren't clickable, use the bio"}
        </p>
      </div>
    </div>
  );
}
