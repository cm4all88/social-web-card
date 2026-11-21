-- Rollback for 20261122101000_link_domain_blocks.sql.
-- Removes the block and allow lists, the save check and the hide policies.
-- Links themselves are never touched, so every hidden link shows again.
-- The audit log keeps its link_domain.* entries (it is append-only).
BEGIN;

DROP POLICY IF EXISTS "Links to blocked sites are hidden" ON public.social_links;
DROP POLICY IF EXISTS "Wishlist links to blocked sites are hidden" ON public.wishlist_items;
DROP TRIGGER IF EXISTS social_links_enforce_domain_blocks ON public.social_links;
DROP TRIGGER IF EXISTS wishlist_items_enforce_domain_blocks ON public.wishlist_items;
DROP FUNCTION IF EXISTS public.owner_set_link_domain(text, text, boolean, text);
DROP FUNCTION IF EXISTS public.owner_link_domain_lists();
DROP FUNCTION IF EXISTS public.enforce_link_domain_blocks();
DROP FUNCTION IF EXISTS public.link_url_is_blocked(text);
DROP FUNCTION IF EXISTS public.link_domain_normalize(text);
DROP FUNCTION IF EXISTS public.link_url_host(text);
DROP TABLE IF EXISTS public.link_domain_allows;
DROP TABLE IF EXISTS public.link_domain_blocks;

COMMIT;
