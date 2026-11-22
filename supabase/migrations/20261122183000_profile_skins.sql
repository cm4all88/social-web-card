-- Profile skins: animated effects (falling snow, autumn leaves, floating
-- hearts, twinkling stars) layered over a colour theme. And custom
-- backgrounds: a creator's own photo behind their page, unlocked by the
-- "popular" reward (1,000 profile views) or included with Plus.
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

-- Custom background: a photo in the creator's own folder of the avatars
-- bucket, so it has the bucket's limits (images only, 5 MB) and its rules
-- (own folder only, nothing for suspended accounts, hidden pages unlisted).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS background_url text;
DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_background_url_own_bucket CHECK (
      background_url IS NULL OR (
        char_length(background_url) <= 1024
        AND background_url ~ (
          '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/'
          || user_id::text || '/[A-Za-z0-9._-]+$'
        )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.app_flags (key, enabled, note)
VALUES ('backgrounds', false, 'Custom profile backgrounds (popular reward or Plus)')
ON CONFLICT (key) DO NOTHING;

-- The "popular" reward: 1,000 profile views, for now.
ALTER TABLE public.user_rewards DROP CONSTRAINT IF EXISTS user_rewards_reward_key_check;
ALTER TABLE public.user_rewards ADD CONSTRAINT user_rewards_reward_key_check
  CHECK (reward_key IN ('profile_complete', 'five_links', 'first_share', 'first_wishlist', 'one_week', 'popular'));

-- The two places the popular reward is defined. To move it onto the creator
-- milestones (qualifying unique visitors, configurable thresholds), replace
-- these two functions; nothing else reads views or the number directly.
--
-- How many views unlock it.
CREATE OR REPLACE FUNCTION public.popular_view_threshold()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 1000
$$;
GRANT EXECUTE ON FUNCTION public.popular_view_threshold() TO anon, authenticated;

-- Profile views a creator's page has had (deduplicated as analytics records them).
CREATE OR REPLACE FUNCTION public.profile_view_count(_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) FROM public.analytics_events
   WHERE profile_user_id = _user_id AND kind = 'profile_view'
$$;
REVOKE ALL ON FUNCTION public.profile_view_count(uuid) FROM public, anon, authenticated;

-- Whether _user_id may show a custom background: the flag is on and they
-- have Plus or the popular reward.
CREATE OR REPLACE FUNCTION public.background_allowed(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.app_flag_on('backgrounds')
     AND (public.current_plan(_user_id) = 'plus' OR public.has_reward(_user_id, 'popular'))
$$;
REVOKE ALL ON FUNCTION public.background_allowed(uuid) FROM public, anon, authenticated;

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

-- For public pages: whether skins are on, whether the creator has earned
-- the theme their picked skin belongs to, and whether their custom
-- background may show.
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
    ), false),
    'backgrounds_on', public.app_flag_on('backgrounds'),
    'background', public.background_allowed(_user_id)
  )
$$;
REVOKE ALL ON FUNCTION public.public_profile_skin_state(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.public_profile_skin_state(uuid) TO anon, authenticated;

-- The theme check, now also checking skins and backgrounds. Theme messages
-- are unchanged.
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
      RAISE EXCEPTION 'Custom backgrounds unlock at % profile views, or with Plus.',
        to_char(public.popular_view_threshold(), 'FM999,999,999') USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_plus_features ON public.profiles;
CREATE TRIGGER profiles_enforce_plus_features
  BEFORE INSERT OR UPDATE OF hide_branding, theme, skin, background_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_enforce_plus_features();

-- Reward notifications point to where themes now live: the dashboard's
-- Appearance tab (it was "Theme"), and cover the popular reward.
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
             || ' views. Add your own photo behind it in Appearance on your dashboard.';
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

-- Checks the signed-in creator's own rows and records anything newly earned.
-- Returns {"enabled": bool, "unlocked": [...], "new": [...], "profile_views": n}.
-- Now also grants "popular" at popular_view_threshold() profile views (while
-- backgrounds are on), and says the threshold as "popular_at".
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
  _views bigint := 0;
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
  IF public.app_flag_on('backgrounds') THEN
    _views := public.profile_view_count(_uid);
    IF _views >= public.popular_view_threshold() AND public.grant_reward(_uid, 'popular') THEN
      _new := array_append(_new, 'popular');
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.app_flag_on('themes_rewards'),
    'unlocked', coalesce((SELECT jsonb_agg(reward_key ORDER BY unlocked_at) FROM public.user_rewards WHERE user_id = _uid), '[]'::jsonb),
    'new', to_jsonb(_new),
    'profile_views', _views,
    'popular_at', public.popular_view_threshold()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_theme_rewards() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_theme_rewards() TO authenticated;

-- Admins can take a custom background off a page (after a report, say).
-- The photo stops showing at once; the action and reason go in the audit log.
CREATE OR REPLACE FUNCTION public.owner_remove_background(_user_id uuid, _reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
  _old text;
BEGIN
  PERFORM public.owner_require_admin();
  PERFORM public.owner_assert_user_exists(_user_id);
  r := public.owner_clean_reason(_reason);
  SELECT background_url INTO _old FROM public.profiles WHERE user_id = _user_id;
  IF _old IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.profiles SET background_url = NULL WHERE user_id = _user_id;
  PERFORM public.write_admin_audit('background.removed', 'user', _user_id::text,
                                   jsonb_build_object('reason', r, 'background_url', _old));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_remove_background(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_remove_background(uuid, text) TO authenticated;
