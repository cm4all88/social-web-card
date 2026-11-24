/**
 * Checks that a post is really live before the Marketing Center calls it
 * published. For TikTok, X and YouTube it asks the platform's public oEmbed
 * endpoint about the post's address: a 200 with the post's author means the
 * post exists and is public. Only then is it recorded, with the author the
 * platform reported. Instagram, Facebook and Snapchat have no public check,
 * so those are recorded as "confirmed by you", never as verified.
 */
import { PLATFORMS, urlMatchesPlatform, type PlatformId } from "./platforms";

type Rpc = {
  rpc: (
    fn: string,
    args: object,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
};
type Service = Rpc & {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: string,
      ) => { maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }> };
    };
  };
};
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type VerifyResult =
  | { ok: true; author: string | null }
  | {
      ok: false;
      reason:
        | "not_public"
        | "unreachable"
        | "wrong_platform"
        | "wrong_account"
        | "no_public_check"
        | "refused";
      message: string;
    };

export function externalIdFrom(platform: PlatformId, url: string): string | null {
  const m =
    platform === "x"
      ? url.match(/\/status(?:es)?\/(\d+)/)
      : platform === "tiktok"
        ? url.match(/\/(?:video|photo)\/(\d+)/)
        : platform === "youtube"
          ? url.match(/(?:shorts\/|v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/)
          : null;
  return m ? m[1] : null;
}

/** oEmbed takes twitter.com addresses most reliably. */
function oembedTarget(platform: PlatformId, url: string) {
  return platform === "x"
    ? url.replace(/^https:\/\/(www\.|mobile\.)?x\.com\//i, "https://twitter.com/")
    : url;
}

const handleOf = (s: string | null | undefined) =>
  (s ?? "")
    .trim()
    .replace(/^@/, "")
    .replace(/\/+$/, "")
    .split("/")
    .pop()
    ?.replace(/^@/, "")
    .toLowerCase() || null;

export async function verifyAndRecord(
  asOwner: Rpc,
  service: Service,
  actorId: string,
  postId: string,
  rawUrl: string,
  fetchFn: Fetch = fetch,
): Promise<VerifyResult> {
  const url = rawUrl.trim();
  // Only an admin can see a post's history, so this both checks the caller and the post.
  const own = await asOwner.rpc("owner_marketing_post_history", { _id: postId });
  if (own.error)
    return {
      ok: false,
      reason: "refused",
      message: own.error.code === "42501" ? "Only Yooits.me admins can do this." : own.error.message,
    };

  const { data: post, error } = await service
    .from("marketing_posts")
    .select("id, platform, status")
    .eq("id", postId)
    .maybeSingle();
  if (error || !post) return { ok: false, reason: "refused", message: "That post wasn't found." };
  const platform = (post as { platform: PlatformId }).platform;
  const spec = PLATFORMS[platform];
  if (!urlMatchesPlatform(platform, url)) {
    return {
      ok: false,
      reason: "wrong_platform",
      message: `That isn't a ${spec.label} post address.`,
    };
  }
  if (!spec.oembed) {
    return {
      ok: false,
      reason: "no_public_check",
      message: `${spec.label} has no public check, so confirm it yourself.`,
    };
  }

  let res: Response;
  try {
    res = await fetchFn(spec.oembed(oembedTarget(platform, url)), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: `Couldn't reach ${spec.label} to check the post. Try again in a minute.`,
    };
  }
  if (res.status === 404 || res.status === 400 || res.status === 401 || res.status === 403) {
    return {
      ok: false,
      reason: "not_public",
      message: `${spec.label} says there's no public post at that address yet.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: "unreachable",
      message: `${spec.label}'s check answered ${res.status}. Try again in a minute.`,
    };
  }
  let body: { author_name?: string; author_url?: string; title?: string; html?: string };
  try {
    body = await res.json();
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: `${spec.label}'s check didn't answer clearly. Try again in a minute.`,
    };
  }
  if (!body || (!body.html && !body.author_name)) {
    return {
      ok: false,
      reason: "not_public",
      message: `${spec.label} didn't recognise that as a public post.`,
    };
  }

  const { data: account } = await service
    .from("marketing_accounts")
    .select("handle")
    .eq("platform", platform)
    .maybeSingle();
  const expected = handleOf((account as { handle?: string } | null)?.handle);
  const author = handleOf(body.author_url) ?? handleOf(body.author_name);
  if (expected && author && platform !== "youtube" && author !== expected) {
    return {
      ok: false,
      reason: "wrong_account",
      message: `That post is by @${author}, not your @${expected} account.`,
    };
  }

  const rec = await service.rpc("marketing_record_published", {
    _id: postId,
    _url: url,
    _external_id: externalIdFrom(platform, url),
    _verification: "oembed",
    _detail: {
      author: body.author_name ?? null,
      author_url: body.author_url ?? null,
      checked_with: `${platform}_oembed`,
    },
    _actor: actorId,
  });
  if (rec.error) return { ok: false, reason: "refused", message: rec.error.message };
  return { ok: true, author: body.author_name ?? null };
}
