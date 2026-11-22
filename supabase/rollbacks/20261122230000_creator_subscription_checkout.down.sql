-- Rollback for 20261122230000_creator_subscription_checkout.sql.
-- Removes the checkout gate and the indexes. The added columns on
-- creator_subscriptions stay: they may hold payment records, which are never
-- deleted without an approved cleanup, and nothing reads them once the gate
-- and the checkout code are gone.

DROP FUNCTION IF EXISTS public.creator_subscription_checkout_gate(uuid, text);
DROP INDEX IF EXISTS public.creator_subscriptions_checkout_session;
DROP INDEX IF EXISTS public.idx_creator_subscriptions_subscriber;
