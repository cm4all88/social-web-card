-- Founding Members: launch promotion. The first 50 creators get three months
-- of Plus free. No card, no auto-renewal, no paid conversion.
-- Internal names (beta_*, founding_creator) are kept from the first draft.
--
-- * Reuses public.invites. Beta codes are ordinary invite rows tagged
--   program = 'founding_creator', with a label (who it was sent to), the
--   channel it went out on, an expiry and a soft revoke, so nothing that was
--   tracked is ever lost. Plain invites keep working exactly as before.
-- * plan_entitlements records a time-limited Plus grant. It has an end date,
--   can't auto-renew (CHECK), holds no payment method and starts no billing:
--   when ends_at passes, current_plan() simply reads 'free' again. Nothing here
--   gates any feature or caps links; Plus entitlements aren't final yet.
-- * beta_feedback holds short feedback from signed-in creators.
-- * owner_beta_* functions are what /owner/beta uses. Each checks
--   has_role(admin) inside the database and writes admin_audit_log.
--
-- Seats: 50 = active Plus grants + beta codes still waiting to be used.
-- Revoking an unused code or a grant frees its seat. The cap lives in
-- beta_programs and is changed only by SQL, never from the browser.
--
-- Safe to apply to a database with users: only adds columns (nullable or with
-- defaults), tables, functions and triggers; no rows are changed or deleted.
-- Signup never fails because of the beta: a bad, used, expired or full code
-- just means the new account starts on the free plan.

-- ---------------------------------------------------------------------------
-- 1. Programs
-- ---------------------------------------------------------------------------
CREATE TABLE public.beta_programs (
  key text PRIMARY KEY CHECK (key ~ '^[a-z_]{3,40}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  max_seats integer NOT NULL CHECK (max_seats BETWEEN 1 AND 10000),
  plus_months integer NOT NULL CHECK (plus_months BETWEEN 1 AND 12),
  -- Unused codes expire after this many days unless the owner picks another.
  default_code_days integer NOT NULL DEFAULT 30 CHECK (default_code_days BETWEEN 1 AND 180),
  -- New redemptions stop when this is false; existing grants are untouched.
  open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.beta_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read beta programs"
  ON public.beta_programs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- No write policies: changed by SQL only.

-- Starts closed: codes can be prepared, but none can be redeemed until the
-- owner turns invites on (owner_beta_set_open).
INSERT INTO public.beta_programs (key, name, max_seats, plus_months, open)
VALUES ('founding_creator', 'Founding Members', 50, 3, false)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Beta codes on the existing invites table
-- ---------------------------------------------------------------------------
ALTER TABLE public.invites
  ADD COLUMN program text REFERENCES public.beta_programs (key),
  ADD COLUMN label text CHECK (label IS NULL OR char_length(label) <= 80),
  ADD COLUMN channel text CHECK (channel IS NULL OR channel IN ('email', 'dm', 'in_person', 'other')),
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_by uuid,
  ADD COLUMN revoked_reason text CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 200);

CREATE INDEX idx_invites_program ON public.invites (program, created_at DESC) WHERE program IS NOT NULL;

-- Beta codes are written only by the beta functions below (they set a
-- transaction-local flag). That keeps the seat cap, single use and tracking
-- intact even though admins may still manage plain invites directly.
CREATE OR REPLACE FUNCTION public.invites_guard_beta_rows()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('yooits.beta_write', true), '') <> 'on' THEN
    IF (TG_OP IN ('UPDATE', 'DELETE') AND OLD.program IS NOT NULL)
       OR (TG_OP IN ('INSERT', 'UPDATE') AND NEW.program IS NOT NULL) THEN
      RAISE EXCEPTION 'Founding Member codes are managed from the Founding Members page.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invites_guard_beta
  BEFORE INSERT OR UPDATE OR DELETE ON public.invites
  FOR EACH ROW EXECUTE FUNCTION public.invites_guard_beta_rows();

