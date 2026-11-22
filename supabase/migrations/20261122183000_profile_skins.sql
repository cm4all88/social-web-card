-- Profile skins: animated effects (falling snow, autumn leaves, floating
-- hearts, twinkling stars) layered over a colour theme.
--
-- Additive: one nullable column, one flag row, three functions, and the
-- existing theme check extended to cover the column. Also rewords the reward
-- notification to point at the dashboard's Appearance tab. A skin has no unlock
-- rules of its own: each one shares the rules of one theme, so picking a
-- skin is allowed exactly when picking that theme would be.
--
-- profiles.skin: NULL = the theme's own effect, 'none' = no effect, or a
-- skin key (mirrors SKINS in src/lib/skins.ts).
--
-- Rollback: supabase/rollbacks/20261122183000_profile_skins.down.sql

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS skin text;
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_skin_format CHECK (skin IS NULL OR skin ~ '^[a-z_]{1,32}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.app_flags (key, enabled, note)
VALUES ('skins', false, 'Animated profile skins (snow, leaves, hearts, stars)')
ON CONFLICT (key) DO NOTHING;

-- The theme whose rules a skin shares (NULL for an unknown skin).
CREATE OR REPLACE FUNCTION public.skin_theme(_skin text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _skin
    WHEN 'snow' THEN 'snowfall'
    WHEN 'leaves' THEN 'harvest'
    WHEN 'hearts' THEN 'sweetheart'
    WHEN 'stars' THEN 'starlight'
  END
$$;

-- Why _user_id can't pick theme _theme right now: 'plus', 'season', 'earn',
-- or NULL when they can. The one place the theme rules live; themes and
-- skins both use it.
CREATE OR REPLACE FUNCTION public.theme_pick_block(_user_id uuid, _theme text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _reward text := public.theme_reward_key(_theme);
BEGIN
  IF public.theme_is_premium(_theme) AND public.current_plan(_user_id) <> 'plus' THEN
    RETURN 'plus';
  END IF;
  IF public.theme_season(_theme) IS NOT NULL
     AND NOT (public.app_flag_on('themes_rewards') AND public.theme_in_season(_theme)) THEN
    RETURN 'season';
  END IF;
  IF _reward IS NOT NULL
     AND public.current_plan(_user_id) <> 'plus'
     AND NOT (public.app_flag_on('themes_rewards') AND public.has_reward(_user_id, _reward)) THEN
    RETURN 'earn';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.theme_pick_block(uuid, text) FROM public, anon, authenticated;

-- For public pages: whether skins are on, and whether the creator has
-- earned the theme their picked skin belongs to.
CREATE OR REPLACE FUNCTION public.public_profile_skin_state(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'on', public.app_flag_on('skins'),
    'unlocked', coalesce((
      SELECT public.has_reward(p.user_id, public.theme_reward_key(public.skin_theme(p.skin)))
        FROM public.profiles p WHERE p.user_id = _user_id
    ), false)
  )
$$;
REVOKE ALL ON FUNCTION public.public_profile_skin_state(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.public_profile_skin_state(uuid) TO anon, authenticated;

-- The theme check, now also checking skins. Theme messages are unchanged.
CREATE OR REPLACE FUNCTION public.profiles_enforce_plus_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _theme_changed boolean := (TG_OP = 'INSERT' OR NEW.theme IS DISTINCT FROM OLD.theme);
  _skin_changed boolean := CASE WHEN TG_OP = 'INSERT' THEN NEW.skin IS NOT NULL
                                ELSE NEW.skin IS DISTINCT FROM OLD.skin END;
  _why text;
  _skin_theme text;
BEGIN
  IF NEW.hide_branding
     AND (TG_OP = 'INSERT' OR NOT OLD.hide_branding)
     AND public.current_plan(NEW.user_id) <> 'plus' THEN
    RAISE EXCEPTION 'Hiding Yooits branding is part of Plus.' USING ERRCODE = '42501';
  END IF;
  IF _theme_changed THEN
    _why := public.theme_pick_block(NEW.user_id, NEW.theme);
    IF _why = 'plus' THEN
      RAISE EXCEPTION 'This theme is part of Plus.' USING ERRCODE = '42501';
    ELSIF _why = 'season' THEN
      RAISE EXCEPTION 'This seasonal theme is out of season.' USING ERRCODE = '42501';
    ELSIF _why = 'earn' THEN
      RAISE EXCEPTION 'Earn this theme to use it.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _skin_changed AND NEW.skin IS NOT NULL AND NEW.skin <> 'none' THEN
    IF NOT public.app_flag_on('skins') THEN
      RAISE EXCEPTION 'Effects aren''t available yet.' USING ERRCODE = '42501';
    END IF;
    _skin_theme := public.skin_theme(NEW.skin);
    IF _skin_theme IS NULL THEN
      RAISE EXCEPTION 'Unknown effect.' USING ERRCODE = '22023';
    END IF;
    _why := public.theme_pick_block(NEW.user_id, _skin_theme);
    IF _why = 'plus' THEN
      RAISE EXCEPTION 'This effect is part of Plus.' USING ERRCODE = '42501';
    ELSIF _why = 'season' THEN
      RAISE EXCEPTION 'This effect is out of season.' USING ERRCODE = '42501';
    ELSIF _why = 'earn' THEN
      RAISE EXCEPTION 'Earn this effect to use it.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_plus_features ON public.profiles;
CREATE TRIGGER profiles_enforce_plus_features
  BEFORE INSERT OR UPDATE OF hide_branding, theme, skin ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_enforce_plus_features();

-- Reward notifications point to where themes now live: the dashboard's
-- Appearance tab (it was "Theme"). Same function, new wording and link.
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
          'It''s yours to use on your page. Pick it in Appearance on your dashboard.',
          '/dashboard#appearance', 'reward:' || _reward;
EXCEPTION WHEN OTHERS THEN
  -- A notification problem never stops a reward from being earned.
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_reward_unlocked(uuid, text) FROM public, anon, authenticated;
