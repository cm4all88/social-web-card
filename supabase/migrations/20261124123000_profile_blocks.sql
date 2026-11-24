-- NULL preserves the original public layout for profiles that already exist.
-- New profiles start with Links and can add the other sections as needed.
ALTER TABLE public.profiles
  ADD COLUMN profile_blocks text[],
  ADD CONSTRAINT profiles_blocks_valid CHECK (
    profile_blocks IS NULL OR (
      coalesce(array_ndims(profile_blocks), 1) = 1
      AND array_position(profile_blocks, NULL::text) IS NULL
      AND profile_blocks <@ ARRAY['links', 'wishlists', 'posts']::text[]
      AND cardinality(array_positions(profile_blocks, 'links')) <= 1
      AND cardinality(array_positions(profile_blocks, 'wishlists')) <= 1
      AND cardinality(array_positions(profile_blocks, 'posts')) <= 1
    )
  );

ALTER TABLE public.profiles ALTER COLUMN profile_blocks SET DEFAULT ARRAY['links']::text[];
