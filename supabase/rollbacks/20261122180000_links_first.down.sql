-- Rollback for 20261122180000_links_first.sql.
-- Removes link titles, icons, featured flags and sections, and the per-link
-- click function. The links themselves, their order, visibility and all
-- analytics events stay. Custom titles, icon choices, featured flags and
-- section names are lost, so export them first if they matter:
--   SELECT id, title, icon, featured, section_id FROM public.social_links;
--   SELECT * FROM public.link_sections;
BEGIN;

DROP FUNCTION IF EXISTS public.my_link_clicks();

DROP TRIGGER IF EXISTS social_links_check_section ON public.social_links;
DROP FUNCTION IF EXISTS public.social_links_check_section();
DROP INDEX IF EXISTS public.idx_social_links_section;

ALTER TABLE public.social_links
  DROP COLUMN IF EXISTS section_id,
  DROP COLUMN IF EXISTS featured,
  DROP COLUMN IF EXISTS icon,
  DROP COLUMN IF EXISTS title;

DROP TABLE IF EXISTS public.link_sections;
DROP FUNCTION IF EXISTS public.link_sections_enforce_limit();

COMMIT;
