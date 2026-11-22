-- Stripe setup made by the owner's Payments page (Owner > Payments), one row
-- per item and Stripe mode: the webhook endpoints Yooits created, their
-- signing secrets (encrypted with a key derived from the Stripe secret key,
-- so this table alone can't verify or forge a webhook), and the billing
-- portal configuration. Server only: no browser role can read it.
-- Turning a payment feature on is still a separate, deliberate switch.

CREATE TABLE IF NOT EXISTS public.stripe_setup_items (
  item text NOT NULL CHECK (item IN ('billing_webhook', 'payments_webhook', 'connect_webhook', 'portal_configuration')),
  livemode boolean NOT NULL,
  stripe_account_id text NOT NULL,
  object_id text NOT NULL,
  url text,
  secret_ciphertext text,
  secret_iv text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item, livemode)
);
ALTER TABLE public.stripe_setup_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stripe_setup_items FROM public, anon, authenticated;
GRANT ALL ON TABLE public.stripe_setup_items TO service_role;
