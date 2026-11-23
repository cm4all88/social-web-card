-- Owner Settings and the owner Wishlists page.
--
-- Additive only. One new single-row table (site_settings) with the values the
-- site shows about itself: name, tagline, contact email, browser theme colour
-- and Yooits' own social accounts. Its defaults are what the site shows today,
-- so nothing visible changes until the owner saves something. Existing
-- settings tables (feature_flags, app_flags, email_settings,
-- wishlist_claim_settings, wishlist_gift_settings) are reused as they are; this
-- adds an audited owner switch for app_flags, which had none, and owner reads
-- for wishlists with one moderation step (make a list private). No user,
-- financial or audit data is changed or removed.
-- Rollback: supabase/rollbacks/20261123030000_site_settings_wishlists.down.sql

CREATE TABLE IF NOT EXISTS public.site_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  site_name text NOT NULL DEFAULT 'Yooits'
    CHECK (char_length(btrim(site_name)) BETWEEN 1 AND 40),
  tagline text NOT NULL DEFAULT 'One link. All your socials.'
    CHECK (char_length(btrim(tagline)) BETWEEN 1 AND 80),
  support_email text NOT NULL DEFAULT 'admin@tahomaindustries.com'
    CHECK (support_email ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' AND char_length(support_email) <= 120),
  theme_color text CHECK (theme_color IS NULL OR theme_color ~ '^#[0-9a-f]{6}$'),
  socials jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(socials) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);
INSERT INTO public.site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_settings FROM anon, authenticated;

-- Yooits' own accounts, in the order the site lists them.
CREATE OR REPLACE FUNCTION public.site_social_hosts(_platform text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _platform
    WHEN 'instagram' THEN ARRAY['instagram.com']
    WHEN 'tiktok' THEN ARRAY['tiktok.com']
    WHEN 'x' THEN ARRAY['x.com', 'twitter.com']
    WHEN 'facebook' THEN ARRAY['facebook.com', 'fb.com']
    WHEN 'youtube' THEN ARRAY['youtube.com', 'youtu.be']
    WHEN 'snapchat' THEN ARRAY['snapchat.com']
    WHEN 'threads' THEN ARRAY['threads.net', 'threads.com']
    ELSE NULL END
$$;

-- What anyone may read: shown on the home page, sign-in page and legal pages.
CREATE OR REPLACE FUNCTION public.public_site_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'site_name', s.site_name, 'tagline', s.tagline, 'support_email', s.support_email,
    'theme_color', s.theme_color, 'socials', s.socials)
    FROM public.site_settings s WHERE s.id
