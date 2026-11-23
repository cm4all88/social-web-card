-- Undoes 20261123020000_invites_promotions.sql. Founding Member codes and
-- grants are untouched by both. Promotion Plus grants are kept as revoked rows
-- would be lost otherwise, so this refuses to run while any exist: revoke or
-- export them first. Redemption history and promotions are dropped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.plan_entitlements WHERE promotion_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Promotion Plus grants exist; export them before rolling back.';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.owner_promotion_report(uuid, integer);
DROP FUNCTION IF EXISTS public.owner_promotion_save(jsonb);
DROP FUNCTION IF EXISTS public.owner_promotions();
DROP FUNCTION IF EXISTS public.promotion_json(public.promotions);
DROP FUNCTION IF EXISTS public.owner_invite_redemptions(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.owner_invite_set_label(uuid, text);
DROP FUNCTION IF EXISTS public.owner_invite_revoke(uuid, text);
DROP FUNCTION IF EXISTS public.owner_invite_create(integer, text, text, integer, integer, uuid, text);
DROP FUNCTION IF EXISTS public.owner_invite_list(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.invite_status(public.invites);
DROP FUNCTION IF EXISTS public.redeem_code(text);

CREATE OR REPLACE FUNCTION public.invite_is_valid(_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.invites
    WHERE code = _code AND used_by IS NULL
  );
$function$;

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
  v_is_beta boolean;
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

  -- Invites are optional; consume a valid one if given.
  IF v_invite_code IS NOT NULL THEN
    v_is_beta := EXISTS (SELECT 1 FROM public.invites
                          WHERE code = lower(v_invite_code) AND program IS NOT NULL);
    IF v_is_beta THEN
      BEGIN
        PERFORM public.beta_redeem_for(new.id, v_invite_code, true);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'founding member redemption skipped: %', SQLERRM;
      END;
    ELSE
      UPDATE public.invites
        SET used_by = new.id, used_at = now()
        WHERE code = v_invite_code AND used_by IS NULL AND program IS NULL;
    END IF;
  END IF;

  -- Every new account is an ordinary user. Admin is never granted here.
  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'user')
  ON CONFLICT DO NOTHING;

  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_on_plan_entitlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.email_queue('founding_member', 'billing', NEW.user_id,
    public.email_profile_bits(NEW.user_id) || jsonb_build_object('ends_at', NEW.ends_at),
    'founding_member:' || NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_plan_entitlement: %', SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.owner_plus_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admins only.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'paying', (SELECT count(*) FROM public.plus_subscriptions
                WHERE livemode AND status IN ('active', 'past_due')),
    'trialing', (SELECT count(*) FROM public.plus_subscriptions
                  WHERE livemode AND status = 'trialing'),
    'past_due', (SELECT count(*) FROM public.plus_subscriptions
                  WHERE livemode AND status = 'past_due'),
    'canceling', (SELECT count(*) FROM public.plus_subscriptions
                   WHERE livemode AND public.plus_status_is_active(status)
                     AND (cancel_at_period_end OR cancel_at IS NOT NULL)),
    'monthly_revenue_cents', (SELECT coalesce(sum(unit_amount_cents), 0) FROM public.plus_subscriptions
                               WHERE livemode AND status IN ('active', 'past_due')),
    'founding_active', (SELECT count(*) FROM public.plan_entitlements
                         WHERE plan = 'plus' AND revoked_at IS NULL
                           AND now() >= starts_at AND now() < ends_at),
    'test_mode_active', (SELECT count(*) FROM public.plus_subscriptions
                          WHERE NOT livemode AND public.plus_status_is_active(status))
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.code_state(text);
DROP FUNCTION IF EXISTS public.code_redeem_for(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.promo_state_for(public.invites, uuid, boolean);

ALTER TABLE public.plan_entitlements DROP CONSTRAINT plan_entitlements_source_check;
ALTER TABLE public.plan_entitlements ADD CONSTRAINT plan_entitlements_source_check
  CHECK (source = 'founding_creator');
ALTER TABLE public.plan_entitlements DROP COLUMN promotion_id;

DROP TABLE IF EXISTS public.invite_redemptions;

ALTER TABLE public.invites DROP CONSTRAINT invites_channel_check;
UPDATE public.invites SET channel = 'other' WHERE channel = 'social';
ALTER TABLE public.invites ADD CONSTRAINT invites_channel_check
  CHECK (channel IS NULL OR channel IN ('email', 'dm', 'in_person', 'other'));
DROP INDEX IF EXISTS public.idx_invites_promotion;
-- Codes that belonged to a promotion stay as plain codes.
ALTER TABLE public.invites DROP COLUMN promotion_id, DROP COLUMN max_uses, DROP COLUMN use_count;

DROP TABLE IF EXISTS public.promotions;
