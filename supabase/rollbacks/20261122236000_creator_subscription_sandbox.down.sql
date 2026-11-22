-- Roll back 20261122236000_creator_subscription_sandbox.sql: restore the four
-- functions as they were, then remove the sandbox list and its helpers.


CREATE OR REPLACE FUNCTION public.creator_subscriptions_on_for(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT enabled FROM public.creator_subscription_settings WHERE id), false)
      OR (_user_id IS NOT NULL AND public.has_role(_user_id, 'admin'))
$$;

CREATE OR REPLACE FUNCTION public.creator_can_apply(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.creator_milestone_reached(_user_id, 'subscriptions_apply')
      OR public.has_role(_user_id, 'admin')
$$;

CREATE OR REPLACE FUNCTION public.creator_subscription_checkout_gate(_subscriber uuid, _username text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.creator_subscription_settings;
  creator record;
  offer public.creator_subscription_offers;
  acct record;
BEGIN
  SELECT * INTO s FROM public.creator_subscription_settings WHERE id;
  IF s IS NULL OR NOT s.enabled OR NOT s.checkout_enabled
     OR s.yooits_percent_bps IS NULL OR s.yooits_fixed_cents IS NULL
     OR s.stripe_percent_bps IS NULL OR s.stripe_fixed_cents IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;
  IF _subscriber IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sign_in');
  END IF;
  IF public.account_is_suspended(_subscriber) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  SELECT p.user_id, p.username, p.display_name INTO creator
    FROM public.profiles p WHERE p.username = lower(btrim(_username));
  IF creator.user_id IS NULL OR NOT public.creator_is_monetized(creator.user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;
  IF creator.user_id = _subscriber THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self');
  END IF;

  SELECT * INTO offer FROM public.creator_subscription_offers
   WHERE user_id = creator.user_id AND status = 'approved';
  IF offer.id IS NULL OR offer.price_cents < s.price_min_cents OR offer.price_cents > s.price_max_cents THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  IF public.has_active_creator_subscription(_subscriber, creator.user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_subscribed');
  END IF;
  -- A few checkout attempts at a time, so nobody floods Stripe or the table.
  IF (SELECT count(*) FROM public.creator_subscriptions
       WHERE subscriber_user_id = _subscriber AND created_at > now() - interval '10 minutes') >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT a.stripe_account_id, a.status, a.charges_enabled, a.livemode INTO acct
    FROM public.creator_payment_accounts a WHERE a.user_id = creator.user_id;
  IF acct.stripe_account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'creator_user_id', creator.user_id,
    'username', creator.username,
    'display_name', coalesce(nullif(btrim(creator.display_name), ''), creator.username),
    'offer_id', offer.id,
    'offer_version', offer.version,
    'price_cents', offer.price_cents,
    'currency', offer.currency,
    'rates', jsonb_build_object(
      'yooits_percent_bps', s.yooits_percent_bps,
      'yooits_fixed_cents', s.yooits_fixed_cents,
      'stripe_percent_bps', s.stripe_percent_bps,
      'stripe_fixed_cents', s.stripe_fixed_cents),
    'account', jsonb_build_object(
      'stripe_account_id', acct.stripe_account_id,
      'status', acct.status,
      'charges_enabled', acct.charges_enabled,
      'livemode', acct.livemode)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_subscription_public_offer(_username text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.creator_subscription_settings;
  creator record;
  offer public.creator_subscription_offers;
  acct record;
BEGIN
  SELECT * INTO s FROM public.creator_subscription_settings WHERE id;
  IF s IS NULL OR NOT s.enabled OR NOT s.checkout_enabled
     OR s.yooits_percent_bps IS NULL OR s.yooits_fixed_cents IS NULL
     OR s.stripe_percent_bps IS NULL OR s.stripe_fixed_cents IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;

  SELECT p.user_id, p.username, p.display_name INTO creator
    FROM public.profiles p WHERE p.username = lower(btrim(_username));
  IF creator.user_id IS NULL OR NOT public.creator_is_monetized(creator.user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  SELECT * INTO offer FROM public.creator_subscription_offers
   WHERE user_id = creator.user_id AND status = 'approved';
  IF offer.id IS NULL OR offer.price_cents < s.price_min_cents OR offer.price_cents > s.price_max_cents THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  SELECT a.stripe_account_id, a.status, a.charges_enabled, a.livemode INTO acct
    FROM public.creator_payment_accounts a WHERE a.user_id = creator.user_id;
  IF acct.stripe_account_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'creator_user_id', creator.user_id,
    'username', creator.username,
    'display_name', coalesce(nullif(btrim(creator.display_name), ''), creator.username),
    'offer_id', offer.id,
    'price_cents', offer.price_cents,
    'currency', offer.currency,
    'description', offer.description,
    'rates', jsonb_build_object(
      'yooits_percent_bps', s.yooits_percent_bps,
      'yooits_fixed_cents', s.yooits_fixed_cents,
      'stripe_percent_bps', s.stripe_percent_bps,
      'stripe_fixed_cents', s.stripe_fixed_cents),
    'account', jsonb_build_object(
      'stripe_account_id', acct.stripe_account_id,
      'status', acct.status,
      'charges_enabled', acct.charges_enabled,
      'livemode', acct.livemode)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.creator_sandbox_checkout_ok(uuid);
DROP FUNCTION IF EXISTS public.creator_is_sandbox(uuid);
DROP TABLE IF EXISTS public.creator_subscription_sandbox_creators;
