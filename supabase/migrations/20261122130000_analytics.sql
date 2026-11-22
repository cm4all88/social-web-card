-- Analytics: profile views, link clicks and traffic sources for every user,
-- and site-wide numbers for the owner console.
--
-- Additive only: two new tables and six new functions. No existing table,
-- policy, function or row is changed.
--
-- Privacy: no IP address is stored. The server sends a salted hash of the
-- visitor's IP and browser that changes every day (so a visitor can be counted
-- once a day, never followed across days). Do Not Track and Global Privacy
-- Control are honoured before anything reaches the database. Events go with
-- the account: deleting the user deletes their events (ON DELETE CASCADE).
--
-- Switched off until the owner turns it on (analytics_settings.enabled).
--
-- Rollback: supabase/rollbacks/20261122130000_analytics.down.sql

-- ---------------------------------------------------------------------------
-- Switch
-- ---------------------------------------------------------------------------
CREATE TABLE public.analytics_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.analytics_settings (id, enabled) VALUES (true, false);

ALTER TABLE public.analytics_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.analytics_is_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT enabled FROM public.analytics_settings WHERE id), false)
$$;

-- ---------------------------------------------------------------------------
-- Events (server-written only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.analytics_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('profile_view', 'link_click', 'wishlist_view', 'home_view', 'signup_cta')),
  -- The page owner. NULL for the home page.
  profile_user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  -- No foreign keys on these: an event outlives the link or wishlist.
  link_id uuid,
  link_platform text CHECK (link_platform IS NULL OR char_length(link_platform) <= 40),
  link_host text CHECK (link_host IS NULL OR char_length(link_host) <= 253),
  wishlist_id uuid,
  source text NOT NULL DEFAULT 'direct' CHECK (char_length(source) <= 40),
  referrer_host text CHECK (referrer_host IS NULL OR char_length(referrer_host) <= 253),
  utm_source text CHECK (utm_source IS NULL OR char_length(utm_source) <= 100),
  utm_medium text CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 100),
  utm_campaign text CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 100),
  device text CHECK (device IS NULL OR device IN ('mobile', 'tablet', 'desktop')),
  country text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  -- Daily-rotating salted hash of IP + browser. Never the address.
  visitor_hash text CHECK (visitor_hash IS NULL OR char_length(visitor_hash) <= 128)
);

CREATE INDEX idx_analytics_events_profile_time ON public.analytics_events (profile_user_id, occurred_at DESC);
CREATE INDEX idx_analytics_events_time ON public.analytics_events (occurred_at DESC);
CREATE INDEX idx_analytics_events_visitor_time ON public.analytics_events (visitor_hash, occurred_at DESC);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
-- No policies: browsers can neither read nor write events. They are written by
-- record_analytics_event (server only) and read through the functions below.
REVOKE ALL ON public.analytics_events FROM anon, authenticated;

