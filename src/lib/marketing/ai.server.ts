/**
 * Optional AI rewrite of a generated post, through Vercel AI Gateway on the
 * same Vercel team that hosts yooits.me. It uses AI_GATEWAY_API_KEY when set,
 * otherwise the deployment's own Vercel OIDC token. With neither, or if the
 * gateway refuses, the built-in writer's text stays as it is. The result is
 * checked against the claim rules before it's offered.
 */
import { FEATURES, type FeatureId } from "./features";
import { checkClaims } from "./claims";
import { PLATFORMS, type PlatformId } from "./platforms";

const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

export type RewriteInput = {
  platform: PlatformId;
  caption: string;
  features: FeatureId[];
  audience: string;
  kind: string;
};
export type RewriteResult =
  | { ok: true; caption: string; model: string }
  | {
      ok: false;
      reason: "no_access" | "refused" | "blocked_claim" | "bad_output";
      message: string;
    };

export function aiAuthToken(
  env: Record<string, string | undefined>,
  oidcHeader?: string | null,
): string | null {
  return (
    env.AI_GATEWAY_API_KEY?.trim() || oidcHeader?.trim() || env.VERCEL_OIDC_TOKEN?.trim() || null
  );
}

export function rewritePrompt(input: RewriteInput): string {
  const spec = PLATFORMS[input.platform];
  const facts = input.features
    .map((f) => `- ${FEATURES[f].name}: ${FEATURES[f].claim} (${FEATURES[f].facts.join("; ")})`)
    .join("\n");
  return [
    `Rewrite this ${spec.label} post for Yooits.me (yooits.me), a free link-in-bio page.`,
    `Audience: ${input.audience}. Post type: ${input.kind}.`,
    `Only mention these features, exactly as described:\n${facts}`,
    "Never mention tips, tipping, subscriptions, payments, money, fees, Plus, Pro, Founding Members, AI, or user numbers.",
    'Write like a person, plainly. No hype words, no "game changer", no "elevate", no "unlock your potential", no emoji chains.',
    `Keep it under ${Math.min(spec.captionMax, input.platform === "x" ? 250 : 600)} characters. Keep the hook in the first ${spec.foldAt} characters.`,
    input.caption.includes("{link}")
      ? "Keep the token {link} exactly once; it becomes the link."
      : "Don't add a link.",
    "Reply with the post text only.",
    "",
    "Post:",
    input.caption,
  ].join("\n");
}

export async function aiRewrite(
  input: RewriteInput,
  token: string | null,
  model = DEFAULT_MODEL,
  fetchFn: typeof fetch = fetch,
): Promise<RewriteResult> {
  if (!token)
    return {
      ok: false,
      reason: "no_access",
      message: "No AI access is set up on this deployment, so the built-in writer's text stays.",
    };
  let res: Response;
  try {
    res = await fetchFn(GATEWAY, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        messages: [{ role: "user", content: rewritePrompt(input) }],
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return {
      ok: false,
      reason: "refused",
      message: "Couldn't reach the AI service. The built-in text stays.",
    };
  }
  if (!res.ok) {
    const why =
      res.status === 401 || res.status === 403
        ? "AI access isn't enabled for this project"
        : `the AI service answered ${res.status}`;
    return {
      ok: false,
      reason: res.status === 401 || res.status === 403 ? "no_access" : "refused",
      message: `Couldn't rewrite: ${why}. The built-in text stays.`,
    };
  }
  const body = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;
  const text = body?.choices?.[0]?.message?.content?.trim().replace(/^["“]|["”]$/g, "");
  if (!text || text.length < 20)
    return {
      ok: false,
      reason: "bad_output",
      message: "The rewrite came back empty. The built-in text stays.",
    };
  const caption =
    input.caption.includes("{link}") && !text.includes("{link}") ? `${text} {link}` : text;
  const blocked = checkClaims(caption).filter((i) => i.level === "blocked");
  if (blocked.length)
    return {
      ok: false,
      reason: "blocked_claim",
      message: `The rewrite mentioned "${blocked[0].phrase}", so it was thrown away.`,
    };
  return { ok: true, caption: caption.slice(0, PLATFORMS[input.platform].captionMax), model };
}
