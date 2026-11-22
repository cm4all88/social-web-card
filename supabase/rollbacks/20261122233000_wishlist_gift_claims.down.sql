-- Rollback for 20261122233000_wishlist_gift_claims.sql.
-- Removes gift claims and the two wishlist columns. Claims hold no money or
-- audit data (settings changes stay in admin_audit_log). Prefer switching
-- the feature off (owner_set_wishlist_claim_settings(false)) unless the
-- schema itself has to go.

DROP FUNCTION IF EXISTS public.owner_set_wishlist_claim_settings(boolean, integer);
DROP FUNCTION IF EXISTS public.owner_wishlist_claim_settings();
DROP FUNCTION IF EXISTS public.my_wishlist_claims();
DROP FUNCTION IF EXISTS public.unclaim_wishlist_item(uuid);
DROP FUNCTION IF EXISTS public.claim_wishlist_item(uuid);
DROP FUNCTION IF EXISTS public.wishlist_claim_status(uuid);
DROP FUNCTION IF EXISTS public.wishlist_claims_on_for(uuid);
DROP TABLE IF EXISTS public.wishlist_item_claims;
DROP TABLE IF EXISTS public.wishlist_claim_settings;
ALTER TABLE public.wishlists DROP COLUMN IF EXISTS reveal_claims;
ALTER TABLE public.wishlists DROP COLUMN IF EXISTS recipient_name;
