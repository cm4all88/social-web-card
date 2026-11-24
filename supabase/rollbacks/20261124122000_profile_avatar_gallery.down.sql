ALTER TABLE public.profiles DROP COLUMN avatar_gallery;
DROP FUNCTION public.profile_avatar_gallery_is_valid(text[], uuid);
