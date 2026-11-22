/**
 * Creator subscriptions, step 2 (migration
 * 20261122200000_creator_subscriptions_foundation.sql): applications, owner
 * approval, versioned offers and creator posts. The database decides who may
 * do what and who may see a subscriber post; this file only calls it and
 * types the answers. There is no checkout: nothing here sells anything.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseFeeRates, type FeeRates } from "./fees";

type Rpc = {
  rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const client = supabase as unknown as Rpc;

async function call<T>(fn: string, args: object = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type ContentType = "text" | "photos" | "updates" | "other";
export const CONTENT_TYPES: { id: ContentType; label: string }[] = [
  { id: "text", label: "Writing" },
  { id: "photos", label: "Photos" },
  { id: "updates", label: "Updates" },
  { id: "other", label: "Something else" },
];

export type CreatorOffer = {
  id: string;
  version: number;
  price_cents: number;
  description: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decision_note: string | null;
};

export type MyCreatorPost = {
  id: string;
  visibility: "public" | "subscribers";
  title: string;
  body: string;
  preview: string | null;
  media_paths: string[];
  created_at: string;
  removed: boolean;
  removed_reason: string | null;
};

export type MyCreatorSubscriptions =
  | { visible: false }
  | {
      visible: true;
      enabled: boolean;
      checkout_enabled: boolean;
      price_min_cents: number;
      price_max_cents: number;
      fees: FeeRates | null;
      can_apply: boolean;
      application: {
        id: string;
        status: "pending" | "approved" | "rejected" | "withdrawn";
        created_at: string;
        decided_at: string | null;
        decision_note: string | null;
      } | null;
      monetization: {
        approved_at: string;
        suspended: boolean;
        suspended_reason: string | null;
      } | null;
      offers: CreatorOffer[];
      subscribers: number;
      posts: MyCreatorPost[];
    };

export function parseMyCreatorSubscriptions(raw: unknown): MyCreatorSubscriptions {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.visible !== true) return { visible: false };
  return {
    visible: true,
    enabled: r.enabled === true,
    checkout_enabled: r.checkout_enabled === true,
    price_min_cents: Number(r.price_min_cents) || 100,
    price_max_cents: Number(r.price_max_cents) || 50_000,
    fees: parseFeeRates(r.fees),
    can_apply: r.can_apply === true,
    application: (r.application as never) ?? null,
    monetization: (r.monetization as never) ?? null,
    offers: Array.isArray(r.offers) ? (r.offers as CreatorOffer[]) : [],
    subscribers: Number(r.subscribers) || 0,
    posts: Array.isArray(r.posts) ? (r.posts as MyCreatorPost[]) : [],
  };
}

export async function loadMyCreatorSubscriptions(): Promise<MyCreatorSubscriptions> {
  try {
    return parseMyCreatorSubscriptions(await call("my_creator_subscriptions"));
  } catch {
    return { visible: false };
  }
}

export const applyAsCreator = (a: {
  about: string;
  contentTypes: ContentType[];
  adult: boolean;
  sfw: boolean;
}) =>
  call<string>("creator_apply", {
    _about: a.about,
    _content_types: a.contentTypes,
    _adult_confirmed: a.adult,
    _sfw_confirmed: a.sfw,
  });

export const withdrawCreatorApplication = () => call<boolean>("creator_withdraw_application");

export const submitCreatorOffer = (priceCents: number, description: string) =>
  call<string>("creator_submit_offer", { _price_cents: priceCents, _description: description });

export const saveCreatorPost = (p: {
  id: string | null;
  visibility: "public" | "subscribers";
  title: string;
  body: string;
  preview: string;
  mediaPaths: string[];
}) =>
  call<string>("creator_save_post", {
    _id: p.id,
    _visibility: p.visibility,
    _title: p.title,
    _body: p.body,
    _preview: p.preview,
    _media_paths: p.mediaPaths,
  });

export const deleteCreatorPost = (id: string) => call<boolean>("creator_delete_post", { _id: id });

const MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** Uploads a photo to the private creator-media bucket and returns its path. */
export async function uploadCreatorMedia(userId: string, file: File): Promise<string> {
  if (!MEDIA_TYPES.includes(file.type)) throw new Error("Use a PNG, JPEG, WebP or GIF image.");
  if (file.size > MEDIA_MAX_BYTES) throw new Error("Images can be up to 10 MB.");
  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("creator-media")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * Short-lived links to photos the viewer may see. Storage itself checks that
 * the viewer may see each one, so a locked photo gets no link.
 */
export async function signedMediaUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await supabase.storage.from("creator-media").createSignedUrls(paths, 600);
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  }
  return out;
}

export type FeedPost =
  | {
      id: string;
      visibility: "public" | "subscribers";
      title: string;
      body: string;
      preview: string | null;
      media_paths: string[];
      locked: false;
      created_at: string;
    }
  | {
      id: string;
      visibility: "subscribers";
      title: string;
      preview: string | null;
      media_count: number;
      locked: true;
      created_at: string;
    };

export type CreatorFeed = { enabled: boolean; subscribed: boolean; posts: FeedPost[] };

export async function loadCreatorFeed(username: string): Promise<CreatorFeed> {
  try {
    const r = (await call<Record<string, unknown>>("creator_feed", { _username: username })) ?? {};
    return {
      enabled: r.enabled === true,
      subscribed: r.subscribed === true,
      posts: Array.isArray(r.posts) ? (r.posts as FeedPost[]) : [],
    };
  } catch {
    return { enabled: false, subscribed: false, posts: [] };
  }
}
