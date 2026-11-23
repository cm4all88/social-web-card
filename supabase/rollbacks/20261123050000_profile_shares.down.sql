-- Undoes 20261123050000_profile_shares.sql. Removes the share counts; page
-- views and sign-ups are untouched.
DROP FUNCTION IF EXISTS public.owner_share_stats(integer);
DROP FUNCTION IF EXISTS public.my_share_stats(integer);
DROP FUNCTION IF EXISTS public.record_profile_share_event(text, text, uuid, text, text);
DROP TABLE IF EXISTS public.profile_shares;
