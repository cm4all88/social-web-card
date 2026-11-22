-- Rollback for 20261122125000_seasonal_themes_rewards.sql.
-- Earned rewards are dropped with the table (they are only theme unlocks, not
-- payments). Profiles that picked a new theme keep the key; the page then
-- shows the default theme for it. Puts the Plus theme check and
-- theme_is_premium back exactly as 20261122120000_plus_billing.sql left them.

CREATE OR REPLACE FUNCTION public.profiles_enforce_plus_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hide_branding
     AND (TG_OP = 'INSERT' OR NOT OLD.hide_branding)
     AND public.current_plan(NEW.user_id) <> 'plus' THEN
    RAISE EXCEPTION 'Hiding Yooits branding is part of Plus.' USING ERRCODE = '42501';
  END IF;
  IF public.theme_is_premium(NEW.theme)
     AND (TG_OP = 'INSERT' OR NEW.theme IS DISTINCT FROM OLD.theme)
     AND public.current_plan(NEW.user_id) <> 'plus' THEN
    RAISE EXCEPTION 'This theme is part of Plus.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.theme_is_premium(_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(_key IN ('aurora', 'obsidian', 'sakura', 'glacier', 'ember', 'gilded'), false)
$$;

DROP FUNCTION IF EXISTS public.public_profile_theme_unlocked(uuid);
DROP FUNCTION IF EXISTS public.record_profile_share();
DROP FUNCTION IF EXISTS public.claim_theme_rewards();
DROP FUNCTION IF EXISTS public.grant_reward(uuid, text);
DROP FUNCTION IF EXISTS public.notify_reward_unlocked(uuid, text);
DROP FUNCTION IF EXISTS public.has_reward(uuid, text);
DROP TABLE IF EXISTS public.user_rewards;
DROP FUNCTION IF EXISTS public.theme_reward_key(text);
DROP FUNCTION IF EXISTS public.theme_in_season(text, timestamptz);
DROP FUNCTION IF EXISTS public.theme_season(text);
-- app_flags stays: other features may use it. Only this feature's row goes.
DELETE FROM public.app_flags WHERE key = 'themes_rewards';
