-- Removes the owner Payments page's record of Stripe setup. The webhook
-- endpoints stay in Stripe; with this table gone the webhook routes fall back
-- to the STRIPE_*_WEBHOOK_SECRET variables in Vercel.
DROP TABLE IF EXISTS public.stripe_setup_items;
