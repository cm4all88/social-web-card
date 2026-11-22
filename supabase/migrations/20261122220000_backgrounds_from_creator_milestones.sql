-- Custom backgrounds (the "popular" reward) now unlock from the creator
-- milestones rather than a fixed 1,000 raw profile views: one count of real
-- visitors (creator_qualifying_visitors: each visitor once a day, own visits,
-- bots and suspicious traffic left out) against a "custom_background"
-- milestone the owner edits in Owner > Creators.
--
-- Redefines the two functions that 20261122183000_profile_skins.sql made the
-- single place the popular reward is defined; that file is left unchanged.
-- Rewards already granted stay granted.
--
-- Additive. Rollback: supabase/rollbacks/20261122220000_backgrounds_from_creator_milestones.down.sql

INSERT INTO public.creator_milestones (key, threshold, title, unlocks, kind, live, sort)
VALUES ('custom_background', 1000, 'Custom background',
        'Put your own photo behind your page.', 'customization', true, 25)
ON CONFLICT (key) DO NOTHING;

-- The threshold the owner set for custom backgrounds (1,000 if the row is gone).
-- Definer: creator_milestones is closed to browsers.
CREATE OR REPLACE FUNCTION public.popular_view_threshold()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT threshold FROM public.creator_milestones WHERE key = 'custom_background'), 1000)
$$;
REVOKE ALL ON FUNCTION public.popular_view_threshold() FROM public;
GRANT EXECUTE ON FUNCTION public.popular_view_threshold() TO anon, authenticated;

-- Real visitors a creator's page has had: the creator earnings count. While
-- the milestone is switched off (not live) it reports 0, so nothing unlocks.
CREATE OR REPLACE FUNCTION public.profile_view_count(_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN coalesce((SELECT live FROM public.creator_milestones WHERE key = 'custom_background'), true)
             THEN public.creator_qualifying_visitors(_user_id)::bigint
           ELSE 0::bigint
         END
$$;
REVOKE ALL ON FUNCTION public.profile_view_count(uuid) FROM public, anon, authenticated;
