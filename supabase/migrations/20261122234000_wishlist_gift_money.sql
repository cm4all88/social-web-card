-- Gift money toward a wishlist item, through the existing Stripe Connect
-- path (direct charges on the list owner's connected account, as for tips).
--
-- SWITCHED OFF AND UNUSABLE. Stripe's own pages say it does not support
-- personal or peer-to-peer money transmission ("sending money between
-- friends") or use for personal, family or household purposes, which is what
-- gift money between family and friends looks like. Chris chose (Nov 22) to
-- build it switched off; it stays unusable until Stripe agrees in writing.
-- That is enforced here: checkout can only be switched on after a Yooits admin
-- records Stripe's written approval, and the fee rates are set.
--
-- Money only ever goes to an adult (18+) list owner with a connected Stripe
-- account whom a Yooits admin has approved. A child's list is hosted on a
-- parent's own account; no account is ever created for a child.
--
-- No UI shows any of this while it is off.
-- Rollback: supabase/rollbacks/20261122234000_wishlist_gift_money.down.sql

ALTER TABLE public.wishlists
  ADD COLUMN accepts_gift_money boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Settings (one row, admins only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.wishlist_gift_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  checkout_enabled boolean NOT NULL DEFAULT false,
  -- Stripe's written approval for gift money. Required before enabling.
  stripe_approved_at timestamptz,
  stripe_approval_note text CHECK (stripe_approval_note IS NULL OR char_length(stripe_approval_note) <= 500),
  -- Unset until Chris picks the fee; with no rates nothing can be paid.
  yooits_percent_bps integer CHECK (yooits_percent_bps IS NULL OR yooits_percent_bps BETWEEN 0 AND 5000),
  yooits_fixed_cents integer CHECK (yooits_fixed_cents IS NULL OR yooits_fixed_cents BETWEEN 0 AND 10000),
  stripe_percent_bps integer CHECK (stripe_percent_bps IS NULL OR stripe_percent_bps BETWEEN 0 AND 2000),
  stripe_fixed_cents integer CHECK (stripe_fixed_cents IS NULL OR stripe_fixed_cents BETWEEN 0 AND 1000),
  amount_min_cents integer NOT NULL DEFAULT 500 CHECK (amount_min_cents >= 100),
  amount_max_cents integer NOT NULL DEFAULT 50000 CHECK (amount_max_cents <= 100000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT wishlist_gift_amount_range CHECK (amount_min_cents <= amount_max_cents),
  CONSTRAINT wishlist_gift_needs_stripe_approval
    CHECK (NOT (enabled OR checkout_enabled) OR stripe_approved_at IS NOT NULL),
  CONSTRAINT wishlist_gift_checkout_needs_rates
    CHECK (NOT checkout_enabled OR (enabled AND yooits_percent_bps IS NOT NULL
      AND yooits_fixed_cents IS NOT NULL AND stripe_percent_bps IS NOT NULL
      AND stripe_fixed_cents IS NOT NULL))
);
INSERT INTO public.wishlist_gift_settings (id) VALUES (true);
ALTER TABLE public.wishlist_gift_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wishlist_gift_settings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may receive gift money (server/admin written only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.wishlist_gift_recipients (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  -- The account holder said they are 18 or older.
  adult_confirmed_at timestamptz,
  -- A Yooits admin approved them to receive gift money.
  approved_at timestamptz,
  approved_by uuid,
  suspended_at timestamptz,
  suspended_reason text CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wishlist_gift_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wishlist_gift_recipients FROM anon, authenticated;

CREATE TRIGGER wishlist_gift_recipients_updated_at
  BEFORE UPDATE ON public.wishlist_gift_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Gifts (server-written only). Integer cents, set by the server.
-- Financial records: kept when an account is deleted (no FK cascade).
-- ---------------------------------------------------------------------------
CREATE TABLE public.wishlist_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,
  giver_user_id uuid,
  wishlist_id uuid,
  item_id uuid,
  item_name text NOT NULL CHECK (char_length(item_name) <= 120),
  stripe_account_id text NOT NULL,
  checkout_session_id text UNIQUE,
  payment_intent_id text UNIQUE,
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  gift_amount_cents integer NOT NULL CHECK (gift_amount_cents > 0),
  service_fee_cents integer NOT NULL CHECK (service_fee_cents >= 0),
  application_fee_cents integer NOT NULL CHECK (application_fee_cents >= 0),
  total_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'expired', 'needs_review')),
  giver_name text CHECK (giver_name IS NULL OR char_length(giver_name) <= 50),
  giver_message text CHECK (giver_message IS NULL OR char_length(giver_message) <= 280),
  livemode boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wishlist_gifts_total_matches CHECK (total_cents = gift_amount_cents + service_fee_cents)
);
CREATE INDEX idx_wishlist_gifts_recipient ON public.wishlist_gifts (recipient_user_id, created_at DESC);
CREATE INDEX idx_wishlist_gifts_giver ON public.wishlist_gifts (giver_user_id, created_at DESC);
ALTER TABLE public.wishlist_gifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wishlist_gifts FROM anon, authenticated;

CREATE TRIGGER wishlist_gifts_updated_at
  BEFORE UPDATE ON public.wishlist_gifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Checkout gate (service role only). Every check the server must pass
-- before it may create a Stripe Checkout for gift money.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wishlist_gift_checkout_gate(_giver uuid, _item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.wishlist_gift_settings;
  it public.wishlist_items;
  w public.wishlists;
  r public.wishlist_gift_recipients;
  acct record;
  uname text;
BEGIN
  SELECT * INTO s FROM public.wishlist_gift_settings WHERE id;
  IF s IS NULL OR NOT s.enabled OR NOT s.checkout_enabled OR s.stripe_approved_at IS NULL
     OR s.yooits_percent_bps IS NULL OR s.yooits_fixed_cents IS NULL
     OR s.stripe_percent_bps IS NULL OR s.stripe_fixed_cents IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'off');
  END IF;
  IF _giver IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sign_in');
  END IF;
  IF public.account_is_suspended(_giver) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  SELECT * INTO it FROM public.wishlist_items WHERE id = _item_id;
  IF it.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'unavailable'); END IF;
  SELECT * INTO w FROM public.wishlists WHERE id = it.wishlist_id;
  IF w.user_id = _giver THEN RETURN jsonb_build_object('ok', false, 'reason', 'self'); END IF;
  IF w.visibility <> 'public' OR NOT w.accepts_gift_money OR NOT public.profile_is_public(w.user_id)
     OR public.account_is_suspended(w.user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  -- Adult, approved, not suspended. Never a minor's account.
  SELECT * INTO r FROM public.wishlist_gift_recipients WHERE user_id = w.user_id;
  IF r.user_id IS NULL OR r.adult_confirmed_at IS NULL OR r.approved_at IS NULL
     OR r.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  SELECT a.stripe_account_id, a.status, a.charges_enabled, a.livemode, a.tipping_suspended_at
    INTO acct FROM public.creator_payment_accounts a WHERE a.user_id = w.user_id;
  IF acct.stripe_account_id IS NULL OR acct.status <> 'connected' OR NOT acct.charges_enabled
     OR acct.tipping_suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unavailable');
  END IF;

  IF (SELECT count(*) FROM public.wishlist_gifts
       WHERE giver_user_id = _giver AND created_at > now() - interval '10 minutes') >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT username INTO uname FROM public.profiles WHERE user_id = w.user_id;
  RETURN jsonb_build_object(
    'ok', true,
    'recipient_user_id', w.user_id,
    'username', uname,
    'wishlist_id', w.id,
    'wishlist_slug', w.slug,
    'item_id', it.id,
    'item_name', it.name,
    'amount_min_cents', s.amount_min_cents,
    'amount_max_cents', s.amount_max_cents,
    'rates', jsonb_build_object(
      'yooits_percent_bps', s.yooits_percent_bps,
      'yooits_fixed_cents', s.yooits_fixed_cents,
      'stripe_percent_bps', s.stripe_percent_bps,
      'stripe_fixed_cents', s.stripe_fixed_cents),
    'account', jsonb_build_object(
      'stripe_account_id', acct.stripe_account_id,
      'livemode', acct.livemode)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner console (admins)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_wishlist_gift_money()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(s) - 'id' FROM public.wishlist_gift_settings s WHERE id),
    'recipients', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'user_id', r.user_id, 'username', p.username,
        'adult_confirmed_at', r.adult_confirmed_at, 'approved_at', r.approved_at,
        'suspended_at', r.suspended_at, 'suspended_reason', r.suspended_reason))
      FROM public.wishlist_gift_recipients r
      LEFT JOIN public.profiles p ON p.user_id = r.user_id), '[]'::jsonb),
    'gifts', jsonb_build_object(
      'succeeded', (SELECT count(*) FROM public.wishlist_gifts WHERE status = 'succeeded'),
      'needs_review', (SELECT count(*) FROM public.wishlist_gifts WHERE status = 'needs_review'))
  );
