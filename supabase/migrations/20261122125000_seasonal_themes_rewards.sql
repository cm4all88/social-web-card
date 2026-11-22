-- Seasonal themes and rewards that unlock earned themes.
--
-- * Seasonal themes can be picked only while in season (month-day windows,
--   UTC, inclusive, may wrap the new year). A creator keeps the theme after
--   the season ends. Holiday Lights is also Plus-only.
-- * Rewards are earned by doing things on Yooits (finish the profile, 5 links,
--   first share, first wishlist, a week with a live page). Each unlocks one
--   earned theme. Plus includes every earned theme.
-- * The database decides what is earned: claim_theme_rewards() checks the
--   creator's own rows. Only the first share is reported by the dashboard.
-- * Everything new is behind the app flag 'themes_rewards' (off until verified).
--
-- Additive: two tables, functions, and a replacement of the Plus theme check
-- (same rules for Plus themes and hidden branding, plus the new kinds). No
-- existing row is changed. Mirrors src/lib/themes.ts and src/lib/rewards.ts.

-- ---------------------------------------------------------------------------
-- 1. App flags (readable by everyone, written by admins)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_flags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{1,64}$'),
  enabled boolean NOT NULL DEFAULT false,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads app flags" ON public.app_flags;
CREATE POLICY "Anyone reads app flags" ON public.app_flags FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage app flags" ON public.app_flags;
CREATE POLICY "Admins manage app flags" ON public.app_flags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_flags (key, enabled, note)
VALUES ('themes_rewards', false, 'Seasonal themes and rewards that unlock earned themes')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.app_flag_on(_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT enabled FROM public.app_flags WHERE key = _key), false)
$$;

