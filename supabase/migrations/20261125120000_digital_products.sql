CREATE TABLE public.digital_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 100 AND 100000),
  kind text NOT NULL CHECK (kind IN ('video', 'file')),
  asset_id text,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT published OR asset_id IS NOT NULL)
);
CREATE INDEX digital_products_seller ON public.digital_products(seller_id);
ALTER TABLE public.digital_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.digital_products FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.digital_products TO service_role;

CREATE TABLE public.digital_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.digital_products(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id text NOT NULL,
  livemode boolean NOT NULL,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX digital_orders_active ON public.digital_orders(buyer_id, product_id, livemode)
  WHERE status IN ('pending', 'paid');
CREATE INDEX digital_orders_buyer ON public.digital_orders(buyer_id, status);
ALTER TABLE public.digital_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.digital_orders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.digital_orders TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('digital-products', 'digital-products', false, 52428800,
        ARRAY['application/pdf', 'application/zip', 'application/x-zip-compressed']);

ALTER TABLE public.profiles DROP CONSTRAINT profiles_blocks_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_blocks_valid CHECK (
  profile_blocks IS NULL OR (
    coalesce(array_ndims(profile_blocks), 1) = 1
    AND array_position(profile_blocks, NULL::text) IS NULL
    AND profile_blocks <@ ARRAY['links', 'wishlists', 'posts', 'products']::text[]
    AND cardinality(array_positions(profile_blocks, 'links')) <= 1
    AND cardinality(array_positions(profile_blocks, 'wishlists')) <= 1
    AND cardinality(array_positions(profile_blocks, 'posts')) <= 1
    AND cardinality(array_positions(profile_blocks, 'products')) <= 1
  )
);