$$;
GRANT EXECUTE ON FUNCTION public.public_site_settings() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_site_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'site', (SELECT to_jsonb(s) - 'id' FROM public.site_settings s WHERE s.id),
    'feature_flags', coalesce((SELECT jsonb_agg(jsonb_build_object('key', f.key, 'enabled', f.enabled,
                                 'updated_at', f.updated_at) ORDER BY f.key) FROM public.feature_flags f), '[]'::jsonb),
    'app_flags', coalesce((SELECT jsonb_agg(jsonb_build_object('key', a.key, 'enabled', a.enabled,
                             'note', a.note, 'updated_at', a.updated_at) ORDER BY a.key) FROM public.app_flags a), '[]'::jsonb),
    'email', (SELECT to_jsonb(e) - 'id' - 'dispatch_url' FROM public.email_settings e WHERE e.id),
    'wishlist_claims', (SELECT to_jsonb(w) - 'id' FROM public.wishlist_claim_settings w WHERE w.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_save_site_settings(_s jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur public.site_settings%ROWTYPE;
  nm text;
  tg text;
  em text;
  tc text;
  so jsonb := '{}'::jsonb;
  k text;
  v text;
  host text;
BEGIN
  PERFORM public.owner_require_admin();
  IF _s IS NULL OR jsonb_typeof(_s) <> 'object' THEN
    RAISE EXCEPTION 'Send the settings as an object.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cur FROM public.site_settings WHERE id FOR UPDATE;

  nm := CASE WHEN _s ? 'site_name' THEN btrim(regexp_replace(coalesce(_s->>'site_name', ''), '[[:cntrl:]]+', ' ', 'g')) ELSE cur.site_name END;
  tg := CASE WHEN _s ? 'tagline' THEN btrim(regexp_replace(coalesce(_s->>'tagline', ''), '[[:cntrl:]]+', ' ', 'g')) ELSE cur.tagline END;
  em := CASE WHEN _s ? 'support_email' THEN lower(btrim(coalesce(_s->>'support_email', ''))) ELSE cur.support_email END;
  tc := CASE WHEN _s ? 'theme_color' THEN NULLIF(lower(btrim(coalesce(_s->>'theme_color', ''))), '') ELSE cur.theme_color END;

  IF char_length(nm) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'The site name is 1 to 40 characters.' USING ERRCODE = '22023';
  END IF;
  IF char_length(tg) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'The tagline is 1 to 80 characters.' USING ERRCODE = '22023';
  END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR char_length(em) > 120 THEN
    RAISE EXCEPTION 'That contact email doesn''t look right.' USING ERRCODE = '22023';
  END IF;
  IF tc IS NOT NULL AND tc !~ '^#[0-9a-f]{6}$' THEN
    RAISE EXCEPTION 'The colour is a hex value like #a855f7.' USING ERRCODE = '22023';
  END IF;

  IF _s ? 'socials' THEN
    IF jsonb_typeof(_s->'socials') <> 'object' THEN
      RAISE EXCEPTION 'Social links are an object of platform to address.' USING ERRCODE = '22023';
    END IF;
    FOR k, v IN SELECT key, btrim(value) FROM jsonb_each_text(_s->'socials') LOOP
      CONTINUE WHEN v IS NULL OR v = '';
      IF public.site_social_hosts(k) IS NULL THEN
        RAISE EXCEPTION 'Unknown social platform: %', k USING ERRCODE = '22023';
      END IF;
      IF char_length(v) > 200 OR v !~ '^https://[^\s/?#]+(/[^\s]*)?$' THEN
        RAISE EXCEPTION 'The % link must be a full https:// address.', k USING ERRCODE = '22023';
      END IF;
      host := lower(substring(v FROM '^https://([^/?#:]+)'));
      host := regexp_replace(host, '^(www|m)\.', '');
      IF NOT host = ANY (public.site_social_hosts(k)) THEN
        RAISE EXCEPTION 'The % link must be on %.', k, array_to_string(public.site_social_hosts(k), ' or ')
          USING ERRCODE = '22023';
      END IF;
      so := so || jsonb_build_object(k, v);
    END LOOP;
  ELSE
    so := cur.socials;
  END IF;

  UPDATE public.site_settings
     SET site_name = nm, tagline = tg, support_email = em, theme_color = tc, socials = so,
         updated_at = now(), updated_by = auth.uid()
   WHERE id;
  PERFORM public.write_admin_audit('site_settings.updated', 'setting', 'site',
    jsonb_build_object('before', jsonb_build_object('site_name', cur.site_name, 'tagline', cur.tagline,
                         'support_email', cur.support_email, 'theme_color', cur.theme_color, 'socials', cur.socials),
                       'after', jsonb_build_object('site_name', nm, 'tagline', tg, 'support_email', em,
                         'theme_color', tc, 'socials', so)));
  RETURN public.public_site_settings();
END;
$$;

-- app_flags had no audited owner switch (only the table policy). Existing keys only.
CREATE OR REPLACE FUNCTION public.owner_set_app_flag(_key text, _enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  was boolean;
BEGIN
  PERFORM public.owner_require_admin();
  IF _enabled IS NULL THEN
    RAISE EXCEPTION 'Say on or off.' USING ERRCODE = '22023';
  END IF;
  SELECT enabled INTO was FROM public.app_flags WHERE key = _key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No app switch with that key.' USING ERRCODE = 'P0002';
  END IF;
  IF was IS DISTINCT FROM _enabled THEN
    UPDATE public.app_flags SET enabled = _enabled, updated_at = now() WHERE key = _key;
    PERFORM public.write_admin_audit('app_flag.' || CASE WHEN _enabled THEN 'enabled' ELSE 'disabled' END,
      'app_flag', _key, '{}'::jsonb);
  END IF;
  RETURN _enabled;
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner: wishlists
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_wishlists(_q text DEFAULT NULL, _limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q text := NULLIF(lower(btrim(coalesce(_q, ''))), '');
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'totals', jsonb_build_object(
      'lists', (SELECT count(*) FROM public.wishlists),
      'public_lists', (SELECT count(*) FROM public.wishlists WHERE visibility = 'public'),
      'for_someone_else', (SELECT count(*) FROM public.wishlists WHERE recipient_name IS NOT NULL),
      'items', (SELECT count(*) FROM public.wishlist_items),
      'claims', (SELECT count(*) FROM public.wishlist_item_claims),
      'owners', (SELECT count(DISTINCT user_id) FROM public.wishlists),
      'open_reports', (SELECT count(*) FROM public.abuse_reports
                        WHERE wishlist_id IS NOT NULL AND status = 'open')),
    'lists', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
        SELECT jsonb_build_object(
          'id', w.id, 'title', w.title, 'slug', w.slug, 'username', p.username,
          'user_id', w.user_id, 'visibility', w.visibility, 'show_on_profile', w.show_on_profile,
          'occasion', w.occasion, 'event_date', w.event_date, 'for_someone_else', w.recipient_name IS NOT NULL,
          'created_at', w.created_at, 'updated_at', w.updated_at,
          'items', (SELECT count(*) FROM public.wishlist_items i WHERE i.wishlist_id = w.id),
          'claims', (SELECT count(*) FROM public.wishlist_item_claims c WHERE c.wishlist_id = w.id),
          'open_reports', (SELECT count(*) FROM public.abuse_reports r
                            WHERE r.wishlist_id = w.id AND r.status = 'open')) AS x
          FROM public.wishlists w
          LEFT JOIN public.profiles p ON p.user_id = w.user_id
         WHERE q IS NULL OR lower(w.title) LIKE '%' || q || '%' OR lower(coalesce(p.username, '')) LIKE '%' || q || '%'
         ORDER BY w.created_at DESC
         LIMIT least(greatest(coalesce(_limit, 100), 1), 500)) s), '[]'::jsonb),
    'claims', (SELECT to_jsonb(c) - 'id' FROM public.wishlist_claim_settings c WHERE c.id),
    'gift_money', (SELECT jsonb_build_object('enabled', g.enabled, 'checkout_enabled', g.checkout_enabled,
                     'stripe_approved', g.stripe_approved_at IS NOT NULL)
                     FROM public.wishlist_gift_settings g WHERE g.id));
