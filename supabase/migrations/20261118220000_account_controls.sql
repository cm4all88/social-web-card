-- Owner account controls: unpublish a page, suspend an account, turn off tips.
--
-- Three separate switches, each with a reason, a time and the admin who set it:
--   * Unpublished: the public page, its links and its wishlists stop being
--     visible to anyone but the owner and Yooits admins. Nothing is deleted
--     and the owner can still sign in and edit.
--   * Suspended: everything "unpublished" does, and the account can no longer
--     change its page, links, wishlists, tip settings or avatar, or take tips.
--     Nothing is deleted; the owner can still sign in and see their data.
--   * Tips off: no new tips or Stripe onboarding for that creator. This is the
--     same switch as the existing "stop tips" control on the Money page.
--
-- Enforcement lives in the database (RESTRICTIVE row-level security policies
-- layered on top of the existing ones, which are left untouched) and in the
-- tipping server code, which reads the same flags.
-- Every change is written to admin_audit_log by a trigger.

-- ---------------------------------------------------------------------------
-- State
-- ---------------------------------------------------------------------------
CREATE TABLE public.account_status (
  user_id uuid PRIMARY KEY,
  unpublished_at timestamptz,
  unpublished_reason text CHECK (unpublished_reason IS NULL OR char_length(unpublished_reason) <= 200),
  unpublished_by uuid,
  suspended_at timestamptz,
  suspended_reason text CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 200),
  suspended_by uuid,
  tips_disabled_at timestamptz,
  tips_disabled_reason text CHECK (tips_disabled_reason IS NULL OR char_length(tips_disabled_reason) <= 200),
  tips_disabled_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_status ENABLE ROW LEVEL SECURITY;

-- Owners see their own status (so the dashboard can explain it); admins see all.
-- No write policies: only the owner_* functions below change it.
CREATE POLICY "Users view own account status"
  ON public.account_status FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER account_status_updated_at
  BEFORE UPDATE ON public.account_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Carry over any creator whose tips were already stopped, so both places agree.
-- (Done before the audit trigger exists: these were logged when they happened.)
INSERT INTO public.account_status (user_id, tips_disabled_at, tips_disabled_reason)
SELECT a.user_id, a.tipping_suspended_at, a.tipping_suspended_reason
  FROM public.creator_payment_accounts a
 WHERE a.tipping_suspended_at IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
  SET tips_disabled_at = EXCLUDED.tips_disabled_at,
      tips_disabled_reason = EXCLUDED.tips_disabled_reason;

-- Visible to the public? (No status row means yes.)
CREATE OR REPLACE FUNCTION public.profile_is_public(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.account_status s
     WHERE s.user_id = _user_id
       AND (s.unpublished_at IS NOT NULL OR s.suspended_at IS NOT NULL)
  )
$$;

CREATE OR REPLACE FUNCTION public.account_is_suspended(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_status s
     WHERE s.user_id = _user_id AND s.suspended_at IS NOT NULL
  )
$$;

