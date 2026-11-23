-- Undoes 20261123030000_site_settings_wishlists.sql. Drops the owner
-- functions and the site_settings row (the site falls back to its built-in
-- name, tagline and contact email). Wishlists, app_flags and every other
-- table are left as they are; lists made private stay private.
DROP FUNCTION IF EXISTS public.owner_wishlist_set_visibility(uuid, text, text);
DROP FUNCTION IF EXISTS public.owner_wishlists(text, integer);
DROP FUNCTION IF EXISTS public.owner_set_app_flag(text, boolean);
DROP FUNCTION IF EXISTS public.owner_save_site_settings(jsonb);
DROP FUNCTION IF EXISTS public.owner_site_settings();
DROP FUNCTION IF EXISTS public.public_site_settings();
DROP FUNCTION IF EXISTS public.site_social_hosts(text);
DROP TABLE IF EXISTS public.site_settings;
