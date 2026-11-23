-- Removes the Marketing Center's tables, functions and cron jobs. Marketing
-- posts, their history and account records are deleted with the tables, so
-- export them first if they are wanted. No other table is touched; sign-up
-- attribution stays in each account's sign-up metadata.
DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('yooits-marketing-due', 'yooits-marketing-weekly');
  END IF;
END;
$$;
DROP FUNCTION IF EXISTS public.marketing_weekly_notice();
DROP FUNCTION IF EXISTS public.marketing_due_tick();
DROP FUNCTION IF EXISTS public.owner_marketing_weekly();
DROP FUNCTION IF EXISTS public.owner_marketing_performance(integer);
DROP FUNCTION IF EXISTS public.owner_marketing_save_account(text, text, text, text);
DROP FUNCTION IF EXISTS public.owner_marketing_confirm_published(uuid, text);
DROP FUNCTION IF EXISTS public.marketing_record_published(uuid, text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.owner_marketing_set_status(uuid[], text, text);
DROP FUNCTION IF EXISTS public.owner_marketing_update_post(uuid, jsonb);
DROP FUNCTION IF EXISTS public.owner_marketing_add_posts(uuid, jsonb);
DROP FUNCTION IF EXISTS public.owner_marketing_save_campaign(jsonb);
DROP FUNCTION IF EXISTS public.owner_marketing_post_history(uuid);
DROP FUNCTION IF EXISTS public.owner_marketing_state();
DROP FUNCTION IF EXISTS public.marketing_post_json(public.marketing_posts);
DROP FUNCTION IF EXISTS public.marketing_url_matches(text, text);
DROP FUNCTION IF EXISTS public.marketing_log(uuid, text, text, text, jsonb);
DROP TABLE IF EXISTS public.marketing_account_tokens;
DROP TABLE IF EXISTS public.marketing_accounts;
DROP TABLE IF EXISTS public.marketing_post_events;
DROP TABLE IF EXISTS public.marketing_posts;
DROP TABLE IF EXISTS public.marketing_campaigns;
