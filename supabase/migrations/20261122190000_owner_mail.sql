-- Owner Mail: the Yooits owner reads and sends the admin Gmail mailbox from
-- the Owner Console. Gmail stays the mailbox; nothing here stores mail.
--
-- What is stored:
--   owner_mail_accounts      which Google account the owner connected, and
--                            the id of its refresh token in Supabase Vault
--                            (encrypted at rest; the token itself is never
--                            in a table column)
--   owner_mail_oauth_states  one-time sign-in states (hashed), 10 minutes
--
-- Both tables are service-role only: RLS on, no policies, no grants to anon
-- or authenticated. The functions that touch Vault are callable only by the
-- service role (the Yooits server), which checks the owner first.
--
-- Also: owner_email_detail(_id), one system email with its delivery events,
-- for the Owner Console's System emails view (admins only).
--
-- Rollback: supabase/rollbacks/20261122190000_owner_mail.down.sql

CREATE TABLE public.owner_mail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  google_email text NOT NULL CHECK (char_length(google_email) BETWEEN 3 AND 254),
  scopes text NOT NULL DEFAULT '' CHECK (char_length(scopes) <= 1000),
  token_secret_id uuid,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'needs_reconnect')),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.owner_mail_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_mail_accounts FROM anon, authenticated;

CREATE TABLE public.owner_mail_oauth_states (
  state_hash text PRIMARY KEY CHECK (char_length(state_hash) = 64),
  owner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  code_verifier text NOT NULL CHECK (char_length(code_verifier) BETWEEN 43 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
ALTER TABLE public.owner_mail_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_mail_oauth_states FROM anon, authenticated;

-- Start a sign-in: keeps one pending state per owner, drops expired ones.
CREATE OR REPLACE FUNCTION public.owner_mail_begin(_owner uuid, _state_hash text, _code_verifier text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(_owner, 'admin') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.owner_mail_oauth_states WHERE expires_at < now() OR owner_user_id = _owner;
  INSERT INTO public.owner_mail_oauth_states (state_hash, owner_user_id, code_verifier)
  VALUES (_state_hash, _owner, _code_verifier);
END;
$$;

-- Finish a sign-in: the state works once, within 10 minutes, for an admin.
CREATE OR REPLACE FUNCTION public.owner_mail_take_state(_state_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.owner_mail_oauth_states;
BEGIN
  DELETE FROM public.owner_mail_oauth_states WHERE state_hash = _state_hash RETURNING * INTO _row;
  IF _row.state_hash IS NULL OR _row.expires_at < now() OR NOT public.has_role(_row.owner_user_id, 'admin') THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('owner_user_id', _row.owner_user_id, 'code_verifier', _row.code_verifier);
END;
$$;

-- Saves (or replaces) the owner's Google refresh token in Vault.
CREATE OR REPLACE FUNCTION public.owner_mail_save_token(_owner uuid, _google_email text, _scopes text, _refresh_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _secret uuid;
  _name text := 'owner_mail_refresh_' || _owner::text;
BEGIN
  IF NOT public.has_role(_owner, 'admin') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF _refresh_token IS NULL OR length(_refresh_token) < 10 THEN
    RAISE EXCEPTION 'No refresh token' USING ERRCODE = '22023';
  END IF;
  IF to_regproc('vault.create_secret') IS NULL THEN
    RAISE EXCEPTION 'Vault is not available' USING ERRCODE = '0A000';
  END IF;
  SELECT token_secret_id INTO _secret FROM public.owner_mail_accounts WHERE owner_user_id = _owner;
  IF _secret IS NULL THEN
    EXECUTE 'SELECT id FROM vault.secrets WHERE name = $1' INTO _secret USING _name;
  END IF;
  IF _secret IS NULL THEN
    EXECUTE 'SELECT vault.create_secret($1, $2, $3)' INTO _secret
      USING _refresh_token, _name, 'Yooits Owner Mail: Google refresh token';
  ELSE
    EXECUTE 'SELECT vault.update_secret($1, $2)' USING _secret, _refresh_token;
  END IF;
  INSERT INTO public.owner_mail_accounts (owner_user_id, google_email, scopes, token_secret_id, status, last_error, connected_at, updated_at)
  VALUES (_owner, lower(btrim(_google_email)), left(coalesce(_scopes, ''), 1000), _secret, 'connected', NULL, now(), now())
  ON CONFLICT (owner_user_id) DO UPDATE
    SET google_email = EXCLUDED.google_email, scopes = EXCLUDED.scopes, token_secret_id = EXCLUDED.token_secret_id,
        status = 'connected', last_error = NULL, connected_at = now(), updated_at = now();
  INSERT INTO public.admin_audit_log (actor_user_id, action, target_type, target_id, details)
  VALUES (_owner, 'mail.connected', 'mail_account', lower(btrim(_google_email)), '{}'::jsonb);
END;
$$;

-- The owner's refresh token, for the server only.
CREATE OR REPLACE FUNCTION public.owner_mail_token(_owner uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _secret uuid;
  _token text;
BEGIN
  IF NOT public.has_role(_owner, 'admin') THEN
    RETURN NULL;
  END IF;
  SELECT token_secret_id INTO _secret FROM public.owner_mail_accounts WHERE owner_user_id = _owner;
  IF _secret IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1' INTO _token USING _secret;
  RETURN _token;
END;
$$;

-- Google refused the token (revoked or expired): keep the row, ask to reconnect.
CREATE OR REPLACE FUNCTION public.owner_mail_mark_broken(_owner uuid, _error text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.owner_mail_accounts
     SET status = 'needs_reconnect', last_error = left(_error, 300), updated_at = now()
   WHERE owner_user_id = _owner;
$$;

-- Disconnect: removes the stored token (Vault) and the account row.
-- Mail in Gmail is not touched.
CREATE OR REPLACE FUNCTION public.owner_mail_forget(_owner uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _secret uuid;
  _email text;
BEGIN
  IF NOT public.has_role(_owner, 'admin') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT token_secret_id, google_email INTO _secret, _email FROM public.owner_mail_accounts WHERE owner_user_id = _owner;
  IF _secret IS NOT NULL AND to_regclass('vault.secrets') IS NOT NULL THEN
    EXECUTE 'DELETE FROM vault.secrets WHERE id = $1' USING _secret;
  END IF;
  DELETE FROM public.owner_mail_accounts WHERE owner_user_id = _owner;
  IF _email IS NOT NULL THEN
    INSERT INTO public.admin_audit_log (actor_user_id, action, target_type, target_id, details)
    VALUES (_owner, 'mail.disconnected', 'mail_account', _email, '{}'::jsonb);
  END IF;
END;
$$;

-- One line in the audit log per send (recipients count and Gmail id, no body).
CREATE OR REPLACE FUNCTION public.owner_mail_audit(_owner uuid, _action text, _target_id text, _details jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(_owner, 'admin') OR _action NOT IN ('mail.sent', 'mail.trashed') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.admin_audit_log (actor_user_id, action, target_type, target_id, details)
  VALUES (_owner, _action, 'mail_message', left(_target_id, 100), coalesce(_details, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.owner_mail_begin(uuid, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_mail_take_state(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_mail_save_token(uuid, text, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_mail_token(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_mail_mark_broken(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_mail_forget(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_mail_audit(uuid, text, text, jsonb) FROM public, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.owner_mail_begin(uuid, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.owner_mail_take_state(text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.owner_mail_save_token(uuid, text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.owner_mail_token(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.owner_mail_mark_broken(uuid, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.owner_mail_forget(uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.owner_mail_audit(uuid, text, text, jsonb) TO service_role;
  END IF;
END;
$$;

-- System emails view: one email with its payload (for the preview) and its
-- delivery events. Admins only, like the other owner_email_* functions.
CREATE OR REPLACE FUNCTION public.owner_email_detail(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN (
    SELECT jsonb_build_object(
      'id', o.id, 'template', o.template, 'category', o.category, 'to_email', o.to_email,
      'status', o.status, 'skip_reason', o.skip_reason, 'attempts', o.attempts,
      'last_error', o.last_error, 'subject', o.subject, 'is_test', o.is_test,
      'payload', o.payload, 'provider_id', o.provider_id, 'created_at', o.created_at,
      'sent_at', o.sent_at, 'delivered_at', o.delivered_at, 'username', p.username,
      'events', coalesce((SELECT jsonb_agg(jsonb_build_object('type', e.type, 'detail', e.detail, 'at', e.occurred_at)
                                           ORDER BY e.occurred_at, e.id)
                            FROM public.email_events e WHERE e.outbox_id = o.id), '[]'::jsonb))
      FROM public.email_outbox o
      LEFT JOIN public.profiles p ON p.user_id = o.user_id
     WHERE o.id = _id);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_email_detail(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_email_detail(uuid) TO authenticated;