-- ---------------------------------------------------------------------------
-- 3. Plan entitlements (time-limited, no billing)
-- ---------------------------------------------------------------------------
CREATE TABLE public.plan_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('plus')),
  source text NOT NULL CHECK (source IN ('founding_creator')),
  invite_id uuid REFERENCES public.invites (id) ON DELETE SET NULL,
  -- true when the account was created with the code, false when an existing
  -- account redeemed it later.
  via_signup boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  -- A grant can never renew itself or turn into a paid plan.
  auto_renew boolean NOT NULL DEFAULT false CHECK (auto_renew = false),
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text CHECK (revoked_reason IS NULL OR char_length(revoked_reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (user_id, source)
);

CREATE INDEX idx_plan_entitlements_source ON public.plan_entitlements (source, created_at DESC);

ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own plan entitlements"
  ON public.plan_entitlements FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
-- No write policies: written only by the functions below.

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

-- Server-side only for now (nothing is gated on it yet). The dashboard reads
-- the person's own plan_entitlements row through RLS instead.
REVOKE ALL ON FUNCTION public.current_plan(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_plan(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Redemption
-- ---------------------------------------------------------------------------
-- What a code is worth right now, without saying whose it is.
-- 'ok' | 'used' | 'expired' | 'revoked' | 'full' | 'closed' | 'invalid'
CREATE OR REPLACE FUNCTION public.beta_code_state(_code text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.invites%ROWTYPE;
  prog public.beta_programs%ROWTYPE;
  used integer;
BEGIN
  IF _code IS NULL OR char_length(btrim(_code)) NOT BETWEEN 4 AND 40 THEN
    RETURN 'invalid';
  END IF;
  SELECT * INTO inv FROM public.invites WHERE code = lower(btrim(_code)) AND program IS NOT NULL;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF inv.used_by IS NOT NULL THEN RETURN 'used'; END IF;
  IF inv.revoked_at IS NOT NULL THEN RETURN 'revoked'; END IF;
  IF inv.expires_at IS NOT NULL AND inv.expires_at <= now() THEN RETURN 'expired'; END IF;
  SELECT * INTO prog FROM public.beta_programs WHERE key = inv.program;
  IF NOT prog.open THEN RETURN 'closed'; END IF;
  SELECT count(*) INTO used FROM public.plan_entitlements
   WHERE source = inv.program AND revoked_at IS NULL;
  IF used >= prog.max_seats THEN RETURN 'full'; END IF;
  RETURN 'ok';
END;
$$;

GRANT EXECUTE ON FUNCTION public.beta_code_state(text) TO anon, authenticated;

-- Internal: give _user_id the code's Plus grant. Returns a state as above, or
-- 'already' when the account already has a founding grant.
CREATE OR REPLACE FUNCTION public.beta_redeem_for(_user_id uuid, _code text, _via_signup boolean)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.invites%ROWTYPE;
  prog public.beta_programs%ROWTYPE;
  used integer;
  state text;
BEGIN
  state := public.beta_code_state(_code);
  IF state <> 'ok' THEN RETURN state; END IF;

  SELECT * INTO inv FROM public.invites WHERE code = lower(btrim(_code)) AND program IS NOT NULL;
  -- One redemption at a time per program, so two people can't take seat 50.
  SELECT * INTO prog FROM public.beta_programs WHERE key = inv.program FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.plan_entitlements WHERE user_id = _user_id AND source = inv.program) THEN
    RETURN 'already';
  END IF;
  IF public.account_is_suspended(_user_id) THEN
    RETURN 'invalid';
  END IF;
  SELECT count(*) INTO used FROM public.plan_entitlements
   WHERE source = inv.program AND revoked_at IS NULL;
  IF used >= prog.max_seats THEN RETURN 'full'; END IF;

  PERFORM set_config('yooits.beta_write', 'on', true);
  UPDATE public.invites SET used_by = _user_id, used_at = now()
   WHERE id = inv.id AND used_by IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN
    PERFORM set_config('yooits.beta_write', '', true);
    RETURN 'used';
  END IF;
  PERFORM set_config('yooits.beta_write', '', true);

  INSERT INTO public.plan_entitlements (user_id, plan, source, invite_id, via_signup, ends_at)
  VALUES (_user_id, 'plus', inv.program, inv.id, _via_signup, now() + make_interval(months => prog.plus_months));

  PERFORM public.write_admin_audit('beta.redeemed', 'user', _user_id::text,
    jsonb_build_object('invite_id', inv.id, 'via_signup', _via_signup, 'program', inv.program));
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.beta_redeem_for(uuid, text, boolean) FROM public, anon, authenticated;

-- For an account that already exists: redeem a code while signed in.
CREATE OR REPLACE FUNCTION public.redeem_beta_invite(_code text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  RETURN public.beta_redeem_for(auth.uid(), _code, false);
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_beta_invite(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.redeem_beta_invite(text) TO authenticated;

-- Signup: same as before, plus the beta path. A beta problem never blocks
-- the signup itself.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invite_code text;
  v_username text;
  v_display text;
  v_is_beta boolean;
BEGIN
  v_invite_code := NULLIF(btrim(new.raw_user_meta_data->>'invite_code'), '');
  v_username := lower(NULLIF(btrim(new.raw_user_meta_data->>'username'), ''));
  v_display := left(NULLIF(btrim(new.raw_user_meta_data->>'display_name'), ''), 50);

  IF v_username IS NULL OR v_username !~ '^[a-z0-9_-]{2,30}$' THEN
    RAISE EXCEPTION 'A valid username (2-30 chars, a-z 0-9 _ -) is required';
  END IF;

  IF public.username_is_reserved(v_username) THEN
    RAISE EXCEPTION 'That username is reserved';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  INSERT INTO public.profiles (user_id, username, display_name)
  VALUES (new.id, v_username, COALESCE(v_display, v_username));

  -- Invites are optional; consume a valid one if given.
  IF v_invite_code IS NOT NULL THEN
    v_is_beta := EXISTS (SELECT 1 FROM public.invites
                          WHERE code = lower(v_invite_code) AND program IS NOT NULL);
    IF v_is_beta THEN
      BEGIN
        PERFORM public.beta_redeem_for(new.id, v_invite_code, true);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'founding member redemption skipped: %', SQLERRM;
      END;
    ELSE
      UPDATE public.invites
        SET used_by = new.id, used_at = now()
        WHERE code = v_invite_code AND used_by IS NULL AND program IS NULL;
    END IF;
  END IF;

  -- Every new account is an ordinary user. Admin is never granted here.
  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'user')
  ON CONFLICT DO NOTHING;

  RETURN new;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Feedback
-- ---------------------------------------------------------------------------
CREATE TABLE public.beta_feedback (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  rating smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  message text NOT NULL CHECK (char_length(btrim(message)) BETWEEN 2 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_beta_feedback_created ON public.beta_feedback (created_at DESC, id DESC);
CREATE INDEX idx_beta_feedback_user ON public.beta_feedback (user_id, created_at DESC);

ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in creators send their own feedback"
  ON public.beta_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND NOT public.account_is_suspended(auth.uid()));

CREATE POLICY "Creators see their own feedback; admins see all"
  ON public.beta_feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
-- No UPDATE/DELETE policies.

-- At most 10 notes per person per day, and the time is always the server's.
CREATE OR REPLACE FUNCTION public.beta_feedback_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.created_at := now();
  NEW.message := btrim(NEW.message);
  IF (SELECT count(*) FROM public.beta_feedback
       WHERE user_id = NEW.user_id AND created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'Thanks! That''s plenty of feedback for today. Try again tomorrow.'
      USING ERRCODE = '54000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER beta_feedback_limit
  BEFORE INSERT ON public.beta_feedback
  FOR EACH ROW EXECUTE FUNCTION public.beta_feedback_before_insert();

-- ---------------------------------------------------------------------------
-- 6. Owner console
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.beta_invite_status(i public.invites)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN i.used_by IS NOT NULL THEN 'redeemed'
    WHEN i.revoked_at IS NOT NULL THEN 'revoked'
    WHEN i.expires_at IS NOT NULL AND i.expires_at <= now() THEN 'expired'
    ELSE 'open'
  END
$$;

-- Numbers for the top of /owner/beta.
CREATE OR REPLACE FUNCTION public.owner_beta_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prog public.beta_programs%ROWTYPE;
  result jsonb;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT * INTO prog FROM public.beta_programs WHERE key = 'founding_creator';
  SELECT jsonb_build_object(
    'name', prog.name,
    'open', prog.open,
    'max_seats', prog.max_seats,
    'plus_months', prog.plus_months,
    'default_code_days', prog.default_code_days,
    'codes_created', (SELECT count(*) FROM public.invites WHERE program = prog.key),
    'codes_open', (SELECT count(*) FROM public.invites i WHERE i.program = prog.key AND public.beta_invite_status(i) = 'open'),
    'codes_redeemed', (SELECT count(*) FROM public.invites WHERE program = prog.key AND used_by IS NOT NULL),
    'codes_expired', (SELECT count(*) FROM public.invites i WHERE i.program = prog.key AND public.beta_invite_status(i) = 'expired'),
    'codes_revoked', (SELECT count(*) FROM public.invites i WHERE i.program = prog.key AND public.beta_invite_status(i) = 'revoked'),
    'signups', (SELECT count(*) FROM public.plan_entitlements WHERE source = prog.key AND via_signup),
    'existing_redeemed', (SELECT count(*) FROM public.plan_entitlements WHERE source = prog.key AND NOT via_signup),
    'plus_now', (SELECT count(*) FROM public.plan_entitlements e WHERE e.source = prog.key
                   AND e.revoked_at IS NULL AND now() < e.ends_at),
    'active_14d', (SELECT count(*) FROM public.plan_entitlements e
                     JOIN auth.users u ON u.id = e.user_id
                    WHERE e.source = prog.key AND e.revoked_at IS NULL AND now() < e.ends_at
                      AND u.last_sign_in_at >= now() - interval '14 days'),
    'grants_revoked', (SELECT count(*) FROM public.plan_entitlements WHERE source = prog.key AND revoked_at IS NOT NULL),
    'seats_left', greatest(prog.max_seats
                    - (SELECT count(*) FROM public.plan_entitlements WHERE source = prog.key AND revoked_at IS NULL)
                    - (SELECT count(*) FROM public.invites i WHERE i.program = prog.key AND public.beta_invite_status(i) = 'open'), 0),
    'feedback', (SELECT count(*) FROM public.beta_feedback f
                  WHERE EXISTS (SELECT 1 FROM public.plan_entitlements e WHERE e.user_id = f.user_id AND e.source = prog.key))
  ) INTO result;
  RETURN result;
END;
$$;

-- Create 1-10 codes. The seat cap counts active grants plus open codes.
CREATE OR REPLACE FUNCTION public.owner_beta_create_invites(
  _count integer,
  _label text DEFAULT NULL,
  _channel text DEFAULT NULL,
  _days integer DEFAULT NULL
)
RETURNS TABLE (id uuid, code text, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prog public.beta_programs%ROWTYPE;
  taken integer;
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  idx constant integer[] := ARRAY[0, 1, 2, 3, 4, 5, 9, 10, 11, 12];
  b bytea;
  c text;
  k integer;
  n integer;
  lbl text := NULLIF(left(btrim(regexp_replace(coalesce(_label, ''), '[[:cntrl:]]+', ' ', 'g')), 80), '');
  ch text := NULLIF(btrim(coalesce(_channel, '')), '');
  exp timestamptz;
BEGIN
  PERFORM public.owner_require_admin();
  IF _count IS NULL OR _count NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'Create between 1 and 10 codes at a time.' USING ERRCODE = '22023';
  END IF;
  IF ch IS NOT NULL AND ch NOT IN ('email', 'dm', 'in_person', 'other') THEN
    RAISE EXCEPTION 'Channel must be email, dm, in_person or other.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO prog FROM public.beta_programs WHERE key = 'founding_creator' FOR UPDATE;
  -- Codes can be created while invites are off, so they can be prepared ahead;
  -- they just can't be redeemed until the program is open.
  IF _days IS NOT NULL AND _days NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'Codes can last 1 to 180 days.' USING ERRCODE = '22023';
  END IF;
  exp := now() + make_interval(days => coalesce(_days, prog.default_code_days));

  SELECT (SELECT count(*) FROM public.plan_entitlements e WHERE e.source = prog.key AND e.revoked_at IS NULL)
       + (SELECT count(*) FROM public.invites i WHERE i.program = prog.key AND public.beta_invite_status(i) = 'open')
    INTO taken;
  IF taken + _count > prog.max_seats THEN
    RAISE EXCEPTION 'Only % of % seats are left. Revoke unused codes to free seats.',
      greatest(prog.max_seats - taken, 0), prog.max_seats USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('yooits.beta_write', 'on', true);
  FOR n IN 1.._count LOOP
    LOOP
      b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
      c := 'fc-';
      FOREACH k IN ARRAY idx LOOP
        c := c || substr(alphabet, (get_byte(b, k) % 31) + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.invites WHERE invites.code = c);
    END LOOP;
    INSERT INTO public.invites AS i (code, created_by, program, label, channel, expires_at)
    VALUES (c, auth.uid(), prog.key, lbl, ch, exp)
    RETURNING i.id, i.code, i.expires_at INTO id, code, expires_at;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('yooits.beta_write', '', true);

  PERFORM public.write_admin_audit('beta.codes_created', 'beta_program', prog.key,
    jsonb_build_object('count', _count, 'label', lbl, 'channel', ch, 'expires_at', exp));
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_beta_list_invites(_limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE (
  id uuid, code text, label text, channel text, status text,
  created_at timestamptz, expires_at timestamptz, revoked_at timestamptz, revoked_reason text,
  used_at timestamptz, used_by uuid, used_by_username text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN QUERY
  SELECT i.id, i.code, i.label, i.channel, public.beta_invite_status(i),
         i.created_at, i.expires_at, i.revoked_at, i.revoked_reason,
         i.used_at, i.used_by, p.username
    FROM public.invites i
    LEFT JOIN public.profiles p ON p.user_id = i.used_by
   WHERE i.program = 'founding_creator'
   ORDER BY i.created_at DESC, i.id
   LIMIT least(greatest(coalesce(_limit, 100), 1), 200)
  OFFSET greatest(coalesce(_offset, 0), 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_beta_revoke_invite(_invite_id uuid, _reason text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  PERFORM public.owner_require_admin();
  r := public.owner_clean_reason(_reason);
  PERFORM set_config('yooits.beta_write', 'on', true);
  UPDATE public.invites
     SET revoked_at = now(), revoked_by = auth.uid(), revoked_reason = r
   WHERE id = _invite_id AND program = 'founding_creator'
     AND used_by IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN
    PERFORM set_config('yooits.beta_write', '', true);
    RAISE EXCEPTION 'Only an unused, active code can be revoked.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('yooits.beta_write', '', true);
  PERFORM public.write_admin_audit('beta.code_revoked', 'invite', _invite_id::text,
    jsonb_build_object('reason', r));
  RETURN true;
END;
$$;

-- Everyone in the beta, with enough to see who's actually using Yooits.
CREATE OR REPLACE FUNCTION public.owner_beta_list_members(_limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE (
  user_id uuid, username text, display_name text, email text,
  via_signup boolean, joined_at timestamptz, redeemed_at timestamptz, ends_at timestamptz,
  status text, revoked_reason text, last_sign_in_at timestamptz,
  link_count integer, feedback_count integer, invite_label text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN QUERY
  SELECT e.user_id, p.username, p.display_name, u.email::text,
         e.via_signup, u.created_at, e.created_at, e.ends_at,
         CASE WHEN e.revoked_at IS NOT NULL THEN 'revoked'
              WHEN now() >= e.ends_at THEN 'ended'
              WHEN u.last_sign_in_at >= now() - interval '14 days' THEN 'active'
              ELSE 'quiet' END,
         e.revoked_reason, u.last_sign_in_at,
         (SELECT count(*)::int FROM public.social_links l WHERE l.user_id = e.user_id AND l.enabled AND l.url <> ''),
         (SELECT count(*)::int FROM public.beta_feedback f WHERE f.user_id = e.user_id),
         i.label
    FROM public.plan_entitlements e
    JOIN auth.users u ON u.id = e.user_id
    LEFT JOIN public.profiles p ON p.user_id = e.user_id
    LEFT JOIN public.invites i ON i.id = e.invite_id
   WHERE e.source = 'founding_creator'
   ORDER BY e.created_at DESC
   LIMIT least(greatest(coalesce(_limit, 100), 1), 200)
  OFFSET greatest(coalesce(_offset, 0), 0);
END;
$$;

-- End a grant early (e.g. not a legitimate creator). Frees the seat. The
-- account itself is untouched and simply reads as Free.
CREATE OR REPLACE FUNCTION public.owner_beta_revoke_grant(_user_id uuid, _reason text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  PERFORM public.owner_require_admin();
  r := public.owner_clean_reason(_reason);
  UPDATE public.plan_entitlements
     SET revoked_at = now(), revoked_by = auth.uid(), revoked_reason = r
   WHERE user_id = _user_id AND source = 'founding_creator' AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That account has no active founding grant.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.write_admin_audit('beta.grant_revoked', 'user', _user_id::text,
    jsonb_build_object('reason', r));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_beta_list_feedback(_limit integer DEFAULT 50, _before_id bigint DEFAULT NULL)
RETURNS TABLE (id bigint, created_at timestamptz, user_id uuid, username text, in_beta boolean, rating smallint, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN QUERY
  SELECT f.id, f.created_at, f.user_id, p.username,
         EXISTS (SELECT 1 FROM public.plan_entitlements e WHERE e.user_id = f.user_id AND e.source = 'founding_creator'),
         f.rating, f.message
    FROM public.beta_feedback f
    LEFT JOIN public.profiles p ON p.user_id = f.user_id
   WHERE _before_id IS NULL OR f.id < _before_id
   ORDER BY f.id DESC
   LIMIT least(greatest(coalesce(_limit, 50), 1), 200);
END;
$$;

-- Turn redemption on or off. Codes keep their seats either way.
CREATE OR REPLACE FUNCTION public.owner_beta_set_open(_open boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  was boolean;
BEGIN
  PERFORM public.owner_require_admin();
  IF _open IS NULL THEN
    RAISE EXCEPTION 'Say whether invites should be on or off.' USING ERRCODE = '22023';
  END IF;
  SELECT open INTO was FROM public.beta_programs WHERE key = 'founding_creator' FOR UPDATE;
  IF was IS DISTINCT FROM _open THEN
    UPDATE public.beta_programs SET open = _open WHERE key = 'founding_creator';
    PERFORM public.write_admin_audit(
      CASE WHEN _open THEN 'beta.program_opened' ELSE 'beta.program_closed' END,
      'beta_program', 'founding_creator', '{}'::jsonb);
  END IF;
  RETURN _open;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_beta_set_open(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_beta_set_open(boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.owner_beta_overview() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_beta_create_invites(integer, text, text, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_beta_list_invites(integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_beta_revoke_invite(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_beta_list_members(integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_beta_revoke_grant(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_beta_list_feedback(integer, bigint) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_beta_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_beta_create_invites(integer, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_beta_list_invites(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_beta_revoke_invite(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_beta_list_members(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_beta_revoke_grant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_beta_list_feedback(integer, bigint) TO authenticated;
