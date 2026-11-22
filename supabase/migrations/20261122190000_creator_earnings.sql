-- Creator earnings, step 1: qualifying visitors and configurable milestones.
--
-- The single source of truth for "how many real visitors has this creator
-- had" and "which creator milestones have they reached". Other features
-- (earned skins, custom backgrounds, the creator subscription application)
-- read it through creator_milestone_reached(user, key) instead of counting
-- views themselves.
--
-- A qualifying visitor is one analytics visitor (the daily-rotating hash from
-- 20261122130000_analytics.sql) who viewed the creator's page on a given day,
-- counted once per day however often they refresh, and NOT:
--   * the creator themself (signed-in owner visits are never recorded, and a
--     signed-out visit from the browser the creator used for their dashboard
--     that day is excluded through creator_presence below);
--   * a bot (dropped by the server before recording);
--   * suspicious traffic: a visitor who viewed more than N different pages
--     that day, or sent more than M events that day (both configurable);
--   * a visit without a visitor hash (can't be de-duplicated).
-- Because the hash changes every day (privacy by design), one person who
-- returns on five days counts five times.
--
-- Reaching a milestone unlocks only what that milestone says; the 1,000
-- visitor milestone makes a creator eligible to APPLY for paid subscriptions,
-- it never turns selling on. Nothing here takes or moves money.
--
-- Switched off for everyone but admins until the owner turns it on
-- (creator_earnings_settings.enabled). Milestones marked live = false are
-- shown as planned and unlock nothing.
--
-- Additive only: three new tables and new functions. No existing table,
-- policy, function or row is changed.
--
-- Rollback: supabase/rollbacks/20261122190000_creator_earnings.down.sql

-- ---------------------------------------------------------------------------
-- Settings (one row)
-- ---------------------------------------------------------------------------
CREATE TABLE public.creator_earnings_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  suspicious_pages_per_day integer NOT NULL DEFAULT 30 CHECK (suspicious_pages_per_day BETWEEN 2 AND 10000),
  suspicious_events_per_day integer NOT NULL DEFAULT 200 CHECK (suspicious_events_per_day BETWEEN 10 AND 100000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.creator_earnings_settings (id) VALUES (true);
ALTER TABLE public.creator_earnings_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_earnings_settings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Milestones (owner-configurable)
-- ---------------------------------------------------------------------------
CREATE TABLE public.creator_milestones (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{1,64}$'),
  threshold integer NOT NULL CHECK (threshold BETWEEN 1 AND 100000000),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  -- What reaching it gives the creator, in plain words.
  unlocks text NOT NULL CHECK (char_length(unlocks) BETWEEN 1 AND 240),
  kind text NOT NULL CHECK (kind IN ('reward', 'customization', 'subscription_application', 'creator_features', 'other')),
  -- false: shown as planned, unlocks nothing yet. Turn on once the unlock works.
  live boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.creator_milestones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_milestones FROM anon, authenticated;

INSERT INTO public.creator_milestones (key, threshold, title, unlocks, kind, live, sort) VALUES
  ('exclusive_skin', 100, 'Exclusive profile skin', 'An animated profile skin only creators with real visitors can use.', 'reward', false, 10),
  ('more_customization', 500, 'More customization', 'Extra ways to customize your page.', 'customization', false, 20),
  ('subscriptions_apply', 1000, 'Apply for creator subscriptions', 'You can apply to offer paid monthly subscriptions. You must be 18 or older, and Yooits reviews every application.', 'subscription_application', false, 30),
  ('creator_features', 5000, 'More creator features', 'Additional tools for established creators.', 'creator_features', false, 40);

-- ---------------------------------------------------------------------------
-- Creator presence: the daily visitor hash of the browser a creator used for
-- their own dashboard. Lets a signed-out visit to their own page from that
-- browser be left out. Server-written only; hash only, never an address.
-- ---------------------------------------------------------------------------
CREATE TABLE public.creator_presence (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  day date NOT NULL,
  visitor_hash text NOT NULL CHECK (char_length(visitor_hash) <= 128),
  PRIMARY KEY (user_id, day, visitor_hash)
);
CREATE INDEX idx_creator_presence_hash ON public.creator_presence (visitor_hash, day);
ALTER TABLE public.creator_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_presence FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_creator_presence(_user_id uuid, _visitor_hash text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.creator_presence (user_id, day, visitor_hash)
  SELECT _user_id, (now() AT TIME ZONE 'utc')::date, left(_visitor_hash, 128)
   WHERE _user_id IS NOT NULL AND coalesce(_visitor_hash, '') <> ''
  ON CONFLICT DO NOTHING
$$;

-- ---------------------------------------------------------------------------
-- Counting
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.creator_qualifying_visitors(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT suspicious_pages_per_day AS max_pages, suspicious_events_per_day AS max_events
      FROM public.creator_earnings_settings WHERE id
  ),
  visits AS (
    SELECT DISTINCT (e.occurred_at AT TIME ZONE 'utc')::date AS day, e.visitor_hash
      FROM public.analytics_events e
     WHERE e.profile_user_id = _user_id
       AND e.kind = 'profile_view'
       AND e.visitor_hash IS NOT NULL
  )
  SELECT count(*)::int
    FROM visits v
   WHERE NOT EXISTS (
           SELECT 1 FROM public.creator_presence p
            WHERE p.user_id = _user_id AND p.day = v.day AND p.visitor_hash = v.visitor_hash)
     AND (SELECT count(DISTINCT x.profile_user_id) FROM public.analytics_events x
           WHERE x.visitor_hash = v.visitor_hash
             AND x.kind = 'profile_view'
             AND (x.occurred_at AT TIME ZONE 'utc')::date = v.day) <= (SELECT max_pages FROM s)
     AND (SELECT count(*) FROM public.analytics_events x
           WHERE x.visitor_hash = v.visitor_hash
             AND (x.occurred_at AT TIME ZONE 'utc')::date = v.day) <= (SELECT max_events FROM s)
$$;

-- For other features: has this person reached this milestone? Only live
-- milestones count. Returns false for an unknown key.
CREATE OR REPLACE FUNCTION public.creator_milestone_reached(_user_id uuid, _key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT m.live AND public.creator_qualifying_visitors(_user_id) >= m.threshold
      FROM public.creator_milestones m WHERE m.key = _key
  ), false)
$$;

-- ---------------------------------------------------------------------------
-- A person's own creator earnings view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_creator_earnings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  on_for_all boolean;
  admin boolean;
  n integer;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT enabled INTO on_for_all FROM public.creator_earnings_settings WHERE id;
  admin := public.has_role(me, 'admin');
  IF NOT coalesce(on_for_all, false) AND NOT admin THEN
    RETURN jsonb_build_object('visible', false);
  END IF;
  n := public.creator_qualifying_visitors(me);
  RETURN jsonb_build_object(
    'visible', true,
    'enabled', coalesce(on_for_all, false),
    'analytics_enabled', public.analytics_is_enabled(),
    'qualifying_visitors', n,
    'milestones', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'key', m.key, 'threshold', m.threshold, 'title', m.title, 'unlocks', m.unlocks,
               'kind', m.kind, 'live', m.live, 'reached', n >= m.threshold)
             ORDER BY m.threshold, m.sort)
        FROM public.creator_milestones m
    ), '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner console
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_creator_earnings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(s) - 'id' FROM public.creator_earnings_settings s WHERE id),
    'milestones', coalesce((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.threshold, m.sort) FROM public.creator_milestones m
    ), '[]'::jsonb),
    'top_creators', coalesce((
      SELECT jsonb_agg(x ORDER BY x.qualifying_visitors DESC, x.username)
        FROM (
          SELECT p.user_id, p.username, public.creator_qualifying_visitors(p.user_id) AS qualifying_visitors
            FROM public.profiles p
           WHERE EXISTS (SELECT 1 FROM public.analytics_events e
                          WHERE e.profile_user_id = p.user_id AND e.kind = 'profile_view')
           ORDER BY qualifying_visitors DESC
           LIMIT 25
        ) x
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_creator_earnings(
  _enabled boolean,
  _suspicious_pages_per_day integer DEFAULT NULL,
  _suspicious_events_per_day integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before jsonb;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT to_jsonb(s) - 'id' INTO before FROM public.creator_earnings_settings s WHERE id;
  UPDATE public.creator_earnings_settings
     SET enabled = coalesce(_enabled, enabled),
         suspicious_pages_per_day = coalesce(_suspicious_pages_per_day, suspicious_pages_per_day),
         suspicious_events_per_day = coalesce(_suspicious_events_per_day, suspicious_events_per_day),
         updated_at = now(), updated_by = auth.uid()
   WHERE id;
  PERFORM public.write_admin_audit(
    'creator_earnings.settings', 'setting', 'creator_earnings',
    jsonb_build_object('before', before,
                       'after', (SELECT to_jsonb(s) - 'id' FROM public.creator_earnings_settings s WHERE id))
  );
  RETURN (SELECT enabled FROM public.creator_earnings_settings WHERE id);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_creator_milestone(
  _key text,
  _threshold integer,
  _title text,
  _unlocks text,
  _live boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before jsonb;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT to_jsonb(m) INTO before FROM public.creator_milestones m WHERE m.key = _key;
  IF before IS NULL THEN
    RAISE EXCEPTION 'Unknown milestone.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.creator_milestones
     SET threshold = coalesce(_threshold, threshold),
         title = coalesce(nullif(btrim(_title), ''), title),
         unlocks = coalesce(nullif(btrim(_unlocks), ''), unlocks),
         live = coalesce(_live, live),
         updated_at = now(), updated_by = auth.uid()
   WHERE key = _key;
  PERFORM public.write_admin_audit(
    'creator_earnings.milestone', 'setting', _key,
    jsonb_build_object('before', before,
                       'after', (SELECT to_jsonb(m) FROM public.creator_milestones m WHERE m.key = _key))
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_creator_presence(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_qualifying_visitors(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_milestone_reached(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_creator_earnings() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_creator_earnings() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_creator_earnings(boolean, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_creator_milestone(text, integer, text, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_creator_presence(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.creator_qualifying_visitors(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.creator_milestone_reached(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_creator_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_creator_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_creator_earnings(boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_creator_milestone(text, integer, text, text, boolean) TO authenticated;
