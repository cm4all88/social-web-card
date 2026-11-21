-- Yooits tipping (Stripe Connect) + shareable wishlists.
--
-- NOT APPLIED. Ships as a file in the PR; apply to a dev/staging Supabase
-- project first.
--
-- Security model
--   * Anything that reflects payment state (connected account status, tips,
--     webhook events, checkout attempts) is written ONLY by the server with the
--     service role key. Those tables have RLS on and no INSERT/UPDATE/DELETE
--     policies, so the browser can never write them.
--   * The `profiles` UPDATE policy lets users change every column of their own
--     row, so no payment state lives on `profiles`.
--   * Creator-editable preferences (tip_settings, wishlists, wishlist_items)
--     are owner-writable through RLS; the server re-checks eligibility before
--     every checkout and never trusts these rows alone.

-- ---------------------------------------------------------------------------
-- Connected Stripe accounts (server-written only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.creator_payment_accounts (
  user_id uuid PRIMARY KEY,
  stripe_account_id text NOT NULL UNIQUE,
  -- No row = not started. pending | restricted | connected | disconnected
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'restricted', 'connected', 'disconnected')),
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  disabled_reason text,
  requirements_due_count integer NOT NULL DEFAULT 0,
  country text,
  default_currency text,
  livemode boolean NOT NULL DEFAULT false,
  -- Set by a Yooits admin (admin_set_tip_suspension) to stop a creator taking
  -- tips, e.g. when an account looks like personal money transfers.
  tipping_suspended_at timestamptz,
  tipping_suspended_reason text
    CHECK (tipping_suspended_reason IS NULL OR char_length(tipping_suspended_reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creator_payment_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators view own payment account"
  ON public.creator_payment_accounts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER creator_payment_accounts_updated_at
  BEFORE UPDATE ON public.creator_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Creator tipping preferences (owner-writable)
-- ---------------------------------------------------------------------------
CREATE TABLE public.tip_settings (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  show_on_profile boolean NOT NULL DEFAULT true,
  button_text text NOT NULL DEFAULT 'Send a tip'
    CHECK (char_length(btrim(button_text)) BETWEEN 1 AND 40),
  -- Tipping is only for people who provide content or a service (Stripe does
  -- not support personal or peer-to-peer money transfers). The creator says
  -- what they do and what supporters are tipping for, and confirms it; the
  -- server checks this (plus at least one public link) before onboarding and
  -- before every checkout. Values match src/lib/tipping/eligibility.ts.
  creator_type text
    CHECK (creator_type IS NULL OR creator_type IN
      ('content_creator', 'artist', 'writer', 'educator', 'service_provider')),
  offering text
    CHECK (offering IS NULL OR char_length(btrim(offering)) BETWEEN 10 AND 160),
  attested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tip_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators view own tip settings"
  ON public.tip_settings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Creators insert own tip settings"
  ON public.tip_settings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Creators update own tip settings"
  ON public.tip_settings FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER tip_settings_updated_at
  BEFORE UPDATE ON public.tip_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tips (server-written only). Amounts are integer cents, set by the server.
-- ---------------------------------------------------------------------------
CREATE TABLE public.tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL,
  stripe_account_id text NOT NULL,
  checkout_session_id text UNIQUE,
  payment_intent_id text UNIQUE,
  charge_id text,
  -- The application fee Stripe actually collected (from the charge or the
  -- application_fee.* events). NULL until Stripe has confirmed it.
  application_fee_id text UNIQUE,
  application_fee_cents integer CHECK (application_fee_cents IS NULL OR application_fee_cents >= 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  tip_amount_cents integer NOT NULL CHECK (tip_amount_cents >= 500),
  platform_fee_cents integer NOT NULL CHECK (platform_fee_cents >= 0),
  total_cents integer NOT NULL,
  -- pending -> succeeded | failed | expired ; needs_review if Stripe's numbers
  -- don't match what the server created.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'expired', 'needs_review')),
  amount_refunded_cents integer NOT NULL DEFAULT 0 CHECK (amount_refunded_cents >= 0),
  platform_fee_refunded_cents integer NOT NULL DEFAULT 0 CHECK (platform_fee_refunded_cents >= 0),
  dispute_status text,
  dispute_amount_cents integer,
  supporter_name text CHECK (supporter_name IS NULL OR char_length(supporter_name) <= 50),
  supporter_message text CHECK (supporter_message IS NULL OR char_length(supporter_message) <= 280),
  source text NOT NULL DEFAULT 'profile' CHECK (source IN ('profile', 'link')),
  livemode boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tips_total_matches CHECK (total_cents = tip_amount_cents + platform_fee_cents)
);

CREATE INDEX idx_tips_creator_created ON public.tips (creator_user_id, created_at DESC);
CREATE INDEX idx_tips_status ON public.tips (status);
CREATE INDEX idx_tips_charge ON public.tips (charge_id);

ALTER TABLE public.tips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators view own tips"
  ON public.tips FOR SELECT
  TO authenticated
  USING (creator_user_id = auth.uid());

CREATE TRIGGER tips_updated_at
  BEFORE UPDATE ON public.tips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Rate limiting for public checkout creation (server-only; no policies).
-- Stores a salted SHA-256 of the IP, never the IP itself.
-- ---------------------------------------------------------------------------
CREATE TABLE public.checkout_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL,
  creator_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checkout_attempts_ip ON public.checkout_attempts (ip_hash, created_at DESC);
CREATE INDEX idx_checkout_attempts_creator ON public.checkout_attempts (creator_user_id, created_at DESC);

ALTER TABLE public.checkout_attempts ENABLE ROW LEVEL SECURITY;

-- Atomic check-and-record. Advisory locks serialise attempts for the same
-- creator and the same IP, so concurrent requests can't all see "under the
-- limit" and slip through. Locks are always taken creator first, then IP, so
-- two calls can never wait on each other in a cycle. Returns true when the
-- attempt is allowed (and recorded), false when a limit is reached.
CREATE OR REPLACE FUNCTION public.record_checkout_attempt(
  _ip_hash text,
  _creator_user_id uuid,
  _ip_limit integer,
  _ip_window_seconds integer,
  _creator_limit integer,
  _creator_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('yooits_tip_creator:' || _creator_user_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('yooits_tip_ip:' || _ip_hash, 0));

  IF (SELECT count(*) FROM public.checkout_attempts
        WHERE ip_hash = _ip_hash
          AND created_at > clock_timestamp() - make_interval(secs => _ip_window_seconds)) >= _ip_limit
     OR (SELECT count(*) FROM public.checkout_attempts
        WHERE creator_user_id = _creator_user_id
          AND created_at > clock_timestamp() - make_interval(secs => _creator_window_seconds)) >= _creator_limit
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.checkout_attempts (ip_hash, creator_user_id, created_at)
  VALUES (_ip_hash, _creator_user_id, clock_timestamp());

  -- Occasionally drop rows older than any window.
  IF random() < 0.02 THEN
    DELETE FROM public.checkout_attempts WHERE created_at < clock_timestamp() - interval '1 day';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_checkout_attempt(text, uuid, integer, integer, integer, integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_checkout_attempt(text, uuid, integer, integer, integer, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Stripe webhook event log for idempotency (server-only; no policies).
-- ---------------------------------------------------------------------------
CREATE TABLE public.stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  account text,
  livemode boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- Set when a webhook delivery starts handling the event; cleared if it fails.
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  processed_at timestamptz
);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

-- Atomically claim an event for processing. INSERT ... ON CONFLICT DO UPDATE
-- locks the row, so of several concurrent deliveries of the same event exactly
-- one gets 'claimed'; the others get 'in_progress' (answer 500, Stripe retries)
-- or 'duplicate' once it's done. A claim older than the lease (a crashed
-- worker) can be taken over.
CREATE OR REPLACE FUNCTION public.claim_stripe_event(
  _id text,
  _type text,
  _account text,
  _livemode boolean,
  _lease_seconds integer DEFAULT 120
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_claimed boolean;
  v_processed timestamptz;
BEGIN
  INSERT INTO public.stripe_events AS e (id, type, account, livemode, claimed_at, attempts)
  VALUES (_id, _type, _account, _livemode, clock_timestamp(), 1)
  ON CONFLICT (id) DO UPDATE
    SET claimed_at = clock_timestamp(), attempts = e.attempts + 1
    WHERE e.processed_at IS NULL
      AND (e.claimed_at IS NULL
           OR e.claimed_at < clock_timestamp() - make_interval(secs => _lease_seconds))
  RETURNING true INTO v_claimed;

  IF v_claimed THEN
    RETURN 'claimed';
  END IF;
  SELECT processed_at INTO v_processed FROM public.stripe_events WHERE id = _id;
  RETURN CASE WHEN v_processed IS NOT NULL THEN 'duplicate' ELSE 'in_progress' END;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text, text, boolean, integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_event(text, text, text, boolean, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Platform revenue report (Yooits admins only).
-- ---------------------------------------------------------------------------
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
    WHERE status = 'succeeded'
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
      (SELECT count(*) FROM public.creator_payment_accounts WHERE status = 'connected'),
    'pending_connected_creators',
      (SELECT count(*) FROM public.creator_payment_accounts WHERE status IN ('pending', 'restricted')),
    'suspended_creators',
      (SELECT count(*) FROM public.creator_payment_accounts WHERE tipping_suspended_at IS NOT NULL),
    'needs_review_tips', (SELECT count(*) FROM public.tips WHERE status = 'needs_review')
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tip_report(timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_tip_report(timestamptz) TO authenticated;

-- Yooits admins can stop (or restore) tipping for one creator by username.
-- Returns false when the user has no payment account.
CREATE OR REPLACE FUNCTION public.admin_set_tip_suspension(
  _username text,
  _suspended boolean,
  _reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT user_id INTO v_user FROM public.profiles WHERE username = lower(btrim(_username));
  IF v_user IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.creator_payment_accounts
     SET tipping_suspended_at = CASE WHEN _suspended THEN now() ELSE NULL END,
         tipping_suspended_reason = CASE WHEN _suspended THEN left(_reason, 200) ELSE NULL END
   WHERE user_id = v_user;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF _suspended THEN
    UPDATE public.tip_settings SET enabled = false WHERE user_id = v_user;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_tip_suspension(text, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_tip_suspension(text, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Wishlists (owner-writable; public ones readable by anyone)
--
-- Link-out only: no money moves through Yooits for wishlists. Stripe does not
-- permit personal cash gifts / peer-to-peer transfers, so there is deliberately
-- no cash-gift or tip column here.
-- ---------------------------------------------------------------------------
CREATE TABLE public.wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$'),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  occasion text CHECK (occasion IS NULL OR char_length(occasion) <= 40),
  event_date date,
  -- 'public': anyone with the link can view; 'private': owner only.
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  show_on_profile boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

CREATE INDEX idx_wishlists_user ON public.wishlists (user_id, display_order);

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public wishlists are viewable"
  ON public.wishlists FOR SELECT
  USING (visibility = 'public');

CREATE POLICY "Owners view own wishlists"
  ON public.wishlists FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Owners insert own wishlists"
  ON public.wishlists FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owners update own wishlists"
  ON public.wishlists FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owners delete own wishlists"
  ON public.wishlists FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER wishlists_updated_at
  BEFORE UPDATE ON public.wishlists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlist_id uuid NOT NULL REFERENCES public.wishlists (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  -- External links only, http(s) only. No javascript:, data:, etc.
  url text CHECK (url IS NULL OR (url ~* '^https?://[^\s]+$' AND char_length(url) <= 2048)),
  image_url text CHECK (image_url IS NULL OR (image_url ~* '^https://[^\s]+$' AND char_length(image_url) <= 2048)),
  price_text text CHECK (price_text IS NULL OR char_length(price_text) <= 30),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wishlist_items_list ON public.wishlist_items (wishlist_id, display_order);

ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Items of public wishlists are viewable"
  ON public.wishlist_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.wishlists w
    WHERE w.id = wishlist_items.wishlist_id AND w.visibility = 'public'
  ));

CREATE POLICY "Owners view own items"
  ON public.wishlist_items FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Owners may only attach items to wishlists they own.
CREATE POLICY "Owners insert own items"
  ON public.wishlist_items FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.wishlists w WHERE w.id = wishlist_id AND w.user_id = auth.uid())
  );

CREATE POLICY "Owners update own items"
  ON public.wishlist_items FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.wishlists w WHERE w.id = wishlist_id AND w.user_id = auth.uid())
  );

CREATE POLICY "Owners delete own items"
  ON public.wishlist_items FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER wishlist_items_updated_at
  BEFORE UPDATE ON public.wishlist_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
