-- Rollback for 20261122190000_creator_earnings.sql.
-- Drops only what that migration created. Deletes no analytics events,
-- users or audit records (the admin audit entries it wrote stay).
DROP FUNCTION IF EXISTS public.owner_set_creator_milestone(text, integer, text, text, boolean);
DROP FUNCTION IF EXISTS public.owner_set_creator_earnings(boolean, integer, integer);
DROP FUNCTION IF EXISTS public.owner_creator_earnings();
DROP FUNCTION IF EXISTS public.my_creator_earnings();
DROP FUNCTION IF EXISTS public.creator_milestone_reached(uuid, text);
DROP FUNCTION IF EXISTS public.creator_qualifying_visitors(uuid);
DROP FUNCTION IF EXISTS public.record_creator_presence(uuid, text);
DROP TABLE IF EXISTS public.creator_presence;
DROP TABLE IF EXISTS public.creator_milestones;
DROP TABLE IF EXISTS public.creator_earnings_settings;
