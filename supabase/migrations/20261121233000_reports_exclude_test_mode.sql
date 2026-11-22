-- Stripe test-mode activity stays out of real reporting (Chris, 21 Nov 2026:
-- "test activity cannot affect real creator balances or production reporting").
--
-- test.yooits.me runs Stripe TEST mode against the production database. Every
-- tip, connected account and Stripe event it writes has livemode = false. The
-- owner revenue report and the owner overview now count only livemode rows,
-- and show test activity separately under "test_mode". No data changes.
-- Rollback: supabase/rollbacks/20261121233000_reports_exclude_test_mode.down.sql

CREATE OR REPLACE FUNCTION public.admin_tip_report(_since timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  WITH t AS (
    SELECT * FROM public.tips
    WHERE status = 'succeeded' AND livemode
      AND (_since IS NULL OR paid_at >= _since)
  ), tt AS (
    SELECT * FROM public.tips
    WHERE status = 'succeeded' AND NOT livemode
      AND (_since IS NULL OR paid_at >= _since)
  )
  SELECT jsonb_build_object(
    'since', _since,
    'successful_tips', (SELECT count(*) FROM t),
    'gross_tip_volume_cents', (SELECT coalesce(sum(tip_amount_cents), 0) FROM t),
    'gross_charged_cents', (SELECT coalesce(sum(total_cents), 0) FROM t),
    -- Fees count as collected only once Stripe has confirmed the amount.
    'platform_fee_cents', (SELECT coalesce(sum(application_fee_cents), 0) FROM t),
    'platform_fee_refunded_cents', (SELECT coalesce(sum(platform_fee_refunded_cents), 0) FROM t),
    'net_platform_fee_cents',
      (SELECT coalesce(sum(application_fee_cents - platform_fee_refunded_cents), 0)
         FROM t WHERE application_fee_cents IS NOT NULL),
    'unconfirmed_fee_tips', (SELECT count(*) FROM t WHERE application_fee_cents IS NULL),
    'unconfirmed_fee_cents',
      (SELECT coalesce(sum(platform_fee_cents), 0) FROM t WHERE application_fee_cents IS NULL),
    'fee_mismatch_tips',
      (SELECT count(*) FROM t
        WHERE application_fee_cents IS NOT NULL AND application_fee_cents <> platform_fee_cents),
    'refunded_tips', (SELECT count(*) FROM t WHERE amount_refunded_cents > 0),
    'amount_refunded_cents', (SELECT coalesce(sum(amount_refunded_cents), 0) FROM t),
    'disputed_tips', (SELECT count(*) FROM t WHERE dispute_status IS NOT NULL),
    'disputes_lost', (SELECT count(*) FROM t WHERE dispute_status = 'lost'),
    'average_tip_cents', (SELECT coalesce(round(avg(tip_amount_cents)), 0) FROM t),
    'creators_receiving_tips', (SELECT count(DISTINCT creator_user_id) FROM t),
    'active_connected_creators',
      (SELECT count(*) FROM public.creator_payment_accounts WHERE status = 'connected' AND livemode),
    'pending_connected_creators',
      (SELECT count(*) FROM public.creator_payment_accounts
        WHERE status IN ('pending', 'restricted') AND livemode),
    'suspended_creators',
      (SELECT count(*) FROM public.creator_payment_accounts
        WHERE tipping_suspended_at IS NOT NULL AND livemode),
    'needs_review_tips', (SELECT count(*) FROM public.tips WHERE status = 'needs_review' AND livemode),
    'test_mode', jsonb_build_object(
      'successful_tips', (SELECT count(*) FROM tt),
      'gross_tip_volume_cents', (SELECT coalesce(sum(tip_amount_cents), 0) FROM tt),
      'net_platform_fee_cents',
        (SELECT coalesce(sum(application_fee_cents - platform_fee_refunded_cents), 0)
           FROM tt WHERE application_fee_cents IS NOT NULL),
      'refunded_tips', (SELECT count(*) FROM tt WHERE amount_refunded_cents > 0),
      'connected_accounts',
        (SELECT count(*) FROM public.creator_payment_accounts WHERE NOT livemode),
      'needs_review_tips',
        (SELECT count(*) FROM public.tips WHERE status = 'needs_review' AND NOT livemode)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT jsonb_build_object(
    'total_users', (SELECT count(*) FROM auth.users),
    'signups_7d', (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '7 days'),
    'signups_30d', (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '30 days'),
    'unconfirmed_emails', (SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NULL),
    'profiles_with_links', (SELECT count(DISTINCT user_id) FROM public.social_links
                              WHERE enabled AND url <> ''),
    'admins', (SELECT count(DISTINCT user_id) FROM public.user_roles WHERE role = 'admin'),
    'open_invites', (SELECT count(*) FROM public.invites WHERE used_by IS NULL),
    'connected_creators', (SELECT count(*) FROM public.creator_payment_accounts
                             WHERE status = 'connected' AND livemode),
    'test_connected_creators', (SELECT count(*) FROM public.creator_payment_accounts
                                  WHERE status = 'connected' AND NOT livemode),
    'tipping_suspended', (SELECT count(*) FROM public.account_status WHERE tips_disabled_at IS NOT NULL),
    'public_wishlists', (SELECT count(*) FROM public.wishlists WHERE visibility = 'public'),
    'unpublished', (SELECT count(*) FROM public.account_status WHERE unpublished_at IS NOT NULL),
    'suspended', (SELECT count(*) FROM public.account_status WHERE suspended_at IS NOT NULL)
  ) INTO result;
  RETURN result;
END;
$$;
