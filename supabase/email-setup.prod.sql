-- One-time production setup for Yooits email, run AFTER
-- migrations/20261122160000_email_system.sql. Not a migration: it holds a
-- secret and turns on scheduling, so it is run by hand once approved.
--
-- What it does:
--   1. Turns on pg_net (HTTP calls from the database) and pg_cron (schedule).
--   2. Makes a random dispatcher secret inside Supabase Vault. The app checks
--      the secret against Vault, so it is never copied or shown anywhere.
--   3. Points the database at https://yooits.me/api/email/dispatch.
--   4. Asks the dispatcher to send every minute (retries and status checks).
--
-- Undo: SELECT cron.unschedule('yooits-email-dispatch');
--       UPDATE public.email_settings SET dispatch_url = NULL WHERE id;
--       DELETE FROM vault.secrets WHERE name = 'email_dispatch_secret';

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'email_dispatch_secret', 'Yooits email dispatcher')
 WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'email_dispatch_secret');

UPDATE public.email_settings SET dispatch_url = 'https://yooits.me/api/email/dispatch' WHERE id;

SELECT cron.schedule('yooits-email-dispatch', '* * * * *', $$SELECT public.email_kick()$$);
