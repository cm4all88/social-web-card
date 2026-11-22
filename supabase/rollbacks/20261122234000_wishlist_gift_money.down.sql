-- Rollback for 20261122234000_wishlist_gift_money.sql.
-- Run only while wishlist_gifts is empty (no real gift was ever paid);
-- otherwise keep the tables and leave the feature switched off.
-- Admin audit rows are kept either way.

DROP FUNCTION IF EXISTS public.owner_set_wishlist_gift_recipient(uuid, boolean, boolean, boolean, text);
DROP FUNCTION IF EXISTS public.owner_set_wishlist_gift_settings(boolean, boolean, text, integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.owner_wishlist_gift_money();
DROP FUNCTION IF EXISTS public.wishlist_gift_checkout_gate(uuid, uuid);
DROP TABLE IF EXISTS public.wishlist_gifts;
DROP TABLE IF EXISTS public.wishlist_gift_recipients;
DROP TABLE IF EXISTS public.wishlist_gift_settings;
ALTER TABLE public.wishlists DROP COLUMN IF EXISTS accepts_gift_money;
