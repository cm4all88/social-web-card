-- Owner-only "assign protected username".
--
-- The brand-lookalike and reserved-name checks (username_is_reserved) stay in
-- force for every sign-up and every rename. The one exception is a rename made
-- through owner_assign_username by a Yooits admin, so the official Yooits
-- account can be given a protected name like "yooits". Names that are site
-- paths (auth, owner, dashboard and the like) are refused even then, because
-- a profile there would be hidden behind the page. Every assignment is written
-- to the audit log with the old name, the new name and the reason.
-- Rollback: supabase/rollbacks/20261123040000_owner_assign_username.down.sql

CREATE OR REPLACE FUNCTION public.enforce_username_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.username IS DISTINCT FROM OLD.username THEN
    IF public.username_is_reserved(NEW.username)
       AND NOT (TG_OP = 'UPDATE'
                AND coalesce(current_setting('yooits.owner_username', true), '') = NEW.username
                AND public.has_role(auth.uid(), 'admin')) THEN
      RAISE EXCEPTION 'That username is reserved' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Paths the site itself uses. A profile with one of these names could never be opened.
CREATE OR REPLACE FUNCTION public.username_is_site_path(_username text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(btrim(coalesce(_username, ''))) = ANY (ARRAY[
    'admin', 'api', 'assets', 'auth', 'callback', 'dashboard', 'email', 'favicon', 'index',
    'legal', 'login', 'logout', 'messages', 'null', 'owner', 'privacy', 'reset-password',
    'robots', 'root', 'sitemap', 'static', 'system', 'terms', 'undefined', 'webhook',
    'webhooks', 'www'])
$$;

CREATE OR REPLACE FUNCTION public.owner_assign_username(_user_id uuid, _username text, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nu text := lower(btrim(coalesce(_username, '')));
  why text := NULLIF(left(btrim(coalesce(_reason, '')), 200), '');
  old text;
  protected boolean;
BEGIN
  PERFORM public.owner_require_admin();
  IF nu !~ '^[a-z0-9_-]{2,30}$' THEN
    RAISE EXCEPTION 'Usernames are 2 to 30 letters, numbers, _ or -.' USING ERRCODE = '22023';
  END IF;
  IF public.username_is_site_path(nu) THEN
    RAISE EXCEPTION '"%" is a page on the site, so it can''t be a username.', nu USING ERRCODE = '22023';
  END IF;
  IF why IS NULL OR char_length(why) < 3 THEN
    RAISE EXCEPTION 'Give a short reason for the audit log.' USING ERRCODE = '22023';
  END IF;
  SELECT username INTO old FROM public.profiles WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No account with that id.' USING ERRCODE = 'P0002';
  END IF;
  IF old = nu THEN
    RETURN jsonb_build_object('user_id', _user_id, 'old_username', old, 'username', nu, 'changed', false);
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = nu AND user_id <> _user_id) THEN
    RAISE EXCEPTION 'Another account already has that username.' USING ERRCODE = '23505';
  END IF;
  protected := public.username_is_reserved(nu);

  PERFORM set_config('yooits.owner_username', nu, true);
  UPDATE public.profiles SET username = nu WHERE user_id = _user_id;
  PERFORM set_config('yooits.owner_username', '', true);

  PERFORM public.write_admin_audit('user.username_assigned', 'user', _user_id::text,
    jsonb_build_object('from', old, 'to', nu, 'protected', protected, 'reason', why));
  RETURN jsonb_build_object('user_id', _user_id, 'old_username', old, 'username', nu,
                            'changed', true, 'protected', protected);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_assign_username(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_assign_username(uuid, text, text) TO authenticated;
