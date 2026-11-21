-- Rollback for 20261121230000_founding_creator_beta.sql (Founding Members).
-- Run in one transaction. It removes the Founding Members codes, Plus grants
-- and feedback, then puts the schema and the signup function back exactly as
-- they were before. Plain invite codes and every account, profile, link,
-- wishlist and tip are untouched.
-- Deploy code without the Founding Members page first (or right after):
-- the old owner Invites page doesn't filter on invites.program.
BEGIN;

-- Signup goes back to the version from 20261118200000_phase0_security_hardening.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invite_code text;
  v_username text;
  v_display text;
BEGIN
  v_invite_code := NULLIF(btrim(new.raw_user_meta_data->>'invite_code'), '');
  v_username := lower(NULLIF(btrim(new.raw_user_meta_data->>'username'), ''));
  v_display := left(NULLIF(btrim(new.raw_user_meta_data->>'display_name'), ''), 50);

  IF v_username IS NULL OR v_username !~ '^[a-z0-9_-]{2,30}$' THEN
    RAISE EXCEPTION 'A valid username (2-30 chars, a-z 0-9 _ -) is required';
  END IF;

  IF public.username_is_reserved(v_username) THEN
    RAISE EXCEPTION 'That username is reserved';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  INSERT INTO public.profiles (user_id, username, display_name)
  VALUES (new.id, v_username, COALESCE(v_display, v_username));

  IF v_invite_code IS NOT NULL THEN
    UPDATE public.invites
      SET used_by = new.id, used_at = now()
      WHERE code = v_invite_code AND used_by IS NULL;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'user')
  ON CONFLICT DO NOTHING;

  RETURN new;
END;
$function$;

DROP FUNCTION IF EXISTS public.owner_beta_set_open(boolean);
DROP FUNCTION IF EXISTS public.owner_beta_list_feedback(integer, bigint);
DROP FUNCTION IF EXISTS public.owner_beta_revoke_grant(uuid, text);
DROP FUNCTION IF EXISTS public.owner_beta_list_members(integer, integer);
DROP FUNCTION IF EXISTS public.owner_beta_revoke_invite(uuid, text);
DROP FUNCTION IF EXISTS public.owner_beta_list_invites(integer, integer);
DROP FUNCTION IF EXISTS public.owner_beta_create_invites(integer, text, text, integer);
DROP FUNCTION IF EXISTS public.owner_beta_overview();
DROP FUNCTION IF EXISTS public.redeem_beta_invite(text);
DROP FUNCTION IF EXISTS public.beta_redeem_for(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.beta_code_state(text);
DROP FUNCTION IF EXISTS public.current_plan(uuid);
DROP FUNCTION IF EXISTS public.beta_invite_status(public.invites);

DROP TABLE IF EXISTS public.beta_feedback;
DROP FUNCTION IF EXISTS public.beta_feedback_before_insert();
DROP TABLE IF EXISTS public.plan_entitlements;

-- Founding Member codes go; the guard trigger has to go first so they can.
DROP TRIGGER IF EXISTS invites_guard_beta ON public.invites;
DROP FUNCTION IF EXISTS public.invites_guard_beta_rows();
DELETE FROM public.invites WHERE program IS NOT NULL;
DROP INDEX IF EXISTS public.idx_invites_program;
ALTER TABLE public.invites
  DROP COLUMN IF EXISTS program,
  DROP COLUMN IF EXISTS label,
  DROP COLUMN IF EXISTS channel,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS revoked_at,
  DROP COLUMN IF EXISTS revoked_by,
  DROP COLUMN IF EXISTS revoked_reason;

DROP TABLE IF EXISTS public.beta_programs;

COMMIT;
