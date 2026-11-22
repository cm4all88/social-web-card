/**
 * Support Offerings (GitHub issue #7), step 1 (migration
 * 20261122210000_support_offerings.sql): creators list a real digital
 * offering, the owner approves each version, and only paid buyers receive it.
 * There is no checkout yet, so nothing here sells anything. The creator keeps
 * the whole price; buyers pay the existing Yooits service fee on top.
 */
import { supabase } from "@/integrations/supabase/client";
import { PLATFORM_FEE_CENTS } from "@/lib/tipping/money";

type Rpc = {
  rpc: (f: string, a: object) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const client = supabase as unknown as Rpc;

async function call<T>(fn: string, args: object = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type OfferingKind = "download" | "digital_card" | "reader_pack" | "exclusive_post";
export const OFFERING_KINDS: { id: OfferingKind; label: string; needsFile: boolean }[] = [
  { id: "download", label: "Download", needsFile: true },
  { id: "digital_card", label: "Digital card", needsFile: true },
  { id: "reader_pack", label: "Reader pack", needsFile: true },
  { id: "exclusive_post", label: "Exclusive post", needsFile: false },
];

export type OfferingVersion = {
  id: string;
  version: number;
  kind: OfferingKind;
  title: string;
  description: string;
  what_you_get: string;
  min_price_cents: number;
  allow_pay_more: boolean;
  file_name: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decision_note: string | null;
};

export type MyOffering = {
  id: string;
  created_at: string;
  suspended: boolean;
  suspended_reason: string | null;
  sales: number;
  versions: OfferingVersion[] | null;
};

export type MySupportOfferings =
  | { visible: false }
  | {
      visible: true;
      enabled: boolean;
      checkout_enabled: boolean;
      price_min_cents: number;
      price_max_cents: number;
      offerings: MyOffering[];
    };

export function parseMySupportOfferings(raw: unknown): MySupportOfferings {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.visible !== true) return { visible: false };
  return {
    visible: true,
    enabled: r.enabled === true,
    checkout_enabled: r.checkout_enabled === true,
    price_min_cents: Number(r.price_min_cents) || 100,
    price_max_cents: Number(r.price_max_cents) || 50_000,
    offerings: Array.isArray(r.offerings) ? (r.offerings as MyOffering[]) : [],
  };
}

export async function loadMySupportOfferings(): Promise<MySupportOfferings> {
  try {
    return parseMySupportOfferings(await call("my_support_offerings"));
  } catch {
    return { visible: false };
  }
}

/** What a buyer pays for a price: the price, plus the Yooits service fee. */
export function supportTotal(priceCents: number) {
  return { price: priceCents, fee: PLATFORM_FEE_CENTS, total: priceCents + PLATFORM_FEE_CENTS };
}

export const submitSupportOffering = (o: {
  offeringId: string | null;
  kind: OfferingKind;
  title: string;
  description: string;
  whatYouGet: string;
  minPriceCents: number;
  allowPayMore: boolean;
  filePath: string | null;
  fileName: string | null;
  contentBody: string | null;
}) =>
  call<string>("creator_submit_support_offering", {
    _offering_id: o.offeringId,
    _kind: o.kind,
    _title: o.title,
    _description: o.description,
    _what_you_get: o.whatYouGet,
    _min_price_cents: o.minPriceCents,
    _allow_pay_more: o.allowPayMore,
    _file_path: o.filePath,
    _file_name: o.fileName,
    _content_body: o.contentBody,
  });

export const archiveSupportOffering = (id: string) =>
  call<boolean>("creator_archive_support_offering", { _offering_id: id });

const FILE_TYPES = [
  "application/pdf",
  "application/epub+zip",
  "application/zip",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const SUPPORT_FILE_MAX_BYTES = 50 * 1024 * 1024;

/** Uploads the deliverable to the private support-files bucket. */
export async function uploadSupportFile(userId: string, file: File): Promise<string> {
  if (!FILE_TYPES.includes(file.type)) {
    throw new Error("Use a PDF, EPUB, ZIP or image file.");
  }
  if (file.size > SUPPORT_FILE_MAX_BYTES) throw new Error("Files can be up to 50 MB.");
  const ext =
    (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("support-files")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