END;
$$;

-- Switching on is refused (by the table's CHECK) until Stripe's written
-- approval is recorded with _stripe_approval_note.
CREATE OR REPLACE FUNCTION public.owner_set_wishlist_gift_settings(
  _enabled boolean DEFAULT NULL,
  _checkout_enabled boolean DEFAULT NULL,
  _stripe_approval_note text DEFAULT NULL,
  _yooits_percent_bps integer DEFAULT NULL,
  _yooits_fixed_cents integer DEFAULT NULL,
  _stripe_percent_bps integer DEFAULT NULL,
  _stripe_fixed_cents integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before jsonb;
  after jsonb;
  note text := nullif(left(btrim(coalesce(_stripe_approval_note, '')), 500), '');
BEGIN
  PERFORM public.owner_require_admin();
  SELECT to_jsonb(s) - 'id' INTO before FROM public.wishlist_gift_settings s WHERE id;
  UPDATE public.wishlist_gift_settings
     SET enabled = coalesce(_enabled, enabled),
         checkout_enabled = coalesce(_checkout_enabled, checkout_enabled),
         stripe_approval_note = coalesce(note, stripe_approval_note),
         stripe_approved_at = CASE WHEN note IS NOT NULL THEN coalesce(stripe_approved_at, now())
                                   ELSE stripe_approved_at END,
         yooits_percent_bps = coalesce(_yooits_percent_bps, yooits_percent_bps),
         yooits_fixed_cents = coalesce(_yooits_fixed_cents, yooits_fixed_cents),
         stripe_percent_bps = coalesce(_stripe_percent_bps, stripe_percent_bps),
         stripe_fixed_cents = coalesce(_stripe_fixed_cents, stripe_fixed_cents),
         updated_at = now(), updated_by = auth.uid()
   WHERE id;
  SELECT to_jsonb(s) - 'id' INTO after FROM public.wishlist_gift_settings s WHERE id;
  PERFORM public.write_admin_audit('wishlist_gifts.settings', 'setting', 'wishlist_gifts',
                                   jsonb_build_object('before', before, 'after', after));
  RETURN after;
END;
$$;

-- Approve, revoke or suspend one list owner for gift money.
-- _adult_confirmed records the account holder's own 18+ statement.
CREATE OR REPLACE FUNCTION public.owner_set_wishlist_gift_recipient(
  _user_id uuid,
  _approved boolean,
  _adult_confirmed boolean DEFAULT NULL,
  _suspended boolean DEFAULT NULL,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.wishlist_gift_recipients;
BEGIN
  PERFORM public.owner_require_admin();
  INSERT INTO public.wishlist_gift_recipients (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.wishlist_gift_recipients
     SET approved_at = CASE WHEN _approved THEN coalesce(approved_at, now()) ELSE NULL END,
         approved_by = CASE WHEN _approved THEN auth.uid() ELSE NULL END,
         adult_confirmed_at = CASE WHEN _adult_confirmed IS NULL THEN adult_confirmed_at
                                   WHEN _adult_confirmed THEN coalesce(adult_confirmed_at, now())
                                   ELSE NULL END,
         suspended_at = CASE WHEN _suspended IS NULL THEN suspended_at
                             WHEN _suspended THEN now() ELSE NULL END,
         suspended_reason = CASE WHEN _suspended THEN left(_reason, 200)
                                 WHEN _suspended IS NULL THEN suspended_reason ELSE NULL END
   WHERE user_id = _user_id
  RETURNING * INTO rec;
  PERFORM public.write_admin_audit('wishlist_gifts.recipient', 'user', _user_id::text,
                                   to_jsonb(rec) - 'user_id');
  RETURN to_jsonb(rec);
END;
$$;

REVOKE ALL ON FUNCTION public.wishlist_gift_checkout_gate(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wishlist_gift_checkout_gate(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.owner_wishlist_gift_money() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_wishlist_gift_settings(boolean, boolean, text, integer, integer, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_wishlist_gift_recipient(uuid, boolean, boolean, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_wishlist_gift_money() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_wishlist_gift_settings(boolean, boolean, text, integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_wishlist_gift_recipient(uuid, boolean, boolean, boolean, text) TO authenticated;
