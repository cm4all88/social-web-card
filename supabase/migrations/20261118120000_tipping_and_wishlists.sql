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

-- ---------------------------------------------------------------------------
-- Stripe webhook event log for idempotency (server-only; no policies).
-- ---------------------------------------------------------------------------
CREATE TABLE public.stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  account text,
  livemode boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

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
    'platform_fee_cents', (SELECT coalesce(sum(platform_fee_cents), 0) FROM t),
    'platform_fee_refunded_cents', (SELECT coalesce(sum(platform_fee_refunded_cents), 0) FROM t),
    'net_platform_fee_cents',
      (SELECT coalesce(sum(platform_fee_cents - platform_fee_refunded_cents), 0) FROM t),
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
    'needs_review_tips', (SELECT count(*) FROM public.tips WHERE status = 'needs_review')
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tip_report(timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_tip_report(timestamptz) TO authenticated;

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
