-- Rollback for 20261122220000_backgrounds_from_creator_milestones.sql.
-- Restores the fixed 1,000 raw profile views from 20261122183000_profile_skins.sql
-- and removes the custom_background milestone. Rewards already granted stay.
-- Run this before rolling back 20261122190000_creator_earnings, whose
-- tables and visitor count these functions read.

CREATE OR REPLACE FUNCTION public.popular_view_threshold()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT 1000
$$;
GRANT EXECUTE ON FUNCTION public.popular_view_threshold() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.profile_view_count(_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) FROM public.analytics_events
   WHERE profile_user_id = _user_id AND kind = 'profile_view'
$$;
REVOKE ALL ON FUNCTION public.profile_view_count(uuid) FROM public, anon, authenticated;

DELETE FROM public.creator_milestones WHERE key = 'custom_background';
