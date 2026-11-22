-- Tips need the owner's approval (Chris, 21 Nov 2026: "Require owner approval
-- for creator tipping initially").
--
-- Every creator starts NOT approved. A creator can still describe their work
-- and connect Stripe, but no tip button shows and no checkout opens until a
-- Yooits admin approves them in the owner console. The check runs on the
-- server (public tip config and checkout both go through tips_approved), and
-- every approval and revocation is written to admin_audit_log.
--
-- Nothing here enables payments: tipping stays off site-wide until
-- TIPPING_ENABLED and Stripe settings are set, and live keys need
-- STRIPE_LIVE_MODE_APPROVED.

ALTER TABLE public.account_status
  ADD COLUMN tips_approved_at timestamptz,
  ADD COLUMN tips_approved_by uuid,
  ADD COLUMN tips_approval_note text
    CHECK (tips_approval_note IS NULL OR char_length(tips_approval_note) <= 200);

-- Has the owner approved this creator for tips? (No status row means no.)
CREATE OR REPLACE FUNCTION public.tips_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_status s
     WHERE s.user_id = _user_id AND s.tips_approved_at IS NOT NULL
  )
$$;

REVOKE ALL ON FUNCTION public.tips_approved(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tips_approved(uuid) TO service_role;

-- Owner action: approve or revoke. Admin only, needs a note when approving.
CREATE OR REPLACE FUNCTION public.owner_set_tips_approved(_user_id uuid, _approved boolean, _note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n text;
BEGIN
  PERFORM public.owner_require_admin();
  PERFORM public.owner_assert_user_exists(_user_id);
  n := public.owner_clean_reason(_note);
  IF _approved THEN
    INSERT INTO public.account_status AS s (user_id, tips_approved_at, tips_approved_by, tips_approval_note)
    VALUES (_user_id, now(), auth.uid(), n)
    ON CONFLICT (user_id) DO UPDATE
      SET tips_approved_at = coalesce(s.tips_approved_at, now()),
          tips_approved_by = coalesce(s.tips_approved_by, auth.uid()),
          tips_approval_note = n;
  ELSE
    UPDATE public.account_status
       SET tips_approved_at = NULL, tips_approved_by = NULL, tips_approval_note = n
     WHERE user_id = _user_id;
  END IF;
  RETURN _approved;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_set_tips_approved(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_tips_approved(uuid, boolean, text) TO authenticated;

-- Audit: same trigger as before, now also logging approvals. Rewritten so an
-- INSERT compares against an all-empty row whatever columns the table has.
CREATE OR REPLACE FUNCTION public.audit_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.account_status;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    o := OLD;
  END IF;  -- on INSERT every field of o stays NULL
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
  IF o.tips_approved_at IS NULL AND NEW.tips_approved_at IS NOT NULL THEN
    PERFORM public.write_admin_audit('tipping.approved', 'user', NEW.user_id::text,
      jsonb_build_object('note', NEW.tips_approval_note));
  ELSIF o.tips_approved_at IS NOT NULL AND NEW.tips_approved_at IS NULL THEN
    PERFORM public.write_admin_audit('tipping.approval_revoked', 'user', NEW.user_id::text,
      jsonb_build_object('note', NEW.tips_approval_note));
  END IF;
  RETURN NULL;
END;
$$;

-- Owner reads include the approval.
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
    'tips_disabled_by', (SELECT p.username FROM public.profiles p WHERE p.user_id = s.tips_disabled_by),
    'tips_approved_at', s.tips_approved_at, 'tips_approval_note', s.tips_approval_note,
    'tips_approved_by', (SELECT p.username FROM public.profiles p WHERE p.user_id = s.tips_approved_by)
  )
  FROM public.account_status s WHERE s.user_id = _user_id
$$;

REVOKE ALL ON FUNCTION public.owner_account_status_json(uuid) FROM public, anon, authenticated;

-- Creators waiting for approval: set up for tips (described their work) but not approved.
CREATE OR REPLACE FUNCTION public.owner_list_tip_approvals()
RETURNS TABLE (
  user_id uuid,
  username text,
  display_name text,
  creator_type text,
  offering text,
  stripe_status text,
  charges_enabled boolean,
  approved_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN QUERY
  SELECT t.user_id, p.username, p.display_name, t.creator_type::text, t.offering,
         a.status::text, coalesce(a.charges_enabled, false), s.tips_approved_at
    FROM public.tip_settings t
    LEFT JOIN public.profiles p ON p.user_id = t.user_id
    LEFT JOIN public.creator_payment_accounts a ON a.user_id = t.user_id
    LEFT JOIN public.account_status s ON s.user_id = t.user_id
   WHERE t.attested_at IS NOT NULL OR a.user_id IS NOT NULL
   ORDER BY (s.tips_approved_at IS NOT NULL), t.updated_at DESC
   LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_list_tip_approvals() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_tip_approvals() TO authenticated;
