-- Links first: custom titles and icons, featured links, sections, and
-- per-link click counts for the creator dashboard.
--
-- Additive only: four nullable/defaulted columns on social_links, one new
-- table (link_sections) and one new read function. Existing rows keep
-- working unchanged (no title = the platform's name, no icon = the
-- platform's icon, not featured, no section). No row is changed or deleted.
--
-- Rollback: supabase/rollbacks/20261122180000_links_first.down.sql

-- ---------------------------------------------------------------------------
-- Sections ("Social Media", "Shop", "Videos", "Contact" ...)
-- ---------------------------------------------------------------------------
CREATE TABLE public.link_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (
    char_length(btrim(title)) BETWEEN 1 AND 40 AND title !~ '[[:cntrl:]]'
  ),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_link_sections_user ON public.link_sections (user_id, display_order);

CREATE TRIGGER link_sections_updated_at
  BEFORE UPDATE ON public.link_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- At most 20 sections per person.
CREATE OR REPLACE FUNCTION public.link_sections_enforce_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.link_sections WHERE user_id = NEW.user_id) >= 20 THEN
    RAISE EXCEPTION 'You can have up to 20 sections.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER link_sections_limit
  BEFORE INSERT ON public.link_sections
  FOR EACH ROW EXECUTE FUNCTION public.link_sections_enforce_limit();

ALTER TABLE public.link_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sections of public pages are viewable"
  ON public.link_sections FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.profile_is_public(user_id)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Owners insert own sections"
  ON public.link_sections FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND NOT public.account_is_suspended(auth.uid()));

CREATE POLICY "Owners update own sections"
  ON public.link_sections FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND NOT public.account_is_suspended(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND NOT public.account_is_suspended(auth.uid()));

CREATE POLICY "Owners delete own sections"
  ON public.link_sections FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND NOT public.account_is_suspended(auth.uid()));

GRANT SELECT ON public.link_sections TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.link_sections TO authenticated;

-- ---------------------------------------------------------------------------
-- New link columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_links
  ADD COLUMN title text CHECK (
    title IS NULL OR (char_length(title) <= 80 AND title !~ '[[:cntrl:]]')
  ),
  ADD COLUMN icon text CHECK (icon IS NULL OR icon ~ '^[a-z0-9_-]{1,40}$'),
  ADD COLUMN featured boolean NOT NULL DEFAULT false,
  ADD COLUMN section_id uuid REFERENCES public.link_sections (id) ON DELETE SET NULL;

CREATE INDEX idx_social_links_section ON public.social_links (section_id) WHERE section_id IS NOT NULL;

-- A link can only go in one of its owner's own sections.
CREATE OR REPLACE FUNCTION public.social_links_check_section()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.link_sections s WHERE s.id = NEW.section_id AND s.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'That section belongs to someone else.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_links_check_section
  BEFORE INSERT OR UPDATE OF section_id, user_id ON public.social_links
  FOR EACH ROW EXECUTE FUNCTION public.social_links_check_section();

-- ---------------------------------------------------------------------------
-- Clicks per link for the signed-in person (all time and last 30 days).
-- Reads the analytics events written by record_analytics_event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_link_clicks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.analytics_is_enabled(),
    'links', coalesce((
      SELECT jsonb_agg(jsonb_build_object('link_id', x.link_id, 'total', x.total, 'last_30', x.last_30))
        FROM (
          SELECT ev.link_id,
                 count(*)::int AS total,
                 (count(*) FILTER (WHERE ev.occurred_at >= now() - interval '30 days'))::int AS last_30
            FROM public.analytics_events ev
            JOIN public.social_links l ON l.id = ev.link_id AND l.user_id = me
           WHERE ev.profile_user_id = me AND ev.kind = 'link_click'
           GROUP BY ev.link_id
        ) x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_link_clicks() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_link_clicks() TO authenticated;
REVOKE ALL ON FUNCTION public.link_sections_enforce_limit() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.social_links_check_section() FROM public, anon, authenticated;
