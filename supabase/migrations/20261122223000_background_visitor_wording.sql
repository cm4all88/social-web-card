-- Custom backgrounds unlock from real visitors (creator milestones, see
-- 20261122220000_backgrounds_from_creator_milestones.sql), so the wording says
-- visitors, not profile views. The number still comes from
-- popular_view_threshold(), which the owner edits in Owner > Creators.
-- Text only: no data changes.
--
-- Rollback: supabase/rollbacks/20261122223000_background_visitor_wording.down.sql

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
  _bg_changed boolean := CASE WHEN TG_OP = 'INSERT' THEN NEW.background_url IS NOT NULL
                              ELSE NEW.background_url IS DISTINCT FROM OLD.background_url END;
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
  -- Removing a background is always allowed; adding or changing one needs it unlocked.
  IF _bg_changed AND NEW.background_url IS NOT NULL THEN
    IF NOT public.app_flag_on('backgrounds') THEN
      RAISE EXCEPTION 'Custom backgrounds aren''t available yet.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.background_allowed(NEW.user_id) THEN
      RAISE EXCEPTION 'Custom backgrounds unlock at % visitors to your page, or with Plus.',
        to_char(public.popular_view_threshold(), 'FM999,999,999') USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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
  _title text;
  _body text;
BEGIN
  IF _reward = 'popular' THEN
    _title := 'You unlocked custom backgrounds';
    _body := 'Your page reached ' || to_char(public.popular_view_threshold(), 'FM999,999,999')
             || ' visitors. Add your own photo behind it in Appearance on your dashboard.';
  ELSIF _theme IS NOT NULL THEN
    _title := 'You unlocked the ' || _theme || ' theme';
    _body := 'It''s yours to use on your page. Pick it in Appearance on your dashboard.';
  END IF;
  IF _title IS NULL OR to_regprocedure('public.notify_user(uuid,text,text,text,text,text)') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT public.notify_user($1, $2, $3, $4, $5, $6)'
    USING _user_id, 'reward_unlocked', _title, _body, '/dashboard#appearance', 'reward:' || _reward;
EXCEPTION WHEN OTHERS THEN
  -- A notification problem never stops a reward from being earned.
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_reward_unlocked(uuid, text) FROM public, anon, authenticated;