-- Can this creator take tips at all, as far as Yooits' own switches go?
-- (Stripe readiness and eligibility are checked separately, as before.)
CREATE OR REPLACE FUNCTION public.tips_allowed(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.account_status s
     WHERE s.user_id = _user_id
       AND (s.unpublished_at IS NOT NULL OR s.suspended_at IS NOT NULL OR s.tips_disabled_at IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.creator_payment_accounts a
     WHERE a.user_id = _user_id AND a.tipping_suspended_at IS NOT NULL
  )
$$;

GRANT EXECUTE ON FUNCTION public.profile_is_public(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_is_suspended(uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.tips_allowed(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tips_allowed(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Public visibility (RESTRICTIVE: combined with AND on top of existing rules)
-- ---------------------------------------------------------------------------
CREATE POLICY "Hidden pages are visible only to owner and admins"
  ON public.profiles AS RESTRICTIVE FOR SELECT
  USING (public.profile_is_public(user_id) OR user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Links of hidden pages are visible only to owner and admins"
  ON public.social_links AS RESTRICTIVE FOR SELECT
  USING (public.profile_is_public(user_id) OR user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Wishlists of hidden pages are visible only to owner and admins"
  ON public.wishlists AS RESTRICTIVE FOR SELECT
  USING (public.profile_is_public(user_id) OR user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Wishlist items of hidden pages are visible only to owner and admins"
  ON public.wishlist_items AS RESTRICTIVE FOR SELECT
  USING (public.profile_is_public(user_id) OR user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Suspended accounts can't change anything (RESTRICTIVE, writes only)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'social_links', 'wishlists', 'wishlist_items', 'tip_settings'] LOOP
    EXECUTE format(
      'CREATE POLICY "Suspended accounts cannot insert" ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
         WITH CHECK (NOT public.account_is_suspended(auth.uid()))', t);
    EXECUTE format(
      'CREATE POLICY "Suspended accounts cannot update" ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
         USING (NOT public.account_is_suspended(auth.uid()))
         WITH CHECK (NOT public.account_is_suspended(auth.uid()))', t);
    EXECUTE format(
      'CREATE POLICY "Suspended accounts cannot delete" ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
         USING (NOT public.account_is_suspended(auth.uid()))', t);
  END LOOP;
END $$;

CREATE POLICY "Suspended accounts cannot upload avatars"
  ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'avatars' OR NOT public.account_is_suspended(auth.uid()));
CREATE POLICY "Suspended accounts cannot change avatars"
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'avatars' OR NOT public.account_is_suspended(auth.uid()));
CREATE POLICY "Suspended accounts cannot delete avatars"
  ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'avatars' OR NOT public.account_is_suspended(auth.uid()));

-- The avatars bucket lets anyone list its files. Hide the files of unpublished
-- and suspended accounts from listing and authenticated downloads, so they
-- can't be found again. (A public image address someone already saved keeps
-- working while the bucket is public; that needs a bucket setting change.)
CREATE OR REPLACE FUNCTION public.avatar_is_visible(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN split_part(_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    ELSE public.profile_is_public(split_part(_name, '/', 1)::uuid)
      OR split_part(_name, '/', 1)::uuid = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
  END
$$;
GRANT EXECUTE ON FUNCTION public.avatar_is_visible(text) TO anon, authenticated;

CREATE POLICY "Avatars of hidden pages are not listed"
  ON storage.objects AS RESTRICTIVE FOR SELECT
  USING (bucket_id <> 'avatars' OR public.avatar_is_visible(name));

-- ---------------------------------------------------------------------------
-- Audit (reuses admin_audit_log from the owner console migration)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.account_status;
BEGIN
  IF TG_OP = 'INSERT' THEN
    o := ROW(NEW.user_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, now())::public.account_status;
  ELSE
    o := OLD;
  END IF;
  IF o.unpublished_at IS NULL AND NEW.unpublished_at IS NOT NULL THEN
    PERFORM public.write_admin_audit('account.unpublished', 'user', NEW.user_id::text,
      jsonb_build_object('reason', NEW.unpublished_reason));
  ELSIF o.unpublished_at IS NOT NULL AND NEW.unpublished_at IS NULL THEN
    PERFORM public.write_admin_audit('account.republished', 'user', NEW.user_id::text);
  END IF;
  IF o.suspended_at IS NULL AND NEW.suspended_at IS NOT NULL THEN
    PERFORM public.write_admin_audit('account.suspended', 'user', NEW.user_id::text,
      jsonb_build_object('reason', NEW.suspended_reason));
  ELSIF o.suspended_at IS NOT NULL AND NEW.suspended_at IS NULL THEN
    PERFORM public.write_admin_audit('account.reactivated', 'user', NEW.user_id::text);
  END IF;
  IF o.tips_disabled_at IS NULL AND NEW.tips_disabled_at IS NOT NULL THEN
    PERFORM public.write_admin_audit('tipping.suspended', 'user', NEW.user_id::text,
      jsonb_build_object('reason', NEW.tips_disabled_reason));
  ELSIF o.tips_disabled_at IS NOT NULL AND NEW.tips_disabled_at IS NULL THEN
    PERFORM public.write_admin_audit('tipping.restored', 'user', NEW.user_id::text);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER account_status_audit
  AFTER INSERT OR UPDATE ON public.account_status
  FOR EACH ROW EXECUTE FUNCTION public.audit_account_status();

-- Tips are now logged once, from account_status (see owner_set_tips_disabled).
DROP TRIGGER IF EXISTS creator_payment_accounts_audit_suspension ON public.creator_payment_accounts;

-- ---------------------------------------------------------------------------
-- Owner actions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_clean_reason(_reason text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  r text := left(btrim(regexp_replace(coalesce(_reason, ''), '[[:cntrl:]]+', ' ', 'g')), 200);
BEGIN
  IF char_length(r) < 3 THEN
    RAISE EXCEPTION 'Please give a short reason (at least 3 characters).' USING ERRCODE = '22023';
  END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_assert_user_exists(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'No account with that id.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_clean_reason(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_assert_user_exists(uuid) FROM public, anon, authenticated;

-- Unpublish or republish a page. Returns the new state.
CREATE OR REPLACE FUNCTION public.owner_set_unpublished(_user_id uuid, _unpublished boolean, _reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  PERFORM public.owner_require_admin();
  PERFORM public.owner_assert_user_exists(_user_id);
  IF _unpublished THEN
    r := public.owner_clean_reason(_reason);
    INSERT INTO public.account_status AS s (user_id, unpublished_at, unpublished_reason, unpublished_by)
    VALUES (_user_id, now(), r, auth.uid())
    ON CONFLICT (user_id) DO UPDATE
      SET unpublished_at = coalesce(s.unpublished_at, now()),
          unpublished_reason = r,
          unpublished_by = auth.uid();
  ELSE
    UPDATE public.account_status
       SET unpublished_at = NULL, unpublished_reason = NULL, unpublished_by = NULL
     WHERE user_id = _user_id;
  END IF;
  RETURN _unpublished;
END;
$$;

-- Suspend or reactivate an account. Admin accounts (including your own) can't
-- be suspended: remove their admin access first. That keeps an admin from
-- locking themselves or the last admin out.
CREATE OR REPLACE FUNCTION public.owner_set_suspended(_user_id uuid, _suspended boolean, _reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  PERFORM public.owner_require_admin();
  PERFORM public.owner_assert_user_exists(_user_id);
  IF _suspended THEN
    IF _user_id = auth.uid() THEN
      RAISE EXCEPTION 'You can''t suspend your own account.' USING ERRCODE = '42501';
    END IF;
    IF public.has_role(_user_id, 'admin') THEN
      RAISE EXCEPTION 'Admin accounts can''t be suspended. Remove their admin access first.' USING ERRCODE = '42501';
    END IF;
    r := public.owner_clean_reason(_reason);
    INSERT INTO public.account_status AS s (user_id, suspended_at, suspended_reason, suspended_by)
    VALUES (_user_id, now(), r, auth.uid())
    ON CONFLICT (user_id) DO UPDATE
      SET suspended_at = coalesce(s.suspended_at, now()),
          suspended_reason = r,
          suspended_by = auth.uid();
    -- Stop tips from showing on the profile right away; restored by the owner later.
    UPDATE public.tip_settings SET enabled = false WHERE user_id = _user_id;
  ELSE
    UPDATE public.account_status
       SET suspended_at = NULL, suspended_reason = NULL, suspended_by = NULL
     WHERE user_id = _user_id;
  END IF;
  RETURN _suspended;
END;
$$;

-- Turn tips off or back on for one creator, whether or not they've connected
-- Stripe yet. Keeps the payment account's own flag in step, so the creator's
-- dashboard and the existing checks see the same thing.
CREATE OR REPLACE FUNCTION public.owner_set_tips_disabled(_user_id uuid, _disabled boolean, _reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  PERFORM public.owner_require_admin();
  PERFORM public.owner_assert_user_exists(_user_id);
  IF _disabled THEN
    r := public.owner_clean_reason(_reason);
    INSERT INTO public.account_status AS s (user_id, tips_disabled_at, tips_disabled_reason, tips_disabled_by)
    VALUES (_user_id, now(), r, auth.uid())
    ON CONFLICT (user_id) DO UPDATE
      SET tips_disabled_at = coalesce(s.tips_disabled_at, now()),
          tips_disabled_reason = r,
          tips_disabled_by = auth.uid();
    UPDATE public.creator_payment_accounts
       SET tipping_suspended_at = coalesce(tipping_suspended_at, now()),
           tipping_suspended_reason = r
     WHERE user_id = _user_id;
    UPDATE public.tip_settings SET enabled = false WHERE user_id = _user_id;
  ELSE
    UPDATE public.account_status
       SET tips_disabled_at = NULL, tips_disabled_reason = NULL, tips_disabled_by = NULL
     WHERE user_id = _user_id;
    UPDATE public.creator_payment_accounts
       SET tipping_suspended_at = NULL, tipping_suspended_reason = NULL
     WHERE user_id = _user_id;
  END IF;
  RETURN _disabled;
END;
$$;

-- The Money page's existing "stop tips" control now goes through the same
-- switch. Same signature; returns false only when the username isn't found.
CREATE OR REPLACE FUNCTION public.admin_set_tip_suspension(
  _username text,
  _suspended boolean,
  _reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT user_id INTO v_user FROM public.profiles WHERE username = lower(btrim(_username));
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  PERFORM public.owner_set_tips_disabled(v_user, _suspended,
    CASE WHEN _suspended THEN coalesce(nullif(btrim(_reason), ''), 'Stopped from the Money page') END);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_set_unpublished(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_suspended(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_tips_disabled(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_unpublished(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_suspended(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_tips_disabled(uuid, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Owner reads now include the account's status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_account_status_json(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'unpublished_at', s.unpublished_at, 'unpublished_reason', s.unpublished_reason,
    'unpublished_by', (SELECT p.username FROM public.profiles p WHERE p.user_id = s.unpublished_by),
    'suspended_at', s.suspended_at, 'suspended_reason', s.suspended_reason,
    'suspended_by', (SELECT p.username FROM public.profiles p WHERE p.user_id = s.suspended_by),
    'tips_disabled_at', s.tips_disabled_at, 'tips_disabled_reason', s.tips_disabled_reason,
    'tips_disabled_by', (SELECT p.username FROM public.profiles p WHERE p.user_id = s.tips_disabled_by)
  )
  FROM public.account_status s WHERE s.user_id = _user_id
$$;

REVOKE ALL ON FUNCTION public.owner_account_status_json(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_get_user(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT jsonb_build_object(
    'user_id', u.id,
    'email', u.email,
    'created_at', u.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'email_confirmed', u.email_confirmed_at IS NOT NULL,
    'is_self', u.id = auth.uid(),
    'profile', (SELECT jsonb_build_object('username', p.username, 'display_name', p.display_name,
                                          'bio', p.bio, 'avatar_url', p.avatar_url, 'theme', p.theme)
                  FROM public.profiles p WHERE p.user_id = u.id),
    'roles', coalesce((SELECT jsonb_agg(r.role::text ORDER BY r.role) FROM public.user_roles r
                        WHERE r.user_id = u.id), '[]'::jsonb),
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object('platform', l.platform, 'url', l.url,
                                                           'enabled', l.enabled)
                                        ORDER BY l.display_order)
                         FROM public.social_links l WHERE l.user_id = u.id), '[]'::jsonb),
    'wishlists', (SELECT count(*) FROM public.wishlists w WHERE w.user_id = u.id),
    'tipping', (SELECT jsonb_build_object('status', a.status, 'charges_enabled', a.charges_enabled,
                                          'payouts_enabled', a.payouts_enabled,
                                          'suspended_at', a.tipping_suspended_at,
                                          'suspended_reason', a.tipping_suspended_reason)
                  FROM public.creator_payment_accounts a WHERE a.user_id = u.id),
    'status', public.owner_account_status_json(u.id)
  ) INTO result
  FROM auth.users u
  WHERE u.id = _user_id;
  RETURN result;
END;
$$;

DROP FUNCTION IF EXISTS public.owner_list_users(text, integer, integer);
CREATE FUNCTION public.owner_list_users(
  _search text DEFAULT NULL,
  _limit integer DEFAULT 25,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed boolean,
  link_count bigint,
  is_admin boolean,
  unpublished boolean,
  suspended boolean,
  tips_disabled boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pattern text := CASE
    WHEN nullif(btrim(coalesce(_search, '')), '') IS NULL THEN NULL
    ELSE '%' || replace(replace(replace(left(btrim(_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  END;
BEGIN
  PERFORM public.owner_require_admin();
  RETURN QUERY
  WITH matched AS (
    SELECT u.id, p.username, p.display_name, u.email::text AS email, u.created_at,
           u.last_sign_in_at, (u.email_confirmed_at IS NOT NULL) AS email_confirmed
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.user_id = u.id
     WHERE pattern IS NULL
        OR p.username ILIKE pattern ESCAPE '\'
        OR p.display_name ILIKE pattern ESCAPE '\'
        OR u.email ILIKE pattern ESCAPE '\'
  )
  SELECT m.id, m.username, m.display_name, m.email, m.created_at, m.last_sign_in_at,
         m.email_confirmed,
         (SELECT count(*) FROM public.social_links l WHERE l.user_id = m.id),
         EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = m.id AND r.role = 'admin'),
         coalesce(s.unpublished_at IS NOT NULL, false),
         coalesce(s.suspended_at IS NOT NULL, false),
         coalesce(s.tips_disabled_at IS NOT NULL, false),
         count(*) OVER ()
    FROM matched m
    LEFT JOIN public.account_status s ON s.user_id = m.id
   ORDER BY m.created_at DESC, m.id
   LIMIT least(greatest(coalesce(_limit, 25), 1), 100)
  OFFSET greatest(coalesce(_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_list_users(text, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_users(text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT jsonb_build_object(
    'total_users', (SELECT count(*) FROM auth.users),
    'signups_7d', (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '7 days'),
    'signups_30d', (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '30 days'),
    'unconfirmed_emails', (SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NULL),
    'profiles_with_links', (SELECT count(DISTINCT user_id) FROM public.social_links
                              WHERE enabled AND url <> ''),
    'admins', (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role = 'admin'),
    'open_invites', (SELECT count(*) FROM public.invites WHERE used_by IS NULL),
    'connected_creators', (SELECT count(*) FROM public.creator_payment_accounts WHERE status = 'connected'),
    'tipping_suspended', (SELECT count(*) FROM public.account_status WHERE tips_disabled_at IS NOT NULL),
    'public_wishlists', (SELECT count(*) FROM public.wishlists WHERE visibility = 'public'),
    'unpublished', (SELECT count(*) FROM public.account_status WHERE unpublished_at IS NOT NULL),
    'suspended', (SELECT count(*) FROM public.account_status WHERE suspended_at IS NOT NULL)
  ) INTO result;
  RETURN result;
END;
$$;
