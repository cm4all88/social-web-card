/**
 * Recording one analytics event on the server. Kept apart from the server
 * function so it can be tested with a stand-in database client.
 */
import { hashIp } from "@/lib/tipping/rate-limit.server";
import {
  classifySource,
  cleanUtm,
  deviceFromUserAgent,
  isBot,
  optedOut,
  referrerHost,
} from "./source";

export const EVENT_KINDS = [
  "profile_view",
  "link_click",
  "wishlist_view",
  "home_view",
  "signup_cta",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type TrackInput = {
  kind: EventKind;
  username?: string | null;
  linkId?: string | null;
  wishlistSlug?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};

export type RequestFacts = {
  ip: string | null;
  userAgent: string | null;
  dnt: string | null;
  gpc: string | null;
  country: string | null;
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type TrackResult = "ok" | "off" | "not_found" | "duplicate" | "rate_limited" | "skipped";

/** The visitor hash changes every UTC day, so a visitor is never followed across days. */
export async function visitorHash(
  ip: string,
  userAgent: string,
  salt: string,
  now = new Date(),
): Promise<string> {
  const day = now.toISOString().slice(0, 10);
  return hashIp(`${day}|${ip}|${userAgent}`, `analytics:${salt}`);
}

export async function recordEvent(
  db: RpcClient,
  input: TrackInput,
  req: RequestFacts,
  salt: string,
  now = new Date(),
): Promise<TrackResult> {
  if (optedOut({ dnt: req.dnt, gpc: req.gpc })) return "skipped";
  if (isBot(req.userAgent)) return "skipped";

  const ref = input.referrer ?? null;
  const refHost = referrerHost(ref);
  const source = classifySource({
    referrer: ref,
    userAgent: req.userAgent,
    utmSource: input.utmSource,
  });
  const ip = req.ip && req.ip !== "unknown" ? req.ip : null;
  const hash = ip && req.userAgent ? await visitorHash(ip, req.userAgent, salt, now) : null;
  const country =
    req.country && /^[A-Za-z]{2}$/.test(req.country) ? req.country.toUpperCase() : null;

  const { data, error } = await db.rpc("record_analytics_event", {
    _kind: input.kind,
    _username: input.username ?? null,
    _link_id: input.kind === "link_click" ? (input.linkId ?? null) : null,
    _wishlist_slug: input.kind === "wishlist_view" ? (input.wishlistSlug ?? null) : null,
    _source: source,
    _referrer_host: refHost,
    _utm_source: cleanUtm(input.utmSource),
    _utm_medium: cleanUtm(input.utmMedium),
    _utm_campaign: cleanUtm(input.utmCampaign),
    _device: deviceFromUserAgent(req.userAgent),
    _country: country,
    _visitor_hash: hash,
  });
  if (error) throw new Error(error.message);
  return (data as TrackResult) ?? "ok";
}
