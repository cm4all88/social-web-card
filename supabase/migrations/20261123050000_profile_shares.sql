-- Profile sharing: count when someone shares a Yooits page (copy link, the
-- phone's share sheet, a share button for an app, a downloaded graphic or a
-- copied caption), and show the page's owner and the site owner what came
-- of it.
--
-- Additive only: one new table and three new functions. No existing table,
-- policy, function or row is changed.
--
-- Privacy: the same as analytics_events. No IP address is stored, only the
-- daily-rotating visitor hash the server already makes. Shares go with the
-- account (ON DELETE CASCADE). Nothing is recorded while analytics is off.
--
-- Visits that came from a share are the existing profile_view events whose
-- utm_medium is 'share' (share links carry ?utm_source=<app>&utm_medium=share).
-- Sign-ups a page brought in are the existing mkt_ref sign-up metadata.
--
-- Rollback: supabase/rollbacks/20261123050000_profile_shares.down.sql

CREATE TABLE public.profile_shares (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- The page that was shared.
  profile_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- How: copy, native, facebook, x, story, caption ...
  channel text NOT NULL CHECK (channel ~ '^[a-z0-9_]{1,24}$'),
  -- True when the page's owner shared it (checked on the server from their sign-in).
  by_owner boolean NOT NULL DEFAULT false,
  device text CHECK (device IS NULL OR device IN ('mobile', 'tablet', 'desktop')),
  visitor_hash text CHECK (visitor_hash IS NULL OR char_length(visitor_hash) <= 128)
);

CREATE INDEX idx_profile_shares_profile_time ON public.profile_shares (profile_user_id, occurred_at DESC);
CREATE INDEX idx_profile_shares_time ON public.profile_shares (occurred_at DESC);
CREATE INDEX idx_profile_shares_visitor_time ON public.profile_shares (visitor_hash, occurred_at DESC);

ALTER TABLE public.profile_shares ENABLE ROW LEVEL SECURITY;
-- No policies: written by record_profile_share_event (server only), read
-- through the functions below.
REVOKE ALL ON public.profile_shares FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Record one share (server only). Returns 'ok', 'off', 'not_found',
-- 'rate_limited' or 'bad_channel'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_profile_share_event(
  _username text,
  _channel text,
  _actor uuid,
  _device text,
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
  ch text := lower(btrim(coalesce(_channel, '')));
  dev text := CASE WHEN _device IN ('mobile', 'tablet', 'desktop') THEN _device END;
BEGIN
  IF NOT public.analytics_is_enabled() THEN
    RETURN 'off';
  END IF;
  IF ch !~ '^[a-z0-9_]{1,24}$' THEN
    RETURN 'bad_channel';
  END IF;
  SELECT p.user_id INTO page_owner FROM public.profiles p
   WHERE p.username = lower(btrim(coalesce(_username, '')));
  IF page_owner IS NULL THEN
    RETURN 'not_found';
  END IF;

  IF _visitor_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('share:' || _visitor_hash));
    -- One visitor: at most 60 shares an hour.
    IF (SELECT count(*) FROM public.profile_shares
         WHERE visitor_hash = _visitor_hash AND occurred_at > now() - interval '1 hour') >= 60 THEN
      RETURN 'rate_limited';
    END IF;
  END IF;

  INSERT INTO public.profile_shares (profile_user_id, channel, by_owner, device, visitor_hash)
  VALUES (page_owner, ch, _actor IS NOT NULL AND _actor = page_owner, dev, _visitor_hash);
  RETURN 'ok';
END;
$$;

-- ---------------------------------------------------------------------------
-- A person's own sharing numbers. _days is 7, 30 or 90.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_share_stats(_days integer DEFAULT 30)
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
  my_name text;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT username INTO my_name FROM public.profiles WHERE user_id = me;
  RETURN jsonb_build_object(
    'enabled', public.analytics_is_enabled(),
    'days', d,
    'shares', (SELECT count(*) FROM public.profile_shares WHERE profile_user_id = me AND occurred_at >= since),
    'my_shares', (SELECT count(*) FROM public.profile_shares
                   WHERE profile_user_id = me AND by_owner AND occurred_at >= since),
    'share_visits', (SELECT count(*) FROM public.analytics_events
                      WHERE profile_user_id = me AND kind = 'profile_view'
                        AND utm_medium = 'share' AND occurred_at >= since),
    'referred_signups', CASE WHEN my_name IS NULL THEN 0 ELSE (
        SELECT count(*) FROM auth.users u
         WHERE u.created_at >= since AND lower(u.raw_user_meta_data->>'mkt_ref') = my_name) END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Site-wide sharing for the owner console. Pages owned by admins are left
-- out of "profiles shared" so the owner's own pages don't count as users.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_share_stats(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d integer := CASE WHEN _days IN (7, 30, 90) THEN _days ELSE 30 END;
  since timestamptz := date_trunc('day', now()) - make_interval(days => d - 1);
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'enabled', public.analytics_is_enabled(),
    'days', d,
    'since', since,
    'shares', (SELECT count(*) FROM public.profile_shares WHERE occurred_at >= since),
    'owner_shares', (SELECT count(*) FROM public.profile_shares WHERE by_owner AND occurred_at >= since),
    'visitor_shares', (SELECT count(*) FROM public.profile_shares WHERE NOT by_owner AND occurred_at >= since),
    'profiles_shared', (SELECT count(DISTINCT s.profile_user_id) FROM public.profile_shares s
                         WHERE s.by_owner AND s.occurred_at >= since
                           AND NOT public.has_role(s.profile_user_id, 'admin')),
    'share_visits', (SELECT count(*) FROM public.analytics_events
                      WHERE kind = 'profile_view' AND utm_medium = 'share' AND occurred_at >= since),
    'referred_signups', (SELECT count(*) FROM auth.users u
                          WHERE u.created_at >= since
                            AND nullif(u.raw_user_meta_data->>'mkt_ref', '') IS NOT NULL),
    'channels', coalesce((
      SELECT jsonb_agg(x ORDER BY x.shares DESC, x.channel) FROM (
        SELECT channel, count(*)::int AS shares FROM public.profile_shares
         WHERE occurred_at >= since GROUP BY channel) x), '[]'::jsonb),
    'pages', coalesce((
      SELECT jsonb_agg(x ORDER BY x.shares DESC, x.username) FROM (
        SELECT p.username, count(*)::int AS shares,
               count(*) FILTER (WHERE s.by_owner)::int AS owner_shares,
               public.has_role(s.profile_user_id, 'admin') AS admin
          FROM public.profile_shares s JOIN public.profiles p ON p.user_id = s.profile_user_id
         WHERE s.occurred_at >= since
         GROUP BY p.username, s.profile_user_id
         ORDER BY count(*) DESC LIMIT 10) x), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_profile_share_event(text, text, uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_profile_share_event(text, text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.my_share_stats(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_share_stats(integer) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_share_stats(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_share_stats(integer) TO authenticated;
