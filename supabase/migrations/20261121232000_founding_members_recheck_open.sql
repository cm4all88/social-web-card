-- Founding Members: re-check that invites are on after taking the program lock.
--
-- beta_redeem_for checked the code (including whether invites are on) before it
-- waited for the program row lock. If the owner turned invites off while a
-- redemption was waiting on that lock, the redemption could still use its code
-- and grant Plus. owner_beta_set_open takes the same row lock, so reading the
-- row again under the lock sees the owner's change. The same goes for a code
-- that expires or is revoked while the redemption waits.
--
-- Additive: replaces one function body; no tables, data or grants change.
-- Rollback: rerun the beta_redeem_for definition from
-- 20261121230000_founding_creator_beta.sql (or the full rollback in
-- supabase/rollbacks/20261121230000_founding_creator_beta.down.sql, which drops it).

CREATE OR REPLACE FUNCTION public.beta_redeem_for(_user_id uuid, _code text, _via_signup boolean)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.invites%ROWTYPE;
  prog public.beta_programs%ROWTYPE;
  used integer;
  state text;
BEGIN
  state := public.beta_code_state(_code);
  IF state <> 'ok' THEN RETURN state; END IF;

  SELECT * INTO inv FROM public.invites WHERE code = lower(btrim(_code)) AND program IS NOT NULL;
  -- One redemption at a time per program, so two people can't take seat 50.
  SELECT * INTO prog FROM public.beta_programs WHERE key = inv.program FOR UPDATE;
  -- The owner may have turned invites off while we waited for the lock.
  IF NOT prog.open THEN RETURN 'closed'; END IF;

  IF EXISTS (SELECT 1 FROM public.plan_entitlements WHERE user_id = _user_id AND source = inv.program) THEN
    RETURN 'already';
  END IF;
  IF public.account_is_suspended(_user_id) THEN
    RETURN 'invalid';
  END IF;
  SELECT count(*) INTO used FROM public.plan_entitlements
   WHERE source = inv.program AND revoked_at IS NULL;
  IF used >= prog.max_seats THEN RETURN 'full'; END IF;

  PERFORM set_config('yooits.beta_write', 'on', true);
  UPDATE public.invites SET used_by = _user_id, used_at = now()
   WHERE id = inv.id AND used_by IS NULL AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN
    PERFORM set_config('yooits.beta_write', '', true);
    state := public.beta_code_state(_code);
    RETURN CASE WHEN state = 'ok' THEN 'used' ELSE state END;
  END IF;
  PERFORM set_config('yooits.beta_write', '', true);

  INSERT INTO public.plan_entitlements (user_id, plan, source, invite_id, via_signup, ends_at)
  VALUES (_user_id, 'plus', inv.program, inv.id, _via_signup, now() + make_interval(months => prog.plus_months));

  PERFORM public.write_admin_audit('beta.redeemed', 'user', _user_id::text,
    jsonb_build_object('invite_id', inv.id, 'via_signup', _via_signup, 'program', inv.program));
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.beta_redeem_for(uuid, text, boolean) FROM public, anon, authenticated;
