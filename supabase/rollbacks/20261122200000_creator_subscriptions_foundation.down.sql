-- Rollback for 20261122200000_creator_subscriptions_foundation.sql.
-- Removes only what that migration added. Run it only while no real creator
-- subscription has been sold (creator_subscriptions is empty); otherwise
-- keep the tables and switch the feature off instead.
-- Files in the creator-media bucket are left in place; the bucket is private.

DROP POLICY IF EXISTS "Creator media: unlocked posts only" ON storage.objects;
DROP POLICY IF EXISTS "Creator media: approved creators upload to their folder" ON storage.objects;
DROP POLICY IF EXISTS "Creator media: creators delete their own files" ON storage.objects;

DROP FUNCTION IF EXISTS public.owner_remove_creator_post(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.owner_set_creator_monetization_suspended(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.owner_decide_creator_offer(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.owner_decide_creator_application(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.owner_set_creator_subscription_settings(boolean, integer, integer, integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.owner_creator_subscriptions();
DROP FUNCTION IF EXISTS public.creator_feed(text);
DROP FUNCTION IF EXISTS public.my_creator_subscriptions();
DROP FUNCTION IF EXISTS public.creator_post_json(public.creator_posts, uuid);
DROP FUNCTION IF EXISTS public.creator_delete_post(uuid);
DROP FUNCTION IF EXISTS public.creator_save_post(uuid, text, text, text, text, text[]);
DROP FUNCTION IF EXISTS public.creator_submit_offer(integer, text);
DROP FUNCTION IF EXISTS public.creator_withdraw_application();
DROP FUNCTION IF EXISTS public.creator_apply(text, text[], boolean, boolean);
DROP FUNCTION IF EXISTS public.creator_can_apply(uuid);
DROP FUNCTION IF EXISTS public.creator_require_on();
DROP FUNCTION IF EXISTS public.creator_media_can_upload(text);
DROP FUNCTION IF EXISTS public.creator_media_visible(text);
DROP FUNCTION IF EXISTS public.creator_post_unlocked(uuid, uuid);
DROP FUNCTION IF EXISTS public.has_active_creator_subscription(uuid, uuid);

DROP TABLE IF EXISTS public.creator_posts;
DROP TABLE IF EXISTS public.creator_subscriptions;
DROP TRIGGER IF EXISTS creator_offer_immutable ON public.creator_subscription_offers;
DROP TABLE IF EXISTS public.creator_subscription_offers;
DROP FUNCTION IF EXISTS public.creator_offer_immutable();
DROP FUNCTION IF EXISTS public.creator_is_monetized(uuid);
DROP TABLE IF EXISTS public.creator_monetization;
DROP TABLE IF EXISTS public.creator_applications;
DROP FUNCTION IF EXISTS public.creator_subscriptions_on_for(uuid);
DROP TABLE IF EXISTS public.creator_subscription_settings;
