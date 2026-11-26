import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/attach-auth";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getStripe } from "@/lib/tipping/stripe.server";
import { isVideoReady, prepareVideoUpload, signedVideoUrl } from "./bunny.server";
import {
  digitalOrderMode,
  files,
  orders,
  pilotPaymentMode,
  products,
  publicFields,
  sellerAccount,
} from "./store.server";

type Product = Awaited<ReturnType<typeof getProduct>>;

const auth = [attachSupabaseAuth, requireSupabaseAuth] as const;
const productId = z.object({ id: z.string().uuid() });

export const listSellerProducts = createServerFn({ method: "GET" })
  .middleware([...auth])
  .handler(async ({ context }) => {
    try {
      await sellerAccount(context.userId);
    } catch {
      return { eligible: false, items: [] as Product[] };
    }
    const { data, error } = await products()
      .select("*")
      .eq("seller_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load your products.");
    return { eligible: true, items: data ?? [] };
  });

export const createDigitalProduct = createServerFn({ method: "POST" })
  .middleware([...auth])
  .validator(
    z.object({
      title: z.string().trim().min(1).max(100),
      description: z.string().trim().max(500),
      price: z.number().int().min(100).max(100000),
      format: z.enum(["video", "pdf", "zip"]),
    }),
  )
  .handler(async ({ data, context }) => {
    await sellerAccount(context.userId);
    const id = crypto.randomUUID();
    const video = data.format === "video" ? await prepareVideoUpload(data.title) : null;
    const assetId = video ? video.videoId : `${context.userId}/${id}.${data.format}`;
    const { error } = await products().insert({
      id,
      seller_id: context.userId,
      title: data.title,
      description: data.description,
      price_cents: data.price,
      kind: video ? "video" : "file",
      asset_id: assetId,
    });
    if (error) throw new Error("Could not save your product.");
    if (video) return { id, upload: { kind: "video" as const, headers: video.headers } };
    const { data: signed, error: signingError } = await files().createSignedUploadUrl(assetId);
    if (signingError) throw new Error("Could not prepare the file upload.");
    return { id, upload: { kind: "file" as const, path: assetId, token: signed.token } };
  });

async function getProduct(id: string) {
  const { data, error } = await products().select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Product unavailable.");
  return data;
}

export const setProductPublished = createServerFn({ method: "POST" })
  .middleware([...auth])
  .validator(productId.extend({ published: z.boolean() }))
  .handler(async ({ context, data }) => {
    const product = await getProduct(data.id);
    if (product.seller_id !== context.userId) throw new Error("Product unavailable.");
    if (data.published) {
      await sellerAccount(context.userId);
      const ready =
        product.asset_id &&
        (product.kind === "video"
          ? await isVideoReady(product.asset_id)
          : (await files().exists(product.asset_id)).data);
      if (!ready) throw new Error("Your upload is still processing or did not finish.");
    }
    const { error } = await products()
      .update({ published: data.published })
      .eq("id", product.id)
      .eq("seller_id", context.userId);
    if (error) throw new Error("Could not update your product.");
  });

async function storeIsPublic(sellerId: string) {
  const [visibility, profile] = await Promise.all([
    supabaseAdmin.rpc("profile_is_public", { _user_id: sellerId }),
    supabaseAdmin.from("profiles").select("profile_blocks").eq("user_id", sellerId).maybeSingle(),
  ]);
  return visibility.data === true && profile.data?.profile_blocks?.includes("products") === true;
}

export const listPublicProducts = createServerFn({ method: "GET" })
  .validator(z.object({ sellerId: z.string().uuid() }))
  .handler(async ({ data }) => {
    if (process.env.DIGITAL_PRODUCTS_ENABLED !== "true") return [];
    if (!(await storeIsPublic(data.sellerId))) return [];
    try {
      await sellerAccount(data.sellerId);
    } catch {
      return [];
    }
    const { data: rows, error } = await products()
      .select(publicFields)
      .eq("seller_id", data.sellerId)
      .eq("published", true)
      .order("created_at", { ascending: false });
    if (error) throw new Error("Could not load products.");
    return rows ?? [];
  });

export const buyDigitalProduct = createServerFn({ method: "POST" })
  .middleware([...auth])
  .validator(productId)
  .handler(async ({ context, data }) => {
    const { siteUrl } = pilotPaymentMode();
    const product = await getProduct(data.id);
    if (
      !product.published ||
      product.seller_id === context.userId ||
      !(await storeIsPublic(product.seller_id))
    ) {
      throw new Error("Product unavailable.");
    }
    const { id: account, live } = await sellerAccount(product.seller_id);
    const created = await orders()
      .insert({
        product_id: product.id,
        buyer_id: context.userId,
        stripe_account_id: account,
        livemode: live,
        amount_cents: product.price_cents,
      })
      .select("id")
      .single();
    let id: string;
    if (created.error?.code === "23505") {
      const existing = await orders()
        .select("id,status,stripe_account_id,amount_cents")
        .eq("buyer_id", context.userId)
        .eq("product_id", product.id)
        .eq("livemode", live)
        .in("status", ["pending", "paid"])
        .maybeSingle();
      const order = existing.data;
      if (existing.error || !order) throw new Error("Please try opening checkout again.");
      if (order.status === "paid") return { url: "/dashboard/purchases" };
      if (order.stripe_account_id !== account || order.amount_cents !== product.price_cents) {
        throw new Error("Wait for your previous checkout to expire before trying again.");
      }
      id = order.id;
    } else {
      if (created.error || !created.data) throw new Error("Could not start your order.");
      id = created.data.id;
    }

    const origin = siteUrl ?? new URL(getRequest().url).origin;
    const metadata = { digital_order_id: id };
    const session = await getStripe().checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: product.price_cents,
              product_data: { name: product.title },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        success_url: `${origin}/dashboard/purchases?checkout=complete`,
        cancel_url: `${origin}/dashboard/purchases`,
      },
      { stripeAccount: account, idempotencyKey: id },
    );
    if (!session.url) throw new Error("Checkout unavailable.");
    return { url: session.url };
  });

export const listDigitalPurchases = createServerFn({ method: "GET" })
  .middleware([...auth])
  .handler(async ({ context }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    let live;
    try {
      live = digitalOrderMode();
    } catch {
      return [];
    }
    const { data, error } = await orders()
      .select(`id, digital_products(${publicFields})`)
      .eq("buyer_id", context.userId)
      .eq("livemode", live)
      .eq("status", "paid")
      .order("created_at", { ascending: false });
    if (error?.code === "PGRST205" && process.env.DIGITAL_PRODUCTS_ENABLED !== "true") return [];
    if (error) throw new Error("Could not load purchases.");
    return data ?? [];
  });

export const openDigitalPurchase = createServerFn({ method: "POST" })
  .middleware([...auth])
  .validator(productId)
  .handler(async ({ context, data }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    const live = digitalOrderMode();
    const { data: order, error } = await orders()
      .select("product_id")
      .eq("id", data.id)
      .eq("buyer_id", context.userId)
      .eq("livemode", live)
      .eq("status", "paid")
      .maybeSingle();
    if (error || !order) throw new Error("Purchase unavailable.");
    const product = await getProduct(order.product_id);
    if (!product.asset_id) throw new Error("Purchase unavailable.");
    if (product.kind === "video")
      return { kind: "video" as const, url: signedVideoUrl(product.asset_id) };
    const link = await files().createSignedUrl(product.asset_id, 120, { download: true });
    if (link.error) throw new Error("The download is temporarily unavailable.");
    return { kind: "file" as const, url: link.data.signedUrl };
  });