END;
$$;

-- Moderation: hide a list from the public (or show it again). The owner of the
-- list can change it back themselves; the reason is kept in the audit log.
CREATE OR REPLACE FUNCTION public.owner_wishlist_set_visibility(_id uuid, _visibility text, _reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  was text;
  why text := NULLIF(left(btrim(coalesce(_reason, '')), 200), '');
BEGIN
  PERFORM public.owner_require_admin();
  IF _visibility NOT IN ('public', 'private') THEN
    RAISE EXCEPTION 'Visibility is public or private.' USING ERRCODE = '22023';
  END IF;
  IF why IS NULL OR char_length(why) < 3 THEN
    RAISE EXCEPTION 'Give a short reason for the audit log.' USING ERRCODE = '22023';
  END IF;
  SELECT visibility INTO was FROM public.wishlists WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No wishlist with that id.' USING ERRCODE = 'P0002';
  END IF;
  IF was IS DISTINCT FROM _visibility THEN
    UPDATE public.wishlists SET visibility = _visibility, updated_at = now() WHERE id = _id;
    PERFORM public.write_admin_audit('wishlist.visibility_changed', 'wishlist', _id::text,
      jsonb_build_object('from', was, 'to', _visibility, 'reason', why));
  END IF;
  RETURN _visibility;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_site_settings() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_save_site_settings(jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_app_flag(text, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_wishlists(text, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_wishlist_set_visibility(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_site_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_save_site_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_app_flag(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_wishlists(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_wishlist_set_visibility(uuid, text, text) TO authenticated;
