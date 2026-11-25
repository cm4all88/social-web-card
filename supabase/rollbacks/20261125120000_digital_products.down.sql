-- Once a pilot has data, disable new sales via DIGITAL_PRODUCTS_ENABLED
-- and keep purchases available. Export or migrate the pilot data before rollback.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.digital_orders)
    OR EXISTS (SELECT 1 FROM public.digital_products)
    OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'digital-products')
  THEN
    RAISE EXCEPTION 'Digital product pilot data exists. Disable new sales and preserve the data before rollback.';
  END IF;
END;
$$;

UPDATE public.profiles
  SET profile_blocks = array_remove(profile_blocks, 'products')
  WHERE 'products' = ANY(profile_blocks);

ALTER TABLE public.profiles DROP CONSTRAINT profiles_blocks_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_blocks_valid CHECK (
  profile_blocks IS NULL OR (
    coalesce(array_ndims(profile_blocks), 1) = 1
    AND array_position(profile_blocks, NULL::text) IS NULL
    AND profile_blocks <@ ARRAY['links', 'wishlists', 'posts']::text[]
    AND cardinality(array_positions(profile_blocks, 'links')) <= 1
    AND cardinality(array_positions(profile_blocks, 'wishlists')) <= 1
    AND cardinality(array_positions(profile_blocks, 'posts')) <= 1
  )
);
DELETE FROM storage.buckets WHERE id = 'digital-products';
DROP TABLE public.digital_orders;
DROP TABLE public.digital_products;
