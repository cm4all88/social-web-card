import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { migrationSql, SUPABASE_STUBS } from "./supabase-stubs";

it("accepts the products block, keeps assets private, and enforces one active order per mode", async () => {
  const db = new PGlite();
  try {
    await db.exec(SUPABASE_STUBS);
    await db.exec("CREATE TABLE public.profiles (id uuid);");
    const migrations = migrationSql();
    await db.exec(migrations.find((sql) => sql.includes("ADD COLUMN profile_blocks"))!);
    await db.exec(migrations.find((sql) => sql.includes("CREATE TABLE public.digital_products"))!);

    await db.exec(
      "INSERT INTO public.profiles (profile_blocks) VALUES (ARRAY['links', 'products']);",
    );
    await expect(
      db.exec(
        "INSERT INTO public.profiles (profile_blocks) VALUES (ARRAY['products', 'products']);",
      ),
    ).rejects.toThrow("profiles_blocks_valid");

    const bucket = await db.query(
      "SELECT public FROM storage.buckets WHERE id = 'digital-products'",
    );
    expect(bucket.rows).toEqual([{ public: false }]);

    const seller = "00000000-0000-4000-8000-000000000101";
    const buyer = "00000000-0000-4000-8000-000000000102";
    await db.query("INSERT INTO auth.users(id) VALUES ($1), ($2)", [seller, buyer]);
    const product = await db.query<{ id: string }>(
      "INSERT INTO digital_products (seller_id, title, price_cents, kind) VALUES ($1, 'Pilot', 1200, 'video') RETURNING id",
      [seller],
    );
    const order = [product.rows[0].id, buyer];
    const createOrder = (live: boolean) =>
      db.query(
        "INSERT INTO digital_orders (product_id, buyer_id, stripe_account_id, livemode, amount_cents) VALUES ($1, $2, 'acct_pilot', $3, 1200)",
        [...order, live],
      );
    await createOrder(false);
    await expect(createOrder(false)).rejects.toThrow("digital_orders_active");
    await createOrder(true);
    await db.exec("UPDATE digital_orders SET status = 'revoked' WHERE NOT livemode;");
    await createOrder(false);
    await db.exec("SET ROLE authenticated;");
    await expect(db.query("SELECT asset_id FROM public.digital_products")).rejects.toThrow(
      "permission denied",
    );
    await expect(db.query("UPDATE public.digital_orders SET status = 'paid'")).rejects.toThrow(
      "permission denied",
    );
  } finally {
    await db.close();
  }
}, 15_000);
