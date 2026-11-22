-- Creator subscriptions, step 4: what a profile page may show about a
-- creator's subscription, so the subscribe button appears only where a
-- checkout would actually work. Same checks as the checkout gate except the
-- ones about the person subscribing. Read-only, additive.
-- Rollback: supabase/rollbacks/20261122235000_creator_subscription_public_offer.down.sql

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
REVOKE ALL ON FUNCTION public.creator_subscription_public_offer(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creator_subscription_public_offer(text) TO service_role;
