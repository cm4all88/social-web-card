-- Yooits Plus: $4.99 a month through Stripe Billing on Yooits' own Stripe
-- account, plus the first two Plus benefits (premium themes and hiding the
-- "Get your own Yooits" line). Unlimited links stay free for everyone.
--
-- * billing_customers and plus_subscriptions mirror Stripe. They are written
--   only by the server (service role) from Stripe's own data, never from the
--   browser. Subscription rows are payment records: they are kept when an
--   account is deleted (user_id becomes NULL), like tips.
-- * current_plan() now reads 'plus' for an active Founding Members grant OR a
--   subscription Stripe reports as active, trialing or past_due (Stripe is
--   still retrying the card). Everything else reads 'free'.
-- * The two benefits are settings on the profile. A trigger lets a creator
--   turn them on only while on Plus. When Plus ends nothing is changed or
--   deleted: the public page simply ignores the settings again (branding
--   shows, a premium theme falls back to a free one) until Plus returns.
-- * public_profile_is_plus() tells the public page whether to honour them.
--
-- Safe to apply to a database with users: adds one column with a default,
-- two tables, functions and one trigger. No existing row is changed except
-- that every profile gets hide_branding = false.

-- ---------------------------------------------------------------------------
-- 1. Profile settings for the Plus benefits
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN hide_branding boolean NOT NULL DEFAULT false;

-- Premium theme keys (mirrors PREMIUM_THEME_KEYS in src/lib/themes.ts).
CREATE OR REPLACE FUNCTION public.theme_is_premium(_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(_key IN ('aurora', 'obsidian', 'sakura', 'glacier', 'ember', 'gilded'), false)
$$;

-- ---------------------------------------------------------------------------
-- 2. Billing records (mirrors of Stripe, server-written only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.billing_customers (
  stripe_customer_id text PRIMARY KEY CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  user_id uuid UNIQUE REFERENCES auth.users (id) ON DELETE SET NULL,
  livemode boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read billing customers"
  ON public.billing_customers FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- No write policies: written by the server only.

CREATE TABLE public.plus_subscriptions (
  stripe_subscription_id text PRIMARY KEY CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  stripe_customer_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due',
    'canceled', 'unpaid', 'paused')),
  price_id text,
  unit_amount_cents integer CHECK (unit_amount_cents IS NULL OR unit_amount_cents >= 0),
  currency text,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,
  livemode boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_plus_subscriptions_user ON public.plus_subscriptions (user_id, status);

ALTER TABLE public.plus_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own Plus subscriptions"
  ON public.plus_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
-- No write policies: written by the server only.

-- Statuses that keep Plus on.
CREATE OR REPLACE FUNCTION public.plus_status_is_active(_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(_status IN ('active', 'trialing', 'past_due'), false)
$$;

-- ---------------------------------------------------------------------------
-- 3. Plan: Founding Members grant or a paid subscription
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_plan(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.plan_entitlements e
     WHERE e.user_id = _user_id AND e.plan = 'plus'
       AND e.revoked_at IS NULL AND now() >= e.starts_at AND now() < e.ends_at
  ) OR EXISTS (
    SELECT 1 FROM public.plus_subscriptions s
     WHERE s.user_id = _user_id AND public.plus_status_is_active(s.status)
  ) THEN 'plus' ELSE 'free' END
$$;
-- Grants on current_plan are unchanged (service_role only).

-- For the public page: whether to honour this creator's Plus settings.
CREATE OR REPLACE FUNCTION public.public_profile_is_plus(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_plan(_user_id) = 'plus'
$$;

REVOKE ALL ON FUNCTION public.public_profile_is_plus(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.public_profile_is_plus(uuid) TO anon, authenticated;

-- For the signed-in creator's dashboard.
CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN 'free' ELSE public.current_plan(auth.uid()) END
$$;

REVOKE ALL ON FUNCTION public.my_plan() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_plan() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Plus benefits can only be switched on while on Plus
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_enforce_plus_features()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hide_branding
     AND (TG_OP = 'INSERT' OR NOT OLD.hide_branding)
     AND public.current_plan(NEW.user_id) <> 'plus' THEN
    RAISE EXCEPTION 'Hiding Yooits branding is part of Plus.' USING ERRCODE = '42501';
  END IF;
  IF public.theme_is_premium(NEW.theme)
     AND (TG_OP = 'INSERT' OR NEW.theme IS DISTINCT FROM OLD.theme)
     AND public.current_plan(NEW.user_id) <> 'plus' THEN
    RAISE EXCEPTION 'This theme is part of Plus.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_enforce_plus_features
  BEFORE INSERT OR UPDATE OF hide_branding, theme ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_enforce_plus_features();

-- ---------------------------------------------------------------------------
-- 5. Owner view: who is on Plus (live and test counted apart)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_plus_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.owner_plus_summary() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_plus_summary() TO authenticated;
