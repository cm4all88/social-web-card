-- Creator subscriptions, step 3: what checkout and the payment webhook need.
-- Nothing here sells anything. Checkout stays impossible while
-- creator_subscription_settings.checkout_enabled is false (the default), while
-- tipping/Stripe Connect is switched off in the server settings, and for live
-- keys until live payments are approved.
--
-- Money model (owner, Nov 22): the creator keeps the whole price they set; the
-- subscriber pays the price plus a $0.50 Yooits fee plus Stripe's processing
-- fee, shown as a separate line. The subscription is a direct charge on the
-- creator's Stripe account, which pays Stripe's fee; Yooits takes only its
-- share as the application fee.
--
-- Adds columns to creator_subscriptions (one row per checkout attempt, then
-- the subscription it became) and one gate the server calls before it creates
-- a checkout. Additive only.
-- Rollback: supabase/rollbacks/20261122230000_creator_subscription_checkout.down.sql

ALTER TABLE public.creator_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS checkout_session_id text,
  ADD COLUMN IF NOT EXISTS total_cents integer CHECK (total_cents IS NULL OR total_cents > 0),
  ADD COLUMN IF NOT EXISTS application_fee_cents integer CHECK (application_fee_cents IS NULL OR application_fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS application_fee_percent numeric(5, 2) CHECK (application_fee_percent IS NULL OR application_fee_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS adult_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  -- Stripe's time for the newest subscription event applied, so an older
  -- event delivered late can't undo a newer one.
  ADD COLUMN IF NOT EXISTS stripe_synced_at timestamptz,
  -- Set when Stripe reports something other than what the server created
  -- (account, amount, mode). Such a row never gets access from the webhook.
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS creator_subscriptions_checkout_session
  ON public.creator_subscriptions (checkout_session_id) WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creator_subscriptions_subscriber
  ON public.creator_subscriptions (subscriber_user_id, created_at DESC);

-- Everything the server needs to decide whether a signed-in person may start
-- a subscription checkout for a creator, and at what price. Only the server
-- (service role) calls it; the amounts are worked out again on the server
-- from these rates, never taken from the browser.
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
REVOKE ALL ON FUNCTION public.creator_subscription_checkout_gate(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creator_subscription_checkout_gate(uuid, text) TO service_role;
