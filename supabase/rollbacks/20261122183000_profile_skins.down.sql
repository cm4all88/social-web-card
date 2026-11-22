-- Rollback for 20261122183000_profile_skins.sql.
-- Puts the theme check and its trigger back as 20261122125000 left them,
-- drops the skin functions, the column (skin picks only; nothing else) and
-- the flag row.

DROP TRIGGER IF EXISTS profiles_enforce_plus_features ON public.profiles;

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

CREATE TRIGGER profiles_enforce_plus_features
  BEFORE INSERT OR UPDATE OF hide_branding, theme ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_enforce_plus_features();

DROP FUNCTION IF EXISTS public.public_profile_skin_state(uuid);
DROP FUNCTION IF EXISTS public.theme_pick_block(uuid, text);
DROP FUNCTION IF EXISTS public.skin_theme(text);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_skin_format;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS skin;
DELETE FROM public.app_flags WHERE key = 'skins';

-- Reward notification wording, as it was in 20261122125000.
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