-- ---------------------------------------------------------------------------
-- 2. Theme kinds
-- ---------------------------------------------------------------------------
-- Plus-only theme keys (mirrors PREMIUM_THEME_KEYS in src/lib/themes.ts).
CREATE OR REPLACE FUNCTION public.theme_is_premium(_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(_key IN ('aurora', 'obsidian', 'sakura', 'glacier', 'ember', 'gilded', 'holiday_lights'), false)
$$;

-- Seasonal window as 'MM-DD..MM-DD', or NULL (mirrors SEASONAL_THEME_PRESETS).
CREATE OR REPLACE FUNCTION public.theme_season(_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _key
    WHEN 'snowfall' THEN '11-20..02-28'
    WHEN 'holiday_lights' THEN '11-20..01-06'
    WHEN 'sweetheart' THEN '02-01..02-15'
    WHEN 'spring_bloom' THEN '03-15..05-31'
    WHEN 'summer_sun' THEN '06-01..08-31'
    WHEN 'harvest' THEN '09-15..11-19'
  END
$$;

CREATE OR REPLACE FUNCTION public.theme_in_season(_key text, _at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN public.theme_season(_key) IS NULL THEN false
    ELSE (
      WITH w AS (
        SELECT split_part(public.theme_season(_key), '..', 1) AS f,
               split_part(public.theme_season(_key), '..', 2) AS t,
               to_char(_at AT TIME ZONE 'UTC', 'MM-DD') AS md
      )
      SELECT CASE WHEN f <= t THEN md BETWEEN f AND t ELSE md >= f OR md <= t END FROM w
    )
  END
$$;

-- Reward that unlocks an earned theme, or NULL (mirrors REWARD_THEME_PRESETS).
CREATE OR REPLACE FUNCTION public.theme_reward_key(_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _key
    WHEN 'starlight' THEN 'profile_complete'
    WHEN 'prism' THEN 'five_links'
    WHEN 'confetti' THEN 'first_share'
    WHEN 'lagoon' THEN 'first_wishlist'
    WHEN 'golden_hour' THEN 'one_week'
  END
$$;

-- ---------------------------------------------------------------------------
-- 3. Rewards earned
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_rewards (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reward_key text NOT NULL CHECK (reward_key IN ('profile_complete', 'five_links', 'first_share', 'first_wishlist', 'one_week')),
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, reward_key)
);
ALTER TABLE public.user_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own rewards" ON public.user_rewards FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
-- No write policies: written only by the functions below.

CREATE OR REPLACE FUNCTION public.has_reward(_user_id uuid, _reward text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_rewards WHERE user_id = _user_id AND reward_key = _reward)
$$;
REVOKE ALL ON FUNCTION public.has_reward(uuid, text) FROM public, anon, authenticated;

-- Tells the creator about a newly earned reward through the dashboard
-- notifications (public.notify_user from the announcements migration). A no-op
-- while notify_user doesn't exist; a repeat is a no-op through the dedupe key.
CREATE OR REPLACE FUNCTION public.notify_reward_unlocked(_user_id uuid, _reward text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _theme text := CASE _reward
    WHEN 'profile_complete' THEN 'Starlight'
    WHEN 'five_links' THEN 'Prism'
    WHEN 'first_share' THEN 'Confetti'
    WHEN 'first_wishlist' THEN 'Lagoon'
    WHEN 'one_week' THEN 'Golden Hour'
  END;
BEGIN
  IF _theme IS NULL OR to_regprocedure('public.notify_user(uuid,text,text,text,text,text)') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT public.notify_user($1, $2, $3, $4, $5, $6)'
    USING _user_id, 'reward_unlocked',
          'You unlocked the ' || _theme || ' theme',
          'It''s yours to use on your page. Pick it under Theme in your dashboard.',
          '/dashboard', 'reward:' || _reward;
EXCEPTION WHEN OTHERS THEN
  -- A notification problem never stops a reward from being earned.
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_reward_unlocked(uuid, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.grant_reward(_user_id uuid, _reward text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n int;
BEGIN
  INSERT INTO public.user_rewards (user_id, reward_key) VALUES (_user_id, _reward)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n > 0 THEN
    PERFORM public.notify_reward_unlocked(_user_id, _reward);
  END IF;
  RETURN _n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_reward(uuid, text) FROM public, anon, authenticated;

-- Checks the signed-in creator's own rows and records anything newly earned.
-- Returns {"enabled": bool, "unlocked": [...], "new": [...]}.
CREATE OR REPLACE FUNCTION public.claim_theme_rewards()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _new text[] := '{}';
  _p public.profiles%ROWTYPE;
  _live_links int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF public.app_flag_on('themes_rewards') THEN
    SELECT * INTO _p FROM public.profiles WHERE user_id = _uid;
    SELECT count(*) INTO _live_links FROM public.social_links
     WHERE user_id = _uid AND enabled AND btrim(url) <> '';

    IF _p.user_id IS NOT NULL
       AND btrim(coalesce(_p.display_name, '')) <> ''
       AND btrim(coalesce(_p.bio, '')) <> ''
       AND btrim(coalesce(_p.avatar_url, '')) <> ''
       AND public.grant_reward(_uid, 'profile_complete') THEN
      _new := array_append(_new, 'profile_complete');
    END IF;
    IF _live_links >= 5 AND public.grant_reward(_uid, 'five_links') THEN
      _new := array_append(_new, 'five_links');
    END IF;
    IF EXISTS (SELECT 1 FROM public.wishlists w JOIN public.wishlist_items i ON i.wishlist_id = w.id
                WHERE w.user_id = _uid)
       AND public.grant_reward(_uid, 'first_wishlist') THEN
      _new := array_append(_new, 'first_wishlist');
    END IF;
    IF _p.user_id IS NOT NULL AND _p.created_at <= now() - interval '7 days' AND _live_links >= 1
       AND public.grant_reward(_uid, 'one_week') THEN
      _new := array_append(_new, 'one_week');
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.app_flag_on('themes_rewards'),
    'unlocked', coalesce((SELECT jsonb_agg(reward_key ORDER BY unlocked_at) FROM public.user_rewards WHERE user_id = _uid), '[]'::jsonb),
    'new', to_jsonb(_new)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_theme_rewards() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_theme_rewards() TO authenticated;

-- The dashboard reports the creator's first share of their own link.
CREATE OR REPLACE FUNCTION public.record_profile_share()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.app_flag_on('themes_rewards') THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid()) THEN
    RETURN false;
  END IF;
  RETURN public.grant_reward(auth.uid(), 'first_share');
END;
$$;
REVOKE ALL ON FUNCTION public.record_profile_share() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_profile_share() TO authenticated;

-- For public pages: whether the creator has earned the theme they picked.
CREATE OR REPLACE FUNCTION public.public_profile_theme_unlocked(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT public.has_reward(p.user_id, public.theme_reward_key(p.theme))
      FROM public.profiles p WHERE p.user_id = _user_id
  ), false)
$$;
REVOKE ALL ON FUNCTION public.public_profile_theme_unlocked(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.public_profile_theme_unlocked(uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Theme check: Plus themes need Plus, seasonal themes need their season,
--    earned themes need their reward (or Plus). Hidden branding unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_enforce_plus_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _changed boolean := (TG_OP = 'INSERT' OR NEW.theme IS DISTINCT FROM OLD.theme);
  _reward text := public.theme_reward_key(NEW.theme);
BEGIN
  IF NEW.hide_branding
     AND (TG_OP = 'INSERT' OR NOT OLD.hide_branding)
     AND public.current_plan(NEW.user_id) <> 'plus' THEN
    RAISE EXCEPTION 'Hiding Yooits branding is part of Plus.' USING ERRCODE = '42501';
  END IF;
  IF NOT _changed THEN
    RETURN NEW;
  END IF;
  IF public.theme_is_premium(NEW.theme) AND public.current_plan(NEW.user_id) <> 'plus' THEN
    RAISE EXCEPTION 'This theme is part of Plus.' USING ERRCODE = '42501';
  END IF;
  IF public.theme_season(NEW.theme) IS NOT NULL
     AND NOT (public.app_flag_on('themes_rewards') AND public.theme_in_season(NEW.theme)) THEN
    RAISE EXCEPTION 'This seasonal theme is out of season.' USING ERRCODE = '42501';
  END IF;
  IF _reward IS NOT NULL
     AND public.current_plan(NEW.user_id) <> 'plus'
     AND NOT (public.app_flag_on('themes_rewards') AND public.has_reward(NEW.user_id, _reward)) THEN
    RAISE EXCEPTION 'Earn this theme to use it.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
-- The trigger from 20261122120000_plus_billing.sql already calls this function.
