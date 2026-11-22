-- Rollback for 20261122130000_analytics.sql (analytics).
-- Run in one transaction. The migration only added things, so this only
-- removes them: six functions and the analytics_events and analytics_settings
-- tables. No other table, function, policy or row is touched.
-- Dropping analytics_events deletes the views and clicks recorded so far.
-- Export them first if they're wanted:
--   COPY (SELECT * FROM public.analytics_events) TO STDOUT WITH CSV HEADER;
-- To stop recording without losing anything, turn analytics off instead:
--   UPDATE public.analytics_settings SET enabled = false;
-- After a full rollback, deploy code without analytics, or the dashboard and
-- /owner/analytics show an error (profiles and links keep working: tracking
-- failures are ignored).
BEGIN;
DROP FUNCTION IF EXISTS public.owner_set_analytics_enabled(boolean);
DROP FUNCTION IF EXISTS public.owner_analytics(integer);
DROP FUNCTION IF EXISTS public.my_analytics(integer);
DROP FUNCTION IF EXISTS public.record_analytics_event(text, text, uuid, text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.analytics_url_host(text);
DROP FUNCTION IF EXISTS public.analytics_is_enabled();
DROP TABLE IF EXISTS public.analytics_events;
DROP TABLE IF EXISTS public.analytics_settings;
COMMIT;
