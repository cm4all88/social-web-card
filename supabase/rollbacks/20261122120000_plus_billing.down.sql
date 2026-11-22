-- Rollback for 20261122120000_plus_billing.sql.
-- Refuses to run once any billing record exists: those are payment records and
-- must not be deleted (cancel in Stripe and keep the rows instead).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.plus_subscriptions) OR EXISTS (SELECT 1 FROM public.billing_customers) THEN
    RAISE EXCEPTION 'Plus billing records exist; not rolling back (they are payment records).';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.owner_plus_summary();
DROP TRIGGER IF EXISTS profiles_enforce_plus_features ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_enforce_plus_features();
DROP FUNCTION IF EXISTS public.my_plan();
DROP FUNCTION IF EXISTS public.public_profile_is_plus(uuid);

-- current_plan exactly as 20261121230000_founding_creator_beta.sql left it.
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
  ) THEN 'plus' ELSE 'free' END
$$;

DROP FUNCTION IF EXISTS public.plus_status_is_active(text);
DROP TABLE IF EXISTS public.plus_subscriptions;
DROP TABLE IF EXISTS public.billing_customers;
DROP FUNCTION IF EXISTS public.theme_is_premium(text);
ALTER TABLE public.profiles DROP COLUMN IF EXISTS hide_branding;
