-- Branded Yooits email: one queue for every email the app sends.
--
-- What this adds (nothing existing is changed or removed):
--  - email_settings: one row of switches (per category) the owner flips in
--    the Owner Console, plus the admin alert address and a daily cap.
--  - email_outbox: every email, queued by database triggers or the server,
--    and its delivery status. The app's dispatcher (/api/email/dispatch)
--    renders and sends queued rows through Resend, with retries.
--  - email_preferences: each person's choices for optional email, and the
--    token their unsubscribe links carry. Marketing is off until they opt in.
--  - email_suppressions: addresses that bounced, complained or opted out of
--    everything; nothing optional is sent to them again.
--  - email_events: provider events (delivered, bounced...) for the log.
--  - Triggers that queue email for real events: sign-up, password and email
--    changes, Plus, Founding Member, tips, payouts, account status, direct
--    messages, reports, feedback and wishlists going public.
--  - email_kick(): asks the dispatcher to run (through pg_net) when there is
--    work. It does nothing until the dispatcher URL and secret are set.
-- Account, security and billing email can't be unsubscribed from; it is the
-- email a person needs to keep their account.
-- Rollback: supabase/rollbacks/20261122160000_email_system.down.sql

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
CREATE TABLE public.email_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Master switch. Off: emails are logged as skipped instead of sent.
  sending_enabled boolean NOT NULL DEFAULT true,
  account_enabled boolean NOT NULL DEFAULT true,
  security_enabled boolean NOT NULL DEFAULT true,
  billing_enabled boolean NOT NULL DEFAULT true,
  messages_enabled boolean NOT NULL DEFAULT true,
  activity_enabled boolean NOT NULL DEFAULT true,
  admin_enabled boolean NOT NULL DEFAULT true,
  -- Marketing (announcements, promotions, referrals) stays off until the owner
  -- turns it on, and even then reaches only people who opted in.
  marketing_enabled boolean NOT NULL DEFAULT false,
  admin_email text NOT NULL DEFAULT 'admin@tahomaindustries.com'
    CHECK (admin_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND char_length(admin_email) <= 254),
  -- Most optional (messages, activity, marketing) emails sent per UTC day.
  -- Account, security, billing and admin email is never held back by it.
  daily_optional_limit integer NOT NULL DEFAULT 80 CHECK (daily_optional_limit BETWEEN 0 AND 100000),
  -- Where email_kick() calls the dispatcher. NULL = don't call.
  dispatch_url text CHECK (dispatch_url IS NULL OR dispatch_url ~ '^https://[^\s]+$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.email_settings (id) VALUES (true);
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_settings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- The queue and delivery log
-- ---------------------------------------------------------------------------
CREATE TABLE public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template text NOT NULL CHECK (template ~ '^[a-z0-9_]{2,60}$'),
  category text NOT NULL CHECK (category IN
    ('account', 'security', 'billing', 'messages', 'activity', 'marketing', 'admin')),
  -- No foreign key: the log outlives the account it was about.
  user_id uuid,
  to_email text NOT NULL CHECK (char_length(to_email) BETWEEN 3 AND 254),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- One email per real event: a second queue call with the same key is ignored.
  dedupe_key text UNIQUE CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 200),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'sending', 'sent', 'delivered', 'delayed', 'bounced', 'complained',
    'failed', 'skipped', 'expired')),
  skip_reason text CHECK (skip_reason IS NULL OR char_length(skip_reason) <= 60),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  provider_id text CHECK (provider_id IS NULL OR char_length(provider_id) <= 200),
  subject text CHECK (subject IS NULL OR char_length(subject) <= 300),
  is_test boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  last_event text,
  last_event_at timestamptz,
  last_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_outbox_due ON public.email_outbox (next_attempt_at) WHERE status IN ('queued', 'sending');
CREATE INDEX idx_email_outbox_created ON public.email_outbox (created_at DESC);
CREATE INDEX idx_email_outbox_user ON public.email_outbox (user_id, category, created_at DESC);
CREATE INDEX idx_email_outbox_provider ON public.email_outbox (provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX idx_email_outbox_status ON public.email_outbox (status, created_at DESC);
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox FROM anon, authenticated;

CREATE TABLE public.email_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outbox_id uuid REFERENCES public.email_outbox (id) ON DELETE CASCADE,
  provider_id text,
  type text NOT NULL CHECK (char_length(type) <= 60),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 500),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_events_outbox ON public.email_events (outbox_id, occurred_at);
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_events FROM anon, authenticated;

CREATE TABLE public.email_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  messages boolean NOT NULL DEFAULT true,
  activity boolean NOT NULL DEFAULT true,
  marketing boolean NOT NULL DEFAULT false,
  marketing_consented_at timestamptz,
  unsubscribe_token text NOT NULL UNIQUE
    DEFAULT replace(gen_random_uuid()::text, '-', '') || left(replace(gen_random_uuid()::text, '-', ''), 16),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_preferences FROM anon, authenticated;

