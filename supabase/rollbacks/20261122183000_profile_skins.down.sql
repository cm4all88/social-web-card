-- Rollback for 20261122183000_profile_skins.sql.
-- Puts the theme check and its trigger, claim_theme_rewards() and the reward
-- notification back as 20261122125000 left them; drops the skin and
-- background functions, the two columns (skin picks and background addresses
-- only; the photos stay in storage), the popular reward rows and the two
-- flag rows.

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

-- Custom backgrounds.
DROP FUNCTION IF EXISTS public.owner_remove_background(uuid, text);
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
DROP FUNCTION IF EXISTS public.background_allowed(uuid);
DROP FUNCTION IF EXISTS public.profile_view_count(uuid);
DROP FUNCTION IF EXISTS public.popular_view_threshold();
DELETE FROM public.user_rewards WHERE reward_key = 'popular';
ALTER TABLE public.user_rewards DROP CONSTRAINT IF EXISTS user_rewards_reward_key_check;
ALTER TABLE public.user_rewards ADD CONSTRAINT user_rewards_reward_key_check
  CHECK (reward_key IN ('profile_complete', 'five_links', 'first_share', 'first_wishlist', 'one_week'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_background_url_own_bucket;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS background_url;
DELETE FROM public.app_flags WHERE key = 'backgrounds';
