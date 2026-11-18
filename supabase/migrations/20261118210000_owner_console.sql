-- Owner console, first step (read-mostly).
--
-- * admin_audit_log: an append-only record of owner actions. Rows are written
--   only by the database itself (triggers below), so every path is covered:
--   the owner console, the SQL editor and any future server code alike.
-- * owner_* functions: what /owner reads. Each one checks has_role(admin)
--   inside the database, so the browser can't widen what it sees.
--
-- Nothing here changes who is an admin, what creators can do, or any public
-- page. Account restrictions (unpublish/suspend) are deliberately not here yet.

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
CREATE TABLE public.admin_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- auth.uid() of whoever made the change; NULL when it came from the
  -- database console, a migration or a background job.
  actor_user_id uuid,
  action text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$' AND char_length(action) <= 60),
  target_type text NOT NULL CHECK (char_length(target_type) BETWEEN 1 AND 40),
  target_id text CHECK (target_id IS NULL OR char_length(target_id) <= 100),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_log_created ON public.admin_audit_log (created_at DESC, id DESC);
CREATE INDEX idx_admin_audit_log_target ON public.admin_audit_log (target_type, target_id);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read the audit log"
  ON public.admin_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- No INSERT/UPDATE/DELETE policies: browsers can't write it.

-- Append-only, even for privileged database roles. A later migration can add
-- a retention job if the log ever needs trimming.
CREATE OR REPLACE FUNCTION public.admin_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'The admin audit log is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER admin_audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_append_only();

CREATE TRIGGER admin_audit_log_no_truncate
  BEFORE TRUNCATE ON public.admin_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.admin_audit_log_append_only();

-- Internal helper for the triggers below. Not callable from the API.
CREATE OR REPLACE FUNCTION public.write_admin_audit(
  _action text,
  _target_type text,
  _target_id text,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_audit_log (actor_user_id, action, target_type, target_id, details)
  VALUES (auth.uid(), _action, _target_type, _target_id, coalesce(_details, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.write_admin_audit(text, text, text, jsonb) FROM public, anon, authenticated;

-- Admin role granted or removed. Ordinary 'user' roles (one per signup) are
-- not logged, to keep the log about owner actions.
CREATE OR REPLACE FUNCTION public.audit_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.role = 'admin' THEN
    PERFORM public.write_admin_audit('role.granted', 'user', NEW.user_id::text,
      jsonb_build_object('role', NEW.role::text));
  ELSIF TG_OP = 'DELETE' AND OLD.role = 'admin' THEN
    PERFORM public.write_admin_audit('role.revoked', 'user', OLD.user_id::text,
      jsonb_build_object('role', OLD.role::text));
  ELSIF TG_OP = 'UPDATE' AND (OLD.role = 'admin' OR NEW.role = 'admin')
        AND (OLD.role IS DISTINCT FROM NEW.role OR OLD.user_id IS DISTINCT FROM NEW.user_id) THEN
    PERFORM public.write_admin_audit('role.changed', 'user', NEW.user_id::text,
      jsonb_build_object('from_role', OLD.role::text, 'to_role', NEW.role::text,
                         'from_user', OLD.user_id::text));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER user_roles_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_roles();

-- Invite codes created or revoked. The code itself is a sign-up credential,
-- so it is never copied into the log.
CREATE OR REPLACE FUNCTION public.audit_invites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.write_admin_audit('invite.created', 'invite', NEW.id::text);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.write_admin_audit('invite.revoked', 'invite', OLD.id::text,
      jsonb_build_object('was_used', OLD.used_by IS NOT NULL));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER invites_audit
  AFTER INSERT OR DELETE ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.audit_invites();

-- Tipping stopped or restored for a creator (admin_set_tip_suspension).
CREATE OR REPLACE FUNCTION public.audit_tip_suspension()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.tipping_suspended_at IS NULL AND NEW.tipping_suspended_at IS NOT NULL THEN
    PERFORM public.write_admin_audit('tipping.suspended', 'user', NEW.user_id::text,
      jsonb_build_object('reason', NEW.tipping_suspended_reason));
  ELSIF OLD.tipping_suspended_at IS NOT NULL AND NEW.tipping_suspended_at IS NULL THEN
    PERFORM public.write_admin_audit('tipping.restored', 'user', NEW.user_id::text);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER creator_payment_accounts_audit_suspension
  AFTER UPDATE OF tipping_suspended_at ON public.creator_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.audit_tip_suspension();

-- ---------------------------------------------------------------------------
-- Owner console reads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_require_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_require_admin() FROM public, anon, authenticated;

-- Headline numbers for /owner.
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
    'tipping_suspended', (SELECT count(*) FROM public.creator_payment_accounts
                            WHERE tipping_suspended_at IS NOT NULL),
    'public_wishlists', (SELECT count(*) FROM public.wishlists WHERE visibility = 'public')
  ) INTO result;
  RETURN result;
END;
$$;

-- Users list with search (username, display name or email) and paging.
CREATE OR REPLACE FUNCTION public.owner_list_users(
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
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Search text is matched literally: % _ and \ lose their LIKE meaning.
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
         count(*) OVER ()
    FROM matched m
   ORDER BY m.created_at DESC, m.id
   LIMIT least(greatest(coalesce(_limit, 25), 1), 100)
  OFFSET greatest(coalesce(_offset, 0), 0);
END;
$$;

-- One user's details for /owner/users/<id>.
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
                  FROM public.creator_payment_accounts a WHERE a.user_id = u.id)
  ) INTO result
  FROM auth.users u
  WHERE u.id = _user_id;
  RETURN result; -- NULL when there is no such user
END;
$$;

-- Newest-first page of the audit log, with the actor's username.
CREATE OR REPLACE FUNCTION public.owner_audit_log(
  _limit integer DEFAULT 50,
  _before_id bigint DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  created_at timestamptz,
  actor_user_id uuid,
  actor_username text,
  action text,
  target_type text,
  target_id text,
  target_username text,
  details jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN QUERY
  SELECT a.id, a.created_at, a.actor_user_id, ap.username, a.action, a.target_type, a.target_id,
         tp.username, a.details
    FROM public.admin_audit_log a
    LEFT JOIN public.profiles ap ON ap.user_id = a.actor_user_id
    LEFT JOIN public.profiles tp
      ON a.target_type = 'user'
     AND a.target_id ~ '^[0-9a-f-]{36}$'
     AND tp.user_id = a.target_id::uuid
   WHERE _before_id IS NULL OR a.id < _before_id
   ORDER BY a.id DESC
   LIMIT least(greatest(coalesce(_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_overview() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_list_users(text, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_get_user(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_audit_log(integer, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_list_users(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_get_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_audit_log(integer, bigint) TO authenticated;
