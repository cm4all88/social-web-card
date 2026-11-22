-- Rollback for 20261122160000_email_system.sql. Removes the email queue and
-- its triggers; no other table is touched. The email log (email_outbox,
-- email_events) and people's email choices are dropped with it, so export
-- them first if they matter: they hold no account, payment or audit data.
DROP TRIGGER IF EXISTS wishlists_email ON public.wishlists;
DROP TRIGGER IF EXISTS beta_feedback_email ON public.beta_feedback;
DROP TRIGGER IF EXISTS abuse_reports_email ON public.abuse_reports;
DROP TRIGGER IF EXISTS dm_messages_email ON public.dm_messages;
DROP TRIGGER IF EXISTS account_status_email ON public.account_status;
DROP TRIGGER IF EXISTS creator_payment_accounts_email ON public.creator_payment_accounts;
DROP TRIGGER IF EXISTS tips_email ON public.tips;
DROP TRIGGER IF EXISTS plan_entitlements_email ON public.plan_entitlements;
DROP TRIGGER IF EXISTS plus_subscriptions_email ON public.plus_subscriptions;
DROP TRIGGER IF EXISTS auth_users_email_security ON auth.users;
DROP TRIGGER IF EXISTS profiles_email_welcome ON public.profiles;
DROP TRIGGER IF EXISTS email_outbox_kick ON public.email_outbox;

DROP FUNCTION IF EXISTS public.email_on_wishlist();
DROP FUNCTION IF EXISTS public.email_on_beta_feedback();
DROP FUNCTION IF EXISTS public.email_on_abuse_report();
DROP FUNCTION IF EXISTS public.email_on_dm_message();
DROP FUNCTION IF EXISTS public.email_on_account_status();
DROP FUNCTION IF EXISTS public.email_on_payment_account();
DROP FUNCTION IF EXISTS public.email_on_tip();
DROP FUNCTION IF EXISTS public.email_on_plan_entitlement();
DROP FUNCTION IF EXISTS public.email_on_plus_subscription();
DROP FUNCTION IF EXISTS public.email_on_auth_user_updated();
DROP FUNCTION IF EXISTS public.email_on_profile_created();
DROP FUNCTION IF EXISTS public.owner_email_suppressions();
DROP FUNCTION IF EXISTS public.owner_email_unsuppress(text);
DROP FUNCTION IF EXISTS public.owner_email_retry(uuid);
DROP FUNCTION IF EXISTS public.owner_email_set_setting(text, text);
DROP FUNCTION IF EXISTS public.owner_email_log(text, integer, integer);
DROP FUNCTION IF EXISTS public.owner_email_status();
DROP FUNCTION IF EXISTS public.email_unsubscribe_token(uuid);
DROP FUNCTION IF EXISTS public.set_my_email_preferences(boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.my_email_preferences();
DROP FUNCTION IF EXISTS public.email_set_preferences_by_token(text, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.email_unsubscribe(text, text);
DROP FUNCTION IF EXISTS public.email_preferences_by_token(text);
DROP FUNCTION IF EXISTS public.email_outbox_after_insert();
DROP FUNCTION IF EXISTS public.email_dispatch_token_ok(text);
DROP FUNCTION IF EXISTS public.email_kick();
DROP FUNCTION IF EXISTS public.email_needing_status(integer);
DROP FUNCTION IF EXISTS public.email_record_event(text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.email_mark_result(uuid, boolean, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.email_claim_batch(integer);
DROP FUNCTION IF EXISTS public.email_queue_admin(text, jsonb, text);
DROP FUNCTION IF EXISTS public.email_queue(text, text, uuid, jsonb, text, text, boolean, uuid);
DROP FUNCTION IF EXISTS public.email_profile_bits(uuid);
DROP FUNCTION IF EXISTS public.email_preferences_for(uuid);
DROP FUNCTION IF EXISTS public.email_category_enabled(text);
DROP FUNCTION IF EXISTS public.email_category_is_optional(text);

DROP TABLE IF EXISTS public.email_suppressions;
DROP TABLE IF EXISTS public.email_preferences;
DROP TABLE IF EXISTS public.email_events;
DROP TABLE IF EXISTS public.email_outbox;
DROP TABLE IF EXISTS public.email_settings;