CREATE TABLE public.email_suppressions (
  email text PRIMARY KEY CHECK (email = lower(email) AND char_length(email) <= 254),
  reason text NOT NULL CHECK (reason IN ('bounced', 'complained', 'unsubscribed_all', 'owner')),
  detail text CHECK (detail IS NULL OR char_length(detail) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_suppressions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_category_is_optional(_category text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$ SELECT _category IN ('messages', 'activity', 'marketing') $$;

CREATE OR REPLACE FUNCTION public.email_category_enabled(_category text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.sending_enabled AND CASE _category
    WHEN 'account' THEN s.account_enabled
    WHEN 'security' THEN s.security_enabled
    WHEN 'billing' THEN s.billing_enabled
    WHEN 'messages' THEN s.messages_enabled
    WHEN 'activity' THEN s.activity_enabled
    WHEN 'admin' THEN s.admin_enabled
    WHEN 'marketing' THEN s.marketing_enabled
    ELSE false END
  FROM public.email_settings s WHERE s.id
$$;

-- A person's preferences row, created on first use.
CREATE OR REPLACE FUNCTION public.email_preferences_for(_user_id uuid)
RETURNS public.email_preferences
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p public.email_preferences;
BEGIN
  SELECT * INTO p FROM public.email_preferences WHERE user_id = _user_id;
  IF NOT FOUND THEN
    INSERT INTO public.email_preferences (user_id) VALUES (_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO p FROM public.email_preferences WHERE user_id = _user_id;
  END IF;
  RETURN p;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_profile_bits(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('username', p.username, 'display_name', coalesce(nullif(btrim(p.display_name), ''), p.username))
       FROM public.profiles p WHERE p.user_id = _user_id),
    '{}'::jsonb)
$$;

-- ---------------------------------------------------------------------------
-- Queue an email. Server and triggers only (service_role / definer).
-- _to_email NULL: the person's sign-in email. Returns the row id, or NULL if
-- the same dedupe key was already queued. Optional email that the person
-- turned off, that is over the hourly cap, or that goes to a suppressed
-- address is logged as skipped rather than sent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_queue(
  _template text,
  _category text,
  _user_id uuid,
  _payload jsonb DEFAULT '{}'::jsonb,
  _dedupe_key text DEFAULT NULL,
  _to_email text DEFAULT NULL,
  _is_test boolean DEFAULT false,
  _created_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _to text := lower(btrim(coalesce(_to_email, '')));
  _status text := 'queued';
  _reason text;
  _prefs public.email_preferences;
  _id uuid;
BEGIN
  IF _to = '' AND _user_id IS NOT NULL THEN
    SELECT lower(u.email) INTO _to FROM auth.users u WHERE u.id = _user_id;
  END IF;
  IF _to IS NULL OR _to = '' OR _to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN NULL; -- nobody to send to (e.g. an account with no email)
  END IF;

  IF _is_test THEN
    NULL; -- owner test sends ignore switches, preferences and caps
  ELSIF NOT public.email_category_enabled(_category) THEN
    _status := 'skipped'; _reason := 'category_off';
  ELSIF public.email_category_is_optional(_category) THEN
    IF EXISTS (SELECT 1 FROM public.email_suppressions s WHERE s.email = _to) THEN
      _status := 'skipped'; _reason := 'suppressed';
    ELSIF _user_id IS NOT NULL THEN
      _prefs := public.email_preferences_for(_user_id);
      IF (_category = 'messages' AND NOT _prefs.messages)
         OR (_category = 'activity' AND NOT _prefs.activity)
         OR (_category = 'marketing' AND NOT _prefs.marketing) THEN
        _status := 'skipped'; _reason := 'opted_out';
      ELSIF (SELECT count(*) FROM public.email_outbox o
              WHERE o.user_id = _user_id AND o.category = _category
                AND o.status <> 'skipped' AND o.created_at > now() - interval '1 hour') >= 10 THEN
        _status := 'skipped'; _reason := 'hourly_cap';
      END IF;
    ELSIF _category = 'marketing' THEN
      _status := 'skipped'; _reason := 'no_consent';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.email_suppressions s WHERE s.email = _to AND s.reason IN ('bounced', 'complained')) THEN
    _status := 'skipped'; _reason := 'suppressed';
  END IF;

  INSERT INTO public.email_outbox (template, category, user_id, to_email, payload, dedupe_key, status, skip_reason, is_test, created_by)
  VALUES (_template, _category, _user_id, _to, coalesce(_payload, '{}'::jsonb), _dedupe_key, _status, _reason, _is_test, _created_by)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- Admin alert to the owner's address.
CREATE OR REPLACE FUNCTION public.email_queue_admin(_template text, _payload jsonb, _dedupe_key text)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.email_queue(_template, 'admin', NULL, _payload, _dedupe_key,
                            (SELECT admin_email FROM public.email_settings WHERE id))
$$;

-- ---------------------------------------------------------------------------
-- Dispatcher calls (service_role)
-- ---------------------------------------------------------------------------
-- Claim up to _limit due emails. Rows stuck in 'sending' past their lock are
-- picked up again. Emails that waited too long (the sender wasn't set up yet)
-- are expired instead of arriving days late; security email keeps 3 days.
CREATE OR REPLACE FUNCTION public.email_claim_batch(_limit integer DEFAULT 20)
RETURNS SETOF public.email_outbox
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _optional_today integer;
  _optional_left integer;
  _cap integer;
BEGIN
  UPDATE public.email_outbox SET status = 'expired', skip_reason = 'too_old', updated_at = now()
   WHERE status = 'queued' AND NOT is_test
     AND created_at < now() - CASE WHEN category IN ('security', 'billing') THEN interval '3 days'
                                   WHEN category = 'marketing' THEN interval '7 days'
                                   ELSE interval '1 day' END;

  SELECT daily_optional_limit INTO _cap FROM public.email_settings WHERE id;
  SELECT count(*) INTO _optional_today FROM public.email_outbox
   WHERE public.email_category_is_optional(category) AND NOT is_test
     AND sent_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc';
  _optional_left := greatest(coalesce(_cap, 0) - _optional_today, 0);

  RETURN QUERY
  WITH locked AS (
    SELECT o.id, o.category, o.is_test, o.created_at
      FROM public.email_outbox o
     WHERE ((o.status = 'queued' AND o.next_attempt_at <= now())
         OR (o.status = 'sending' AND o.locked_until < now()))
     ORDER BY CASE WHEN o.category IN ('security', 'account', 'billing') THEN 0 ELSE 1 END, o.created_at
     LIMIT greatest(least(_limit, 100), 1) * 4
     FOR UPDATE SKIP LOCKED
  ), ranked AS (
    SELECT l.id, l.created_at, l.category,
           public.email_category_is_optional(l.category) AND NOT l.is_test AS optional,
           row_number() OVER (PARTITION BY public.email_category_is_optional(l.category) AND NOT l.is_test
                              ORDER BY l.created_at) AS rn
      FROM locked l
  ), picked AS (
    SELECT r.id FROM ranked r
     WHERE NOT r.optional OR r.rn <= _optional_left
     ORDER BY CASE WHEN r.category IN ('security', 'account', 'billing') THEN 0 ELSE 1 END, r.created_at
     LIMIT greatest(least(_limit, 100), 1)
  )
  UPDATE public.email_outbox o
     SET status = 'sending', attempts = o.attempts + 1,
         locked_until = now() + interval '2 minutes', updated_at = now()
    FROM picked WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;

-- Record a send attempt. Retries back off 1, 5, 30, 120 then 360 minutes;
-- after 6 attempts the email is marked failed.
CREATE OR REPLACE FUNCTION public.email_mark_result(
  _id uuid,
  _ok boolean,
  _provider_id text DEFAULT NULL,
  _subject text DEFAULT NULL,
  _error text DEFAULT NULL,
  _retryable boolean DEFAULT true
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.email_outbox;
  _delay interval;
BEGIN
  SELECT * INTO o FROM public.email_outbox WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF _ok THEN
    UPDATE public.email_outbox
       SET status = 'sent', provider_id = left(_provider_id, 200), subject = left(coalesce(_subject, subject), 300),
           sent_at = now(), locked_until = NULL, last_error = NULL, updated_at = now()
     WHERE id = _id;
    INSERT INTO public.email_events (outbox_id, provider_id, type) VALUES (_id, left(_provider_id, 200), 'sent');
    RETURN 'sent';
  END IF;
  IF NOT _retryable OR o.attempts >= 6 THEN
    UPDATE public.email_outbox
       SET status = 'failed', last_error = left(_error, 500), subject = left(coalesce(_subject, subject), 300),
           locked_until = NULL, updated_at = now()
     WHERE id = _id;
    INSERT INTO public.email_events (outbox_id, type, detail) VALUES (_id, 'failed', left(_error, 500));
    RETURN 'failed';
  END IF;
  _delay := CASE o.attempts WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes'
                            WHEN 3 THEN interval '30 minutes' WHEN 4 THEN interval '2 hours'
                            ELSE interval '6 hours' END;
  UPDATE public.email_outbox
     SET status = 'queued', next_attempt_at = now() + _delay, last_error = left(_error, 500),
         subject = left(coalesce(_subject, subject), 300), locked_until = NULL, updated_at = now()
   WHERE id = _id;
  INSERT INTO public.email_events (outbox_id, type, detail) VALUES (_id, 'retry_scheduled', left(_error, 500));
  RETURN 'retry';
END;
$$;

-- A provider event (from the status check or Resend's webhook). Bounces and
-- complaints suppress the address for optional email.
CREATE OR REPLACE FUNCTION public.email_record_event(_provider_id text, _type text, _at timestamptz DEFAULT now(), _detail text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.email_outbox;
  _new text;
BEGIN
  SELECT * INTO o FROM public.email_outbox WHERE provider_id = _provider_id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  _new := CASE _type
    WHEN 'delivered' THEN 'delivered'
    WHEN 'delivery_delayed' THEN 'delayed'
    WHEN 'bounced' THEN 'bounced'
    WHEN 'complained' THEN 'complained'
    WHEN 'failed' THEN 'failed'
    ELSE NULL END;
  IF NOT EXISTS (SELECT 1 FROM public.email_events e WHERE e.outbox_id = o.id AND e.type = _type) THEN
    INSERT INTO public.email_events (outbox_id, provider_id, type, detail, occurred_at)
    VALUES (o.id, _provider_id, left(_type, 60), left(_detail, 500), coalesce(_at, now()));
  END IF;
  -- A later 'delayed' never overwrites a final state.
  IF _new IS NOT NULL AND NOT (_new = 'delayed' AND o.status IN ('delivered', 'bounced', 'complained', 'failed')) THEN
    UPDATE public.email_outbox
       SET status = _new,
           delivered_at = CASE WHEN _new = 'delivered' THEN coalesce(_at, now()) ELSE delivered_at END,
           last_event = _type, last_event_at = coalesce(_at, now()), last_checked_at = now(), updated_at = now()
     WHERE id = o.id;
  ELSE
    UPDATE public.email_outbox SET last_event = _type, last_event_at = coalesce(_at, now()), last_checked_at = now(), updated_at = now()
     WHERE id = o.id;
  END IF;
  IF _type IN ('bounced', 'complained') AND NOT o.is_test THEN
    INSERT INTO public.email_suppressions (email, reason, detail)
    VALUES (o.to_email, _type, left(_detail, 300))
    ON CONFLICT (email) DO NOTHING;
  END IF;
  RETURN coalesce(_new, _type);
END;
$$;

-- Sent emails whose delivery hasn't been confirmed yet, for the status check.
CREATE OR REPLACE FUNCTION public.email_needing_status(_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, provider_id text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.email_outbox o SET last_checked_at = now()
   WHERE o.id IN (
     SELECT x.id FROM public.email_outbox x
      WHERE x.status IN ('sent', 'delayed') AND x.provider_id IS NOT NULL
        AND x.sent_at > now() - interval '3 days' AND x.sent_at < now() - interval '30 seconds'
        AND (x.last_checked_at IS NULL OR x.last_checked_at < now() - interval '10 minutes')
      ORDER BY x.sent_at LIMIT greatest(least(_limit, 50), 1))
  RETURNING o.id, o.provider_id
$$;

-- ---------------------------------------------------------------------------
-- Asking the dispatcher to run (pg_net). Safe without pg_net or the secret:
-- it then does nothing and the cron job or the app picks the work up.
-- The secret lives in Supabase Vault under the name email_dispatch_secret.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_kick()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _url text;
  _secret text;
BEGIN
  SELECT dispatch_url INTO _url FROM public.email_settings WHERE id;
  IF _url IS NULL OR to_regproc('net.http_post') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.email_outbox o
     WHERE (o.status = 'queued' AND o.next_attempt_at <= now())
        OR (o.status = 'sending' AND o.locked_until < now())
        OR (o.status IN ('sent', 'delayed') AND o.provider_id IS NOT NULL
            AND o.sent_at > now() - interval '3 days' AND o.sent_at < now() - interval '30 seconds'
            AND (o.last_checked_at IS NULL OR o.last_checked_at < now() - interval '10 minutes'))
  ) THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
    INTO _secret USING 'email_dispatch_secret';
  IF _secret IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    USING _url, '{}'::jsonb,
          jsonb_build_object('content-type', 'application/json', 'x-email-dispatch-secret', _secret);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false; -- never let a failed kick break the write that queued the email
END;
$$;

-- The dispatcher checks the secret it was called with against Vault, so the
-- secret never has to be copied anywhere else.
CREATE OR REPLACE FUNCTION public.email_dispatch_token_ok(_token text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _secret text;
BEGIN
  IF _token IS NULL OR length(_token) < 32 OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
    INTO _secret USING 'email_dispatch_secret';
  RETURN _secret IS NOT NULL AND _secret = _token;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.email_outbox_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM new_rows WHERE status = 'queued') THEN
    PERFORM public.email_kick();
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER email_outbox_kick
  AFTER INSERT ON public.email_outbox
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.email_outbox_after_insert();

-- ---------------------------------------------------------------------------
-- Unsubscribe and preferences (by link token, no sign-in needed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_preferences_by_token(_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('messages', p.messages, 'activity', p.activity, 'marketing', p.marketing,
                            'email', regexp_replace(u.email, '^(.).*(@.*)$', '\1***\2'))
    FROM public.email_preferences p
    LEFT JOIN auth.users u ON u.id = p.user_id
   WHERE _token ~ '^[0-9a-f]{48}$' AND p.unsubscribe_token = _token
$$;

-- _category: 'messages', 'activity', 'marketing' or 'all'. Returns the
-- preferences after the change, or NULL for an unknown token.
CREATE OR REPLACE FUNCTION public.email_unsubscribe(_token text, _category text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p public.email_preferences;
BEGIN
  IF _token IS NULL OR _token !~ '^[0-9a-f]{48}$' OR _category NOT IN ('messages', 'activity', 'marketing', 'all') THEN
    RETURN NULL;
  END IF;
  UPDATE public.email_preferences
     SET messages = CASE WHEN _category IN ('messages', 'all') THEN false ELSE messages END,
         activity = CASE WHEN _category IN ('activity', 'all') THEN false ELSE activity END,
         marketing = CASE WHEN _category IN ('marketing', 'all') THEN false ELSE marketing END,
         updated_at = now()
   WHERE unsubscribe_token = _token
  RETURNING * INTO p;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.email_preferences_by_token(_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.email_set_preferences_by_token(_token text, _messages boolean, _activity boolean, _marketing boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _token IS NULL OR _token !~ '^[0-9a-f]{48}$' THEN RETURN NULL; END IF;
  UPDATE public.email_preferences
     SET messages = coalesce(_messages, messages), activity = coalesce(_activity, activity),
         marketing_consented_at = CASE WHEN coalesce(_marketing, marketing) AND NOT marketing THEN now() ELSE marketing_consented_at END,
         marketing = coalesce(_marketing, marketing), updated_at = now()
   WHERE unsubscribe_token = _token;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN public.email_preferences_by_token(_token);
END;
$$;

-- Signed-in: my own choices (dashboard settings).
CREATE OR REPLACE FUNCTION public.my_email_preferences()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p public.email_preferences;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  p := public.email_preferences_for(auth.uid());
  RETURN jsonb_build_object('messages', p.messages, 'activity', p.activity, 'marketing', p.marketing);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_my_email_preferences(_messages boolean, _activity boolean, _marketing boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE p public.email_preferences;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  p := public.email_preferences_for(auth.uid());
  RETURN public.email_set_preferences_by_token(p.unsubscribe_token, _messages, _activity, _marketing)
         - 'email';
END;
$$;

-- The token for a person's links (server only, when rendering their email).
CREATE OR REPLACE FUNCTION public.email_unsubscribe_token(_user_id uuid)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT (public.email_preferences_for(_user_id)).unsubscribe_token $$;

-- ---------------------------------------------------------------------------
-- Owner console
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_email_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s public.email_settings;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT * INTO s FROM public.email_settings WHERE id;
  RETURN jsonb_build_object(
    'settings', jsonb_build_object(
      'sending_enabled', s.sending_enabled, 'account_enabled', s.account_enabled,
      'security_enabled', s.security_enabled, 'billing_enabled', s.billing_enabled,
      'messages_enabled', s.messages_enabled, 'activity_enabled', s.activity_enabled,
      'admin_enabled', s.admin_enabled, 'marketing_enabled', s.marketing_enabled,
      'admin_email', s.admin_email, 'daily_optional_limit', s.daily_optional_limit,
      'dispatch_url', s.dispatch_url),
    'counts_24h', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (
        SELECT status, count(*)::int AS n FROM public.email_outbox
         WHERE created_at > now() - interval '24 hours' GROUP BY status) c),
    'counts_7d', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) FROM (
        SELECT status, count(*)::int AS n FROM public.email_outbox
         WHERE created_at > now() - interval '7 days' GROUP BY status) c),
    'queued', (SELECT count(*)::int FROM public.email_outbox WHERE status IN ('queued', 'sending')),
    'suppressed', (SELECT count(*)::int FROM public.email_suppressions),
    'marketing_opted_in', (SELECT count(*)::int FROM public.email_preferences WHERE marketing),
    'last_sent_at', (SELECT max(sent_at) FROM public.email_outbox)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_email_log(_status text DEFAULT NULL, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN coalesce((SELECT jsonb_agg(r ORDER BY r.created_at DESC) FROM (
    SELECT o.id, o.template, o.category, o.user_id, o.to_email, o.status, o.skip_reason, o.attempts,
           o.last_error, o.subject, o.is_test, o.created_at, o.sent_at, o.delivered_at, o.last_event,
           o.last_event_at, o.next_attempt_at, p.username
      FROM public.email_outbox o
      LEFT JOIN public.profiles p ON p.user_id = o.user_id
     WHERE _status IS NULL OR _status = '' OR o.status = _status
        OR (_status = 'problems' AND o.status IN ('failed', 'bounced', 'complained', 'expired'))
     ORDER BY o.created_at DESC
     LIMIT least(greatest(coalesce(_limit, 50), 1), 200) OFFSET greatest(coalesce(_offset, 0), 0)) r), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_email_set_setting(_key text, _value text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  CASE _key
    WHEN 'sending_enabled' THEN UPDATE public.email_settings SET sending_enabled = _value::boolean WHERE id;
    WHEN 'account_enabled' THEN UPDATE public.email_settings SET account_enabled = _value::boolean WHERE id;
    WHEN 'security_enabled' THEN UPDATE public.email_settings SET security_enabled = _value::boolean WHERE id;
    WHEN 'billing_enabled' THEN UPDATE public.email_settings SET billing_enabled = _value::boolean WHERE id;
    WHEN 'messages_enabled' THEN UPDATE public.email_settings SET messages_enabled = _value::boolean WHERE id;
    WHEN 'activity_enabled' THEN UPDATE public.email_settings SET activity_enabled = _value::boolean WHERE id;
    WHEN 'admin_enabled' THEN UPDATE public.email_settings SET admin_enabled = _value::boolean WHERE id;
    WHEN 'marketing_enabled' THEN UPDATE public.email_settings SET marketing_enabled = _value::boolean WHERE id;
    WHEN 'admin_email' THEN UPDATE public.email_settings SET admin_email = lower(btrim(_value)) WHERE id;
    WHEN 'daily_optional_limit' THEN UPDATE public.email_settings SET daily_optional_limit = _value::integer WHERE id;
    ELSE RAISE EXCEPTION 'Unknown email setting' USING ERRCODE = '22023';
  END CASE;
  UPDATE public.email_settings SET updated_at = now(), updated_by = auth.uid() WHERE id;
  PERFORM public.write_admin_audit('email.setting', 'setting', _key, jsonb_build_object('value', _value));
  RETURN public.owner_email_status() -> 'settings';
END;
$$;

-- Put a failed or expired email back in the queue.
CREATE OR REPLACE FUNCTION public.owner_email_retry(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  UPDATE public.email_outbox
     SET status = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL,
         skip_reason = NULL, created_at = CASE WHEN status = 'expired' THEN now() ELSE created_at END,
         updated_at = now()
   WHERE id = _id AND status IN ('failed', 'expired');
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.write_admin_audit('email.retry', 'email', _id::text, '{}'::jsonb);
  PERFORM public.email_kick();
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_email_unsuppress(_email text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  DELETE FROM public.email_suppressions WHERE email = lower(btrim(_email));
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM public.write_admin_audit('email.unsuppress', 'email_address', lower(btrim(_email)), '{}'::jsonb);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_email_suppressions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN coalesce((SELECT jsonb_agg(s ORDER BY s.created_at DESC) FROM (
    SELECT email, reason, detail, created_at FROM public.email_suppressions ORDER BY created_at DESC LIMIT 200) s), '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- Real events -> email
-- ---------------------------------------------------------------------------
-- Welcome, when a page is created at sign-up.
CREATE OR REPLACE FUNCTION public.email_on_profile_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.email_queue('welcome', 'account', NEW.user_id,
    jsonb_build_object('username', NEW.username, 'display_name', coalesce(nullif(btrim(NEW.display_name), ''), NEW.username)),
    'welcome:' || NEW.user_id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_profile_created: %', SQLERRM;
  RETURN NULL; -- email never blocks a sign-up
END;
$$;
CREATE TRIGGER profiles_email_welcome
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.email_on_profile_created();

-- Password changed / sign-in email changed (to the old address).
CREATE OR REPLACE FUNCTION public.email_on_auth_user_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  _bits jsonb := public.email_profile_bits(NEW.id);
BEGIN
  IF coalesce(o->>'encrypted_password', '') <> ''
     AND (n->>'encrypted_password') IS DISTINCT FROM (o->>'encrypted_password') THEN
    PERFORM public.email_queue('password_changed', 'security', NEW.id,
      _bits || jsonb_build_object('changed_at', now()),
      'password_changed:' || NEW.id || ':' || md5(coalesce(n->>'encrypted_password', '')));
  END IF;
  IF coalesce(o->>'email', '') <> '' AND lower(n->>'email') IS DISTINCT FROM lower(o->>'email') THEN
    PERFORM public.email_queue('email_changed', 'security', NEW.id,
      _bits || jsonb_build_object('new_email_masked', regexp_replace(n->>'email', '^(.).*(@.*)$', '\1***\2'), 'changed_at', now()),
      'email_changed:' || NEW.id || ':' || md5(coalesce(n->>'email', '')),
      o->>'email');
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_auth_user_updated: %', SQLERRM;
  RETURN NULL; -- email never blocks a sign-in change
END;
$$;
CREATE TRIGGER auth_users_email_security
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.email_on_auth_user_updated();

-- Yooits Plus: started, set to cancel, resumed, ended. Stripe sends the
-- payment receipts and failed-payment emails, so those aren't sent here.
CREATE OR REPLACE FUNCTION public.email_on_plus_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  was_on boolean := TG_OP = 'UPDATE' AND public.plus_status_is_active(OLD.status);
  is_on boolean := public.plus_status_is_active(NEW.status);
  _p jsonb;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NULL; END IF;
  _p := public.email_profile_bits(NEW.user_id) || jsonb_build_object(
    'period_end', NEW.current_period_end, 'cancel_at', coalesce(NEW.cancel_at, NEW.current_period_end),
    'amount_cents', NEW.unit_amount_cents, 'currency', NEW.currency, 'livemode', NEW.livemode,
    'trial_end', NEW.trial_end);
  IF is_on AND NOT was_on THEN
    PERFORM public.email_queue('plus_started', 'billing', NEW.user_id, _p, 'plus_started:' || NEW.stripe_subscription_id);
  ELSIF was_on AND NOT is_on THEN
    PERFORM public.email_queue('plus_ended', 'billing', NEW.user_id, _p, 'plus_ended:' || NEW.stripe_subscription_id);
  ELSIF is_on AND TG_OP = 'UPDATE' AND NEW.cancel_at_period_end AND NOT OLD.cancel_at_period_end THEN
    PERFORM public.email_queue('plus_canceling', 'billing', NEW.user_id, _p,
      'plus_canceling:' || NEW.stripe_subscription_id || ':' || coalesce(NEW.cancel_at, NEW.current_period_end, now())::text);
  ELSIF is_on AND TG_OP = 'UPDATE' AND OLD.cancel_at_period_end AND NOT NEW.cancel_at_period_end THEN
    PERFORM public.email_queue('plus_resumed', 'billing', NEW.user_id, _p,
      'plus_resumed:' || NEW.stripe_subscription_id || ':' || floor(extract(epoch FROM now()) / 60)::bigint);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_plus_subscription: %', SQLERRM;
  RETURN NULL;
END;
$$;
CREATE TRIGGER plus_subscriptions_email
  AFTER INSERT OR UPDATE ON public.plus_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.email_on_plus_subscription();

-- Founding Member Plus granted.
CREATE OR REPLACE FUNCTION public.email_on_plan_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.email_queue('founding_member', 'billing', NEW.user_id,
    public.email_profile_bits(NEW.user_id) || jsonb_build_object('ends_at', NEW.ends_at),
    'founding_member:' || NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_plan_entitlement: %', SQLERRM;
  RETURN NULL;
END;
$$;
CREATE TRIGGER plan_entitlements_email
  AFTER INSERT ON public.plan_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.email_on_plan_entitlement();

-- Tips: received, refunded, disputed (creator; disputes also alert the owner).
-- The supporter's receipt comes from Stripe Checkout.
CREATE OR REPLACE FUNCTION public.email_on_tip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _p jsonb;
BEGIN
  _p := public.email_profile_bits(NEW.creator_user_id) || jsonb_build_object(
    'tip_id', NEW.id, 'amount_cents', NEW.tip_amount_cents, 'currency', NEW.currency,
    'supporter_name', NEW.supporter_name, 'supporter_message', NEW.supporter_message,
    'refunded_cents', NEW.amount_refunded_cents, 'dispute_status', NEW.dispute_status,
    'dispute_amount_cents', NEW.dispute_amount_cents, 'livemode', NEW.livemode);
  IF NEW.status = 'succeeded' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'succeeded') THEN
    PERFORM public.email_queue('tip_received', 'billing', NEW.creator_user_id, _p, 'tip_received:' || NEW.id);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.amount_refunded_cents > OLD.amount_refunded_cents THEN
    PERFORM public.email_queue('tip_refunded', 'billing', NEW.creator_user_id, _p,
      'tip_refunded:' || NEW.id || ':' || NEW.amount_refunded_cents);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.dispute_status IS NOT NULL AND OLD.dispute_status IS NULL THEN
    PERFORM public.email_queue('tip_disputed', 'billing', NEW.creator_user_id, _p, 'tip_disputed:' || NEW.id);
    PERFORM public.email_queue_admin('admin_dispute', _p || jsonb_build_object('creator_user_id', NEW.creator_user_id),
      'admin_dispute:' || NEW.id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_tip: %', SQLERRM;
  RETURN NULL;
END;
$$;
CREATE TRIGGER tips_email
  AFTER INSERT OR UPDATE ON public.tips
  FOR EACH ROW EXECUTE FUNCTION public.email_on_tip();

-- Payouts ready / tips paused by Yooits.
CREATE OR REPLACE FUNCTION public.email_on_payment_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _p jsonb := public.email_profile_bits(NEW.user_id);
BEGIN
  IF NEW.payouts_enabled AND NEW.charges_enabled
     AND (TG_OP = 'INSERT' OR NOT (OLD.payouts_enabled AND OLD.charges_enabled)) THEN
    PERFORM public.email_queue('payouts_ready', 'billing', NEW.user_id, _p, 'payouts_ready:' || NEW.stripe_account_id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_payment_account: %', SQLERRM;
  RETURN NULL;
END;
$$;
CREATE TRIGGER creator_payment_accounts_email
  AFTER INSERT OR UPDATE ON public.creator_payment_accounts
  FOR EACH ROW EXECUTE FUNCTION public.email_on_payment_account();

-- Account status set by Yooits: suspended / restored, page unpublished /
-- republished, tips paused / resumed / approved.
CREATE OR REPLACE FUNCTION public.email_on_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  n jsonb := to_jsonb(NEW);
  _p jsonb := public.email_profile_bits(NEW.user_id);
  _min text := floor(extract(epoch FROM now()) / 60)::bigint::text;
BEGIN
  IF (n->>'suspended_at') IS NOT NULL AND (o->>'suspended_at') IS NULL THEN
    PERFORM public.email_queue('account_suspended', 'account', NEW.user_id, _p, 'account_suspended:' || NEW.user_id || ':' || _min);
  ELSIF (n->>'suspended_at') IS NULL AND (o->>'suspended_at') IS NOT NULL THEN
    PERFORM public.email_queue('account_restored', 'account', NEW.user_id, _p, 'account_restored:' || NEW.user_id || ':' || _min);
  END IF;
  IF (n->>'unpublished_at') IS NOT NULL AND (o->>'unpublished_at') IS NULL AND (n->>'suspended_at') IS NULL THEN
    PERFORM public.email_queue('page_unpublished', 'account', NEW.user_id, _p, 'page_unpublished:' || NEW.user_id || ':' || _min);
  ELSIF (n->>'unpublished_at') IS NULL AND (o->>'unpublished_at') IS NOT NULL AND (n->>'suspended_at') IS NULL THEN
    PERFORM public.email_queue('page_restored', 'account', NEW.user_id, _p, 'page_restored:' || NEW.user_id || ':' || _min);
  END IF;
  IF (n->>'tips_disabled_at') IS NOT NULL AND (o->>'tips_disabled_at') IS NULL THEN
    PERFORM public.email_queue('tips_paused', 'billing', NEW.user_id, _p, 'tips_paused:' || NEW.user_id || ':' || _min);
  END IF;
  IF (n->>'tips_approved_at') IS NOT NULL AND (o->>'tips_approved_at') IS NULL THEN
    PERFORM public.email_queue('tips_approved', 'billing', NEW.user_id, _p, 'tips_approved:' || NEW.user_id || ':' || _min);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_account_status: %', SQLERRM;
  RETURN NULL;
END;
$$;
CREATE TRIGGER account_status_email
  AFTER INSERT OR UPDATE ON public.account_status
  FOR EACH ROW EXECUTE FUNCTION public.email_on_account_status();

-- Direct messages: a new request, or a new message. At most one email per
-- conversation per person every 3 hours, none while they're reading it, and
-- the message text is never put in the email.
CREATE OR REPLACE FUNCTION public.email_on_dm_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.dm_conversations;
  _to uuid;
  _read timestamptz;
  _p jsonb;
BEGIN
  IF NEW.body IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.dm_conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND OR c.status = 'declined' THEN RETURN NULL; END IF;
  _to := CASE WHEN NEW.sender_id = c.user_a THEN c.user_b ELSE c.user_a END;
  _read := CASE WHEN _to = c.user_a THEN c.a_last_read_at ELSE c.b_last_read_at END;
  IF _read IS NOT NULL AND _read > now() - interval '5 minutes' THEN RETURN NULL; END IF;
  _p := public.email_profile_bits(_to) || jsonb_build_object(
    'from_username', (SELECT username FROM public.profiles WHERE user_id = NEW.sender_id),
    'from_display_name', (SELECT coalesce(nullif(btrim(display_name), ''), username) FROM public.profiles WHERE user_id = NEW.sender_id),
    'conversation_id', c.id);
  IF c.status = 'request' THEN
    PERFORM public.email_queue('dm_request', 'messages', _to, _p, 'dm_request:' || c.id);
  ELSE
    PERFORM public.email_queue('dm_message', 'messages', _to, _p,
      'dm_message:' || c.id || ':' || _to || ':' || floor(extract(epoch FROM now()) / 10800)::bigint);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_dm_message: %', SQLERRM;
  RETURN NULL; -- email never blocks a message
END;
$$;
CREATE TRIGGER dm_messages_email
  AFTER INSERT ON public.dm_messages
  FOR EACH ROW EXECUTE FUNCTION public.email_on_dm_message();

-- Reports: the owner hears about each new one; a signed-in reporter gets a
-- receipt, and a note when it has been reviewed.
CREATE OR REPLACE FUNCTION public.email_on_abuse_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _p jsonb;
BEGIN
  _p := jsonb_build_object('report_id', NEW.id, 'target_kind', NEW.target_kind, 'reason', NEW.reason,
    'target_username', (SELECT username FROM public.profiles WHERE user_id = NEW.target_user_id));
  IF TG_OP = 'INSERT' THEN
    PERFORM public.email_queue_admin('admin_new_report', _p, 'admin_new_report:' || NEW.id);
    IF NEW.reporter_user_id IS NOT NULL THEN
      PERFORM public.email_queue('report_received', 'account', NEW.reporter_user_id,
        public.email_profile_bits(NEW.reporter_user_id) || _p, 'report_received:' || NEW.id);
    END IF;
  ELSIF NEW.status <> 'open' AND OLD.status = 'open' AND NEW.reporter_user_id IS NOT NULL THEN
    PERFORM public.email_queue('report_reviewed', 'account', NEW.reporter_user_id,
      public.email_profile_bits(NEW.reporter_user_id) || _p || jsonb_build_object('outcome', NEW.status),
      'report_reviewed:' || NEW.id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_abuse_report: %', SQLERRM;
  RETURN NULL;
END;
$$;
CREATE TRIGGER abuse_reports_email
  AFTER INSERT OR UPDATE ON public.abuse_reports
  FOR EACH ROW EXECUTE FUNCTION public.email_on_abuse_report();

-- Founding Member feedback reaches the owner's inbox.
CREATE OR REPLACE FUNCTION public.email_on_beta_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.email_queue_admin('admin_new_feedback',
    public.email_profile_bits(NEW.user_id) || jsonb_build_object('rating', NEW.rating, 'message', left(NEW.message, 600)),
    'admin_new_feedback:' || NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_beta_feedback: %', SQLERRM;
  RETURN NULL;
END;
$$;
CREATE TRIGGER beta_feedback_email
  AFTER INSERT ON public.beta_feedback
  FOR EACH ROW EXECUTE FUNCTION public.email_on_beta_feedback();

-- A wishlist goes public for the first time: its share link.
CREATE OR REPLACE FUNCTION public.email_on_wishlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.visibility = 'public' AND (TG_OP = 'INSERT' OR OLD.visibility <> 'public') THEN
    PERFORM public.email_queue('wishlist_live', 'activity', NEW.user_id,
      public.email_profile_bits(NEW.user_id) || jsonb_build_object('wishlist_title', NEW.title, 'wishlist_slug', NEW.slug),
      'wishlist_live:' || NEW.id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_wishlist: %', SQLERRM;
  RETURN NULL;
END;
$$;
CREATE TRIGGER wishlists_email
  AFTER INSERT OR UPDATE ON public.wishlists
  FOR EACH ROW EXECUTE FUNCTION public.email_on_wishlist();

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.email_category_is_optional(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_category_enabled(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_preferences_for(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_profile_bits(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue(text, text, uuid, jsonb, text, text, boolean, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_queue_admin(text, jsonb, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_claim_batch(integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_mark_result(uuid, boolean, text, text, text, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_record_event(text, text, timestamptz, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_needing_status(integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_kick() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_dispatch_token_ok(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_unsubscribe_token(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_outbox_after_insert() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_profile_created() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_auth_user_updated() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_plus_subscription() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_plan_entitlement() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_tip() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_payment_account() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_account_status() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_dm_message() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_abuse_report() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_beta_feedback() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_on_wishlist() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_queue(text, text, uuid, jsonb, text, text, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_queue_admin(text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_claim_batch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_mark_result(uuid, boolean, text, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_record_event(text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_needing_status(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_kick() TO service_role;
GRANT EXECUTE ON FUNCTION public.email_dispatch_token_ok(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_unsubscribe_token(uuid) TO service_role;

-- Unsubscribe links work without signing in; the 48-character token is the key.
REVOKE ALL ON FUNCTION public.email_preferences_by_token(text) FROM public;
REVOKE ALL ON FUNCTION public.email_unsubscribe(text, text) FROM public;
REVOKE ALL ON FUNCTION public.email_set_preferences_by_token(text, boolean, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.email_preferences_by_token(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.email_unsubscribe(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.email_set_preferences_by_token(text, boolean, boolean, boolean) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.my_email_preferences() FROM public, anon;
REVOKE ALL ON FUNCTION public.set_my_email_preferences(boolean, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_email_preferences() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_email_preferences(boolean, boolean, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.owner_email_status() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_email_log(text, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_email_set_setting(text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_email_retry(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_email_unsuppress(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_email_suppressions() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_email_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_email_log(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_email_set_setting(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_email_retry(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_email_unsuppress(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_email_suppressions() TO authenticated;
