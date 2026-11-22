-- Rollback for 20261122190000_owner_mail.sql.
-- Removes the stored Google refresh tokens from Vault first, so nothing is
-- left behind, then the tables and functions. Mail in Gmail is untouched.
-- Audit log rows written by Owner Mail stay (the log is append-only).
DO $$
BEGIN
  IF to_regclass('public.owner_mail_accounts') IS NOT NULL AND to_regclass('vault.secrets') IS NOT NULL THEN
    EXECUTE 'DELETE FROM vault.secrets WHERE id IN (SELECT token_secret_id FROM public.owner_mail_accounts WHERE token_secret_id IS NOT NULL)';
  END IF;
END;
$$;
DROP FUNCTION IF EXISTS public.owner_email_detail(uuid);
DROP FUNCTION IF EXISTS public.owner_mail_audit(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.owner_mail_forget(uuid);
DROP FUNCTION IF EXISTS public.owner_mail_mark_broken(uuid, text);
DROP FUNCTION IF EXISTS public.owner_mail_token(uuid);
DROP FUNCTION IF EXISTS public.owner_mail_save_token(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.owner_mail_take_state(text);
DROP FUNCTION IF EXISTS public.owner_mail_begin(uuid, text, text);
DROP TABLE IF EXISTS public.owner_mail_oauth_states;
DROP TABLE IF EXISTS public.owner_mail_accounts;