-- Host of a URL, lower-case and without "www.". NULL when there isn't one.
CREATE OR REPLACE FUNCTION public.analytics_url_host(_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(regexp_replace(lower(substring(btrim(coalesce(_url, '')) FROM '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/?#]*@)?([^/:?#]+)')), '^www\.', ''), '')
$$;

-- ---------------------------------------------------------------------------
-- Record one event (server only). Returns 'ok', 'off', 'not_found',
-- 'duplicate' or 'rate_limited'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_analytics_event(
  _kind text,
  _username text,
  _link_id uuid,
  _wishlist_slug text,
  _source text,
  _referrer_host text,
  _utm_source text,
  _utm_medium text,
  _utm_campaign text,
  _device text,
  _country text,
  _visitor_hash text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  page_owner uuid;
  lp text;
  lh text;
  wl uuid;
  clip text := nullif(left(btrim(regexp_replace(coalesce(_utm_source, ''), '[[:cntrl:]]+', '', 'g')), 100), '');
  cmed text := nullif(left(btrim(regexp_replace(coalesce(_utm_medium, ''), '[[:cntrl:]]+', '', 'g')), 100), '');
  ccamp text := nullif(left(btrim(regexp_replace(coalesce(_utm_campaign, ''), '[[:cntrl:]]+', '', 'g')), 100), '');
  src text := coalesce(nullif(left(lower(btrim(coalesce(_source, ''))), 40), ''), 'direct');
  ref text := nullif(left(lower(btrim(coalesce(_referrer_host, ''))), 253), '');
  dev text := CASE WHEN _device IN ('mobile', 'tablet', 'desktop') THEN _device END;
  ctry text := CASE WHEN upper(coalesce(_country, '')) ~ '^[A-Z]{2}$' THEN upper(_country) END;
BEGIN
  IF NOT public.analytics_is_enabled() THEN
    RETURN 'off';
  END IF;
  IF _kind NOT IN ('profile_view', 'link_click', 'wishlist_view', 'home_view', 'signup_cta') THEN
    RAISE EXCEPTION 'Unknown analytics event.' USING ERRCODE = '22023';
  END IF;

  IF _kind <> 'home_view' THEN
    IF _username IS NULL AND _kind = 'signup_cta' THEN
      page_owner := NULL;
    ELSE
      SELECT p.user_id INTO page_owner FROM public.profiles p WHERE p.username = lower(btrim(coalesce(_username, '')));
      IF page_owner IS NULL THEN
        RETURN 'not_found';
      END IF;
    END IF;
  END IF;

  IF _kind = 'link_click' THEN
    SELECT l.platform, public.analytics_url_host(l.url) INTO lp, lh
      FROM public.social_links l WHERE l.id = _link_id AND l.user_id = page_owner;
    IF NOT FOUND THEN
      RETURN 'not_found';
    END IF;
  END IF;

  IF _kind = 'wishlist_view' THEN
    SELECT w.id INTO wl FROM public.wishlists w
     WHERE w.user_id = page_owner AND w.slug = lower(btrim(coalesce(_wishlist_slug, '')));
    IF wl IS NULL THEN
      RETURN 'not_found';
    END IF;
  END IF;

  IF _visitor_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('analytics:' || _visitor_hash));
    -- One visitor: at most 300 events an hour.
    IF (SELECT count(*) FROM public.analytics_events
         WHERE visitor_hash = _visitor_hash AND occurred_at > now() - interval '1 hour') >= 300 THEN
      RETURN 'rate_limited';
    END IF;
    -- A page view counts once per visitor per page in 30 minutes; reloads don't add up.
    IF _kind IN ('profile_view', 'wishlist_view', 'home_view') AND EXISTS (
      SELECT 1 FROM public.analytics_events
       WHERE visitor_hash = _visitor_hash AND kind = _kind
         AND profile_user_id IS NOT DISTINCT FROM page_owner
         AND wishlist_id IS NOT DISTINCT FROM wl
         AND occurred_at > now() - interval '30 minutes'
    ) THEN
      RETURN 'duplicate';
    END IF;
  END IF;

  INSERT INTO public.analytics_events
    (kind, profile_user_id, link_id, link_platform, link_host, wishlist_id, source, referrer_host,
     utm_source, utm_medium, utm_campaign, device, country, visitor_hash)
  VALUES
    (_kind, page_owner, CASE WHEN _kind = 'link_click' THEN _link_id END, lp, lh, wl, src, ref,
     clip, cmed, ccamp, dev, ctry, _visitor_hash);
  RETURN 'ok';
END;
$$;

-- ---------------------------------------------------------------------------
-- A person's own analytics. _days is 7, 30 or 90.
-- "visitors" adds up each day's unique visitors (the hash changes daily).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_analytics(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  d integer := CASE WHEN _days IN (7, 30, 90) THEN _days ELSE 30 END;
  since timestamptz := date_trunc('day', now()) - make_interval(days => d - 1);
  prev timestamptz := since - make_interval(days => d);
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.analytics_is_enabled(),
    'days', d,
    'since', since,
    'totals', (
      SELECT jsonb_build_object(
        'views', count(*) FILTER (WHERE kind = 'profile_view'),
        'clicks', count(*) FILTER (WHERE kind = 'link_click'),
        'wishlist_views', count(*) FILTER (WHERE kind = 'wishlist_view'),
        'visitors', (SELECT count(*) FROM (
            SELECT DISTINCT date_trunc('day', occurred_at), visitor_hash FROM public.analytics_events
             WHERE profile_user_id = me AND occurred_at >= since AND visitor_hash IS NOT NULL
               AND kind IN ('profile_view', 'wishlist_view')) v)
      )
      FROM public.analytics_events WHERE profile_user_id = me AND occurred_at >= since
    ),
    'previous', (
      SELECT jsonb_build_object(
        'views', count(*) FILTER (WHERE kind = 'profile_view'),
        'clicks', count(*) FILTER (WHERE kind = 'link_click')
      )
      FROM public.analytics_events
      WHERE profile_user_id = me AND occurred_at >= prev AND occurred_at < since
    ),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', to_char(g.day, 'YYYY-MM-DD'), 'views', coalesce(e.views, 0), 'clicks', coalesce(e.clicks, 0)) ORDER BY g.day)
        FROM generate_series(since, date_trunc('day', now()), interval '1 day') AS g(day)
        LEFT JOIN (
          SELECT date_trunc('day', occurred_at) AS day,
                 count(*) FILTER (WHERE kind = 'profile_view') AS views,
                 count(*) FILTER (WHERE kind = 'link_click') AS clicks
            FROM public.analytics_events
           WHERE profile_user_id = me AND occurred_at >= since
           GROUP BY 1
        ) e ON e.day = g.day
    ), '[]'::jsonb),
    'links', coalesce((
      SELECT jsonb_agg(x ORDER BY x.clicks DESC, x.platform)
        FROM (
          SELECT ev.link_id, max(ev.link_platform) AS platform, max(ev.link_host) AS host,
                 count(*)::int AS clicks, (l.id IS NOT NULL) AS current
            FROM public.analytics_events ev
            LEFT JOIN public.social_links l ON l.id = ev.link_id AND l.user_id = me
           WHERE ev.profile_user_id = me AND ev.kind = 'link_click' AND ev.occurred_at >= since
           GROUP BY ev.link_id, l.id
           ORDER BY clicks DESC
           LIMIT 25
        ) x
    ), '[]'::jsonb),
    'sources', coalesce((
      SELECT jsonb_agg(x ORDER BY x.views DESC)
        FROM (
          SELECT source, count(*)::int AS views FROM public.analytics_events
           WHERE profile_user_id = me AND kind = 'profile_view' AND occurred_at >= since
           GROUP BY source ORDER BY views DESC LIMIT 12
        ) x
    ), '[]'::jsonb),
    'campaigns', coalesce((
      SELECT jsonb_agg(x ORDER BY x.views DESC)
        FROM (
          SELECT utm_source, utm_medium, utm_campaign, count(*)::int AS views FROM public.analytics_events
           WHERE profile_user_id = me AND kind = 'profile_view' AND occurred_at >= since
             AND (utm_source IS NOT NULL OR utm_campaign IS NOT NULL)
           GROUP BY 1, 2, 3 ORDER BY views DESC LIMIT 10
        ) x
    ), '[]'::jsonb),
    'devices', coalesce((
      SELECT jsonb_agg(x ORDER BY x.views DESC)
        FROM (
          SELECT coalesce(device, 'unknown') AS device, count(*)::int AS views FROM public.analytics_events
           WHERE profile_user_id = me AND kind = 'profile_view' AND occurred_at >= since
           GROUP BY 1
        ) x
    ), '[]'::jsonb),
    'countries', coalesce((
      SELECT jsonb_agg(x ORDER BY x.views DESC)
        FROM (
          SELECT country, count(*)::int AS views FROM public.analytics_events
           WHERE profile_user_id = me AND kind = 'profile_view' AND occurred_at >= since AND country IS NOT NULL
           GROUP BY 1 ORDER BY views DESC LIMIT 8
        ) x
    ), '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner console: activity, destinations, platforms, conversions and growth.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_analytics(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d integer := CASE WHEN _days IN (7, 30, 90) THEN _days ELSE 30 END;
  since timestamptz := date_trunc('day', now()) - make_interval(days => d - 1);
  signups integer;
  home_visitors integer;
  plus_paid integer := NULL;
  founding_active integer;
  founding_new integer;
  total_users integer;
BEGIN
  PERFORM public.owner_require_admin();

  SELECT count(*)::int INTO total_users FROM auth.users;
  SELECT count(*)::int INTO signups FROM auth.users WHERE created_at >= since;
  SELECT count(*)::int INTO home_visitors FROM (
    SELECT DISTINCT date_trunc('day', occurred_at), visitor_hash FROM public.analytics_events
     WHERE kind = 'home_view' AND occurred_at >= since AND visitor_hash IS NOT NULL) v;
  SELECT count(*) FILTER (WHERE revoked_at IS NULL AND now() >= starts_at AND now() < ends_at)::int,
         count(*) FILTER (WHERE created_at >= since)::int
    INTO founding_active, founding_new
    FROM public.plan_entitlements WHERE source = 'founding_creator';
  -- Paid Plus, once the Plus billing tables exist. Only live subscriptions count.
  IF to_regclass('public.plus_subscriptions') IS NOT NULL THEN
    EXECUTE $q$SELECT count(DISTINCT user_id)::int FROM public.plus_subscriptions
               WHERE livemode AND status IN ('active', 'trialing', 'past_due')$q$ INTO plus_paid;
  END IF;

  RETURN jsonb_build_object(
    'enabled', public.analytics_is_enabled(),
    'days', d,
    'since', since,
    'users', jsonb_build_object(
      'total', total_users,
      'signups', signups,
      'active_7d', (SELECT count(*)::int FROM auth.users WHERE last_sign_in_at >= now() - interval '7 days'),
      'active_30d', (SELECT count(*)::int FROM auth.users WHERE last_sign_in_at >= now() - interval '30 days'),
      'pages_with_traffic', (SELECT count(DISTINCT profile_user_id)::int FROM public.analytics_events
                              WHERE kind = 'profile_view' AND occurred_at >= since),
      'pages_published', (SELECT count(*)::int FROM public.profiles p
                           WHERE EXISTS (SELECT 1 FROM public.social_links l WHERE l.user_id = p.user_id AND l.enabled))
    ),
    'traffic', (
      SELECT jsonb_build_object(
        'profile_views', count(*) FILTER (WHERE kind = 'profile_view'),
        'link_clicks', count(*) FILTER (WHERE kind = 'link_click'),
        'wishlist_views', count(*) FILTER (WHERE kind = 'wishlist_view'),
        'home_views', count(*) FILTER (WHERE kind = 'home_view'),
        'signup_clicks', count(*) FILTER (WHERE kind = 'signup_cta')
      )
      FROM public.analytics_events WHERE occurred_at >= since
    ),
    'conversions', jsonb_build_object(
      'home_visitors', home_visitors,
      'signups', signups,
      'visit_to_signup_pct', CASE WHEN home_visitors > 0 THEN round(100.0 * signups / home_visitors, 1) END,
      'founding_active', founding_active,
      'founding_new', founding_new,
      'plus_paid', plus_paid,
      'free_to_plus_pct', CASE WHEN plus_paid IS NOT NULL AND total_users > 0 THEN round(100.0 * plus_paid / total_users, 1) END
    ),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'day', to_char(g.day, 'YYYY-MM-DD'),
               'signups', coalesce(s.n, 0),
               'views', coalesce(e.views, 0),
               'clicks', coalesce(e.clicks, 0)) ORDER BY g.day)
        FROM generate_series(since, date_trunc('day', now()), interval '1 day') AS g(day)
        LEFT JOIN (SELECT date_trunc('day', created_at) AS day, count(*) AS n FROM auth.users
                    WHERE created_at >= since GROUP BY 1) s ON s.day = g.day
        LEFT JOIN (SELECT date_trunc('day', occurred_at) AS day,
                          count(*) FILTER (WHERE kind = 'profile_view') AS views,
                          count(*) FILTER (WHERE kind = 'link_click') AS clicks
                     FROM public.analytics_events WHERE occurred_at >= since GROUP BY 1) e ON e.day = g.day
    ), '[]'::jsonb),
    'growth', coalesce((
      SELECT jsonb_agg(jsonb_build_object('week', to_char(w.week, 'YYYY-MM-DD'),
               'total', (SELECT count(*) FROM auth.users u WHERE u.created_at < w.week + interval '7 days')) ORDER BY w.week)
        FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS w(week)
    ), '[]'::jsonb),
    'destinations', coalesce((
      SELECT jsonb_agg(x ORDER BY x.clicks DESC)
        FROM (SELECT link_host AS host, count(*)::int AS clicks FROM public.analytics_events
               WHERE kind = 'link_click' AND occurred_at >= since AND link_host IS NOT NULL
               GROUP BY 1 ORDER BY clicks DESC LIMIT 15) x
    ), '[]'::jsonb),
    'platforms', coalesce((
      SELECT jsonb_agg(x ORDER BY x.links DESC, x.clicks DESC)
        FROM (
          SELECT coalesce(l.platform, c.platform) AS platform,
                 coalesce(l.links, 0)::int AS links, coalesce(c.clicks, 0)::int AS clicks
            FROM (SELECT platform, count(*) AS links FROM public.social_links WHERE enabled GROUP BY 1) l
            FULL JOIN (SELECT link_platform AS platform, count(*) AS clicks FROM public.analytics_events
                        WHERE kind = 'link_click' AND occurred_at >= since AND link_platform IS NOT NULL
                        GROUP BY 1) c ON c.platform = l.platform
           ORDER BY links DESC, clicks DESC LIMIT 20
        ) x
    ), '[]'::jsonb),
    'sources', coalesce((
      SELECT jsonb_agg(x ORDER BY x.views DESC)
        FROM (SELECT source, count(*)::int AS views FROM public.analytics_events
               WHERE kind IN ('profile_view', 'home_view') AND occurred_at >= since
               GROUP BY 1 ORDER BY views DESC LIMIT 15) x
    ), '[]'::jsonb),
    'top_pages', coalesce((
      SELECT jsonb_agg(x ORDER BY x.views DESC)
        FROM (SELECT p.username, count(*) FILTER (WHERE e.kind = 'profile_view')::int AS views,
                     count(*) FILTER (WHERE e.kind = 'link_click')::int AS clicks
                FROM public.analytics_events e JOIN public.profiles p ON p.user_id = e.profile_user_id
               WHERE e.occurred_at >= since AND e.kind IN ('profile_view', 'link_click')
               GROUP BY p.username ORDER BY views DESC LIMIT 10) x
    ), '[]'::jsonb)
  );
END;
$$;

-- Turn recording on or off. Logged.
CREATE OR REPLACE FUNCTION public.owner_set_analytics_enabled(_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  UPDATE public.analytics_settings
     SET enabled = coalesce(_enabled, false), updated_at = now(), updated_by = auth.uid()
   WHERE id;
  PERFORM public.write_admin_audit(
    CASE WHEN _enabled THEN 'analytics.enabled' ELSE 'analytics.disabled' END,
    'setting', 'analytics', '{}'::jsonb
  );
  RETURN coalesce(_enabled, false);
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_url_host(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_is_enabled() FROM public;
REVOKE ALL ON FUNCTION public.record_analytics_event(text, text, uuid, text, text, text, text, text, text, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_analytics(integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_analytics(integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_analytics_enabled(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.analytics_is_enabled() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_analytics_event(text, text, uuid, text, text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_analytics(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_analytics(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_analytics_enabled(boolean) TO authenticated;
