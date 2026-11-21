-- Rollback for 20261121220000_tip_owner_approval.sql (owner approval for tips).
-- Run in one transaction. Removes approvals (they are only owner decisions,
-- re-made in the owner console) and restores the functions exactly as the
-- 20261118220000_account_controls migration left them. No other data changes.
-- After this, deploy code without the approval check, or loadCreatorByUsername
-- fails closed (no tips), which is safe.
BEGIN;

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

DROP FUNCTION IF EXISTS public.owner_list_tip_approvals();
DROP FUNCTION IF EXISTS public.owner_set_tips_approved(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.tips_approved(uuid);

ALTER TABLE public.account_status
  DROP COLUMN IF EXISTS tips_approval_note,
  DROP COLUMN IF EXISTS tips_approved_by,
  DROP COLUMN IF EXISTS tips_approved_at;

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

COMMIT;
