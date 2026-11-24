CREATE FUNCTION public.profile_avatar_gallery_is_valid(_photos text[], _user uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT
SET search_path = ''
AS $$
  SELECT cardinality(_photos) <= 3
    AND coalesce(array_ndims(_photos), 1) = 1
    AND NOT EXISTS (
      SELECT 1 FROM unnest(_photos) AS photo(url)
      WHERE url IS NULL
        OR char_length(url) > 1024
        OR url !~ (
          '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/'
          || _user::text || '/[A-Za-z0-9._-]+$'
        )
    )
$$;

ALTER TABLE public.profiles
  ADD COLUMN avatar_gallery text[] NOT NULL DEFAULT '{}'
    CONSTRAINT profiles_avatar_gallery_check CHECK (public.profile_avatar_gallery_is_valid(avatar_gallery, user_id));
