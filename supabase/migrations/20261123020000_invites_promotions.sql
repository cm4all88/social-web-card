-- Owner Console: working invite codes and Promotions, built on the existing
-- invites and plan_entitlements tables (no parallel code or grant system).
--
--  * invites gain max_uses / use_count / promotion_id, so a code can be single
--    use (the default, as before) or shared ("LAUNCH" for 200 people).
--  * invite_redemptions records every use of a non-founding code.
--  * promotions group codes into a campaign with a window, a redemption cap,
--    an eligibility rule and an optional free-Plus grant. The grant reuses
--    plan_entitlements (no card, never renews), the same path Founding Members
--    use; nothing here touches Stripe.
--  * Founding Member codes (invites.program IS NOT NULL) and their grants are
--    left exactly as they are: beta_code_state / beta_redeem_for still own them.
--
-- Additive only. Rollback: supabase/rollbacks/20261123020000_invites_promotions.down.sql

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  plus_months integer NOT NULL DEFAULT 0 CHECK (plus_months BETWEEN 0 AND 12),
  eligibility text NOT NULL DEFAULT 'anyone'
    CHECK (eligibility IN ('anyone', 'new_accounts', 'existing_accounts')),
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions BETWEEN 1 AND 100000),
  campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotions FROM anon, authenticated;

ALTER TABLE public.invites
  ADD COLUMN promotion_id uuid REFERENCES public.promotions(id) ON DELETE RESTRICT,
  ADD COLUMN max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 100000),
  ADD COLUMN use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0);
CREATE INDEX idx_invites_promotion ON public.invites (promotion_id) WHERE promotion_id IS NOT NULL;

ALTER TABLE public.invites DROP CONSTRAINT invites_channel_check;
ALTER TABLE public.invites ADD CONSTRAINT invites_channel_check
  CHECK (channel IS NULL OR channel IN ('email', 'dm', 'in_person', 'social', 'other'));

-- A plain code someone already used counts as one use.
UPDATE public.invites SET use_count = 1 WHERE program IS NULL AND used_by IS NOT NULL AND use_count = 0;

CREATE TABLE public.invite_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id uuid NOT NULL REFERENCES public.invites(id) ON DELETE RESTRICT,
  promotion_id uuid REFERENCES public.promotions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  via_signup boolean NOT NULL,
  entitlement_id uuid REFERENCES public.plan_entitlements(id) ON DELETE SET NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invite_id, user_id)
);
CREATE INDEX idx_invite_redemptions_promotion ON public.invite_redemptions (promotion_id, redeemed_at DESC);
CREATE INDEX idx_invite_redemptions_user ON public.invite_redemptions (user_id);
ALTER TABLE public.invite_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invite_redemptions FROM anon, authenticated;

-- Free Plus from a promotion lives next to the founding grant.
ALTER TABLE public.plan_entitlements
  ADD COLUMN promotion_id uuid REFERENCES public.promotions(id) ON DELETE RESTRICT;
ALTER TABLE public.plan_entitlements DROP CONSTRAINT plan_entitlements_source_check;
ALTER TABLE public.plan_entitlements ADD CONSTRAINT plan_entitlements_source_check
  CHECK (source = 'founding_creator'
         OR (source = 'promo:' || promotion_id::text AND promotion_id IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Emails and notices on a grant: the founding welcome only for founders.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_on_plan_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'founding_creator' THEN
    PERFORM public.email_queue('founding_member', 'billing', NEW.user_id,
      public.email_profile_bits(NEW.user_id) || jsonb_build_object('ends_at', NEW.ends_at),
      'founding_member:' || NEW.id);
  ELSIF NEW.promotion_id IS NOT NULL AND NEW.revoked_at IS NULL THEN
    PERFORM public.notify_user(NEW.user_id, 'promotion_plus', 'You have Yooits Plus',
      'Plus is free until ' || to_char(NEW.ends_at AT TIME ZONE 'UTC', 'FMMonth FMDD, YYYY')
        || '. No card needed, and it won''t renew by itself.',
      '/dashboard', 'promo:' || NEW.id::text);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_on_plan_entitlement: %', SQLERRM;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Code state and redemption for non-founding codes
-- ---------------------------------------------------------------------------
-- States: ok, invalid, used (no uses left), expired, revoked, paused,
-- not_started, ended, full (promotion cap reached), new_only, existing_only,
-- already, paid_plus (already pays for Plus, so free months would be wasted).
CREATE OR REPLACE FUNCTION public.promo_state_for(inv public.invites, _user_id uuid, _via_signup boolean)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pr public.promotions%ROWTYPE;
  n integer;
BEGIN
  IF inv.id IS NULL OR inv.program IS NOT NULL THEN RETURN 'invalid'; END IF;
  IF inv.revoked_at IS NOT NULL THEN RETURN 'revoked'; END IF;
  IF inv.expires_at IS NOT NULL AND inv.expires_at <= now() THEN RETURN 'expired'; END IF;
  IF _user_id IS NOT NULL AND (
       inv.used_by = _user_id
       OR EXISTS (SELECT 1 FROM public.invite_redemptions r WHERE r.invite_id = inv.id AND r.user_id = _user_id)
     ) THEN
    RETURN 'already';
  END IF;
  IF inv.use_count >= inv.max_uses THEN RETURN 'used'; END IF;
  IF inv.promotion_id IS NOT NULL THEN
    SELECT * INTO pr FROM public.promotions WHERE id = inv.promotion_id;
    IF pr.status IN ('draft', 'paused') THEN RETURN 'paused'; END IF;
    IF pr.status = 'ended' OR (pr.ends_at IS NOT NULL AND pr.ends_at <= now()) THEN RETURN 'ended'; END IF;
    IF pr.starts_at IS NOT NULL AND pr.starts_at > now() THEN RETURN 'not_started'; END IF;
    IF pr.max_redemptions IS NOT NULL THEN
      SELECT count(*) INTO n FROM public.invite_redemptions WHERE promotion_id = pr.id;
      IF n >= pr.max_redemptions THEN RETURN 'full'; END IF;
    END IF;
    IF _user_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.invite_redemptions r
                  WHERE r.promotion_id = pr.id AND r.user_id = _user_id) THEN
        RETURN 'already';
      END IF;
      IF pr.eligibility = 'new_accounts' AND NOT _via_signup THEN RETURN 'new_only'; END IF;
      IF pr.eligibility = 'existing_accounts' AND _via_signup THEN RETURN 'existing_only'; END IF;
      IF pr.plus_months > 0 AND EXISTS (
           SELECT 1 FROM public.plus_subscriptions s
            WHERE s.user_id = _user_id AND public.plus_status_is_active(s.status)) THEN
        RETURN 'paid_plus';
      END IF;
    END IF;
  END IF;
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.promo_state_for(public.invites, uuid, boolean) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.code_redeem_for(_user_id uuid, _code text, _via_signup boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c text := lower(btrim(coalesce(_code, '')));
  inv public.invites%ROWTYPE;
  pr public.promotions%ROWTYPE;
  state text;
  ent uuid;
  start_at timestamptz;
BEGIN
  IF char_length(c) NOT BETWEEN 4 AND 40 THEN RETURN 'invalid'; END IF;
  -- The row lock makes uses of one code take turns, so max_uses holds.
  SELECT * INTO inv FROM public.invites WHERE code = c AND program IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF inv.promotion_id IS NOT NULL THEN
    -- And uses across a promotion's codes take turns, so max_redemptions holds.
    SELECT * INTO pr FROM public.promotions WHERE id = inv.promotion_id FOR UPDATE;
  END IF;
  state := public.promo_state_for(inv, _user_id, _via_signup);
  IF state <> 'ok' THEN RETURN state; END IF;
  IF public.account_is_suspended(_user_id) THEN RETURN 'invalid'; END IF;

  IF inv.promotion_id IS NOT NULL AND pr.plus_months > 0 THEN
    -- Free months start after any free Plus already running, never overlapping it.
    SELECT greatest(now(), coalesce(max(e.ends_at), now())) INTO start_at
      FROM public.plan_entitlements e
     WHERE e.user_id = _user_id AND e.revoked_at IS NULL AND e.ends_at > now();
    INSERT INTO public.plan_entitlements
      (user_id, plan, source, promotion_id, invite_id, via_signup, starts_at, ends_at)
    VALUES (_user_id, 'plus', 'promo:' || pr.id::text, pr.id, inv.id, _via_signup,
            start_at, start_at + make_interval(months => pr.plus_months))
    RETURNING id INTO ent;
  END IF;

  UPDATE public.invites
     SET use_count = use_count + 1,
         used_by = coalesce(used_by, _user_id),
         used_at = coalesce(used_at, now())
   WHERE id = inv.id;
  INSERT INTO public.invite_redemptions (invite_id, promotion_id, user_id, via_signup, entitlement_id)
  VALUES (inv.id, inv.promotion_id, _user_id, _via_signup, ent);

  PERFORM public.write_admin_audit('invite.redeemed', 'user', _user_id::text,
    jsonb_build_object('invite_id', inv.id, 'promotion_id', inv.promotion_id,
                       'via_signup', _via_signup, 'plus_grant', ent IS NOT NULL));
  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.code_redeem_for(uuid, text, boolean) FROM public, anon, authenticated;

-- What a code is worth, for the sign-up page (any code: founding or not).
CREATE OR REPLACE FUNCTION public.code_state(_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c text := lower(btrim(coalesce(_code, '')));
  inv public.invites%ROWTYPE;
  months integer := 0;
BEGIN
  IF char_length(c) NOT BETWEEN 4 AND 40 THEN
    RETURN jsonb_build_object('kind', 'unknown', 'state', 'invalid');
  END IF;
  SELECT * INTO inv FROM public.invites WHERE code = c;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'unknown', 'state', 'invalid'); END IF;
  IF inv.program IS NOT NULL THEN
    RETURN jsonb_build_object('kind', 'founding', 'state', public.beta_code_state(c));
  END IF;
  IF inv.promotion_id IS NOT NULL THEN
    SELECT plus_months INTO months FROM public.promotions WHERE id = inv.promotion_id;
  END IF;
  RETURN jsonb_build_object(
    'kind', CASE WHEN inv.promotion_id IS NULL THEN 'invite' ELSE 'promotion' END,
    'state', public.promo_state_for(inv, auth.uid(), auth.uid() IS NULL),
    'plus_months', coalesce(months, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.code_state(text) FROM public;
GRANT EXECUTE ON FUNCTION public.code_state(text) TO anon, authenticated;

-- A signed-in person uses any code (a founding one goes to its own path).
CREATE OR REPLACE FUNCTION public.redeem_code(_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c text := lower(btrim(coalesce(_code, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invites WHERE code = c AND program IS NOT NULL) THEN
    RETURN public.beta_redeem_for(auth.uid(), c, false);
  END IF;
  RETURN public.code_redeem_for(auth.uid(), c, false);
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_code(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.redeem_code(text) TO authenticated;

-- Old helper, now with the same rules as everything else.
CREATE OR REPLACE FUNCTION public.invite_is_valid(_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (public.code_state(_code)->>'state') = 'ok';
$$;

-- Sign-up: identical to before except a non-founding code goes through
-- code_redeem_for (limits, expiry, promotions), and a failure there never
-- blocks the account from being created.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      BEGIN
        PERFORM public.code_redeem_for(new.id, v_invite_code, true);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'invite redemption skipped: %', SQLERRM;
      END;
    END IF;
  END IF;

  -- Every new account is an ordinary user. Admin is never granted here.
  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'user')
  ON CONFLICT DO NOTHING;

  RETURN new;
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner: invite codes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_status(i public.invites)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN i.program IS NOT NULL THEN public.beta_invite_status(i)
    WHEN i.revoked_at IS NOT NULL THEN 'revoked'
    WHEN i.expires_at IS NOT NULL AND i.expires_at <= now() THEN 'expired'
    WHEN i.use_count >= i.max_uses THEN 'used_up'
    ELSE 'open'
  END
$$;

CREATE OR REPLACE FUNCTION public.owner_invite_list(
  _promotion_id uuid DEFAULT NULL, _limit integer DEFAULT 200, _offset integer DEFAULT 0)
RETURNS TABLE (
  id uuid, code text, label text, channel text, status text,
  promotion_id uuid, promotion_name text, max_uses integer, use_count integer,
  created_at timestamptz, expires_at timestamptz, revoked_at timestamptz, revoked_reason text,
  last_used_at timestamptz, last_used_by_username text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN QUERY
  SELECT i.id, i.code, i.label, i.channel, public.invite_status(i),
         i.promotion_id, pr.name, i.max_uses, i.use_count,
         i.created_at, i.expires_at, i.revoked_at, i.revoked_reason,
         coalesce(lr.redeemed_at, i.used_at), coalesce(lp.username, up.username)
    FROM public.invites i
    LEFT JOIN public.promotions pr ON pr.id = i.promotion_id
    LEFT JOIN LATERAL (
      SELECT r.redeemed_at, r.user_id FROM public.invite_redemptions r
       WHERE r.invite_id = i.id ORDER BY r.redeemed_at DESC LIMIT 1) lr ON true
    LEFT JOIN public.profiles lp ON lp.user_id = lr.user_id
    LEFT JOIN public.profiles up ON up.user_id = i.used_by
   WHERE i.program IS NULL
     AND (_promotion_id IS NULL OR i.promotion_id = _promotion_id)
   ORDER BY i.created_at DESC, i.id
   LIMIT least(greatest(coalesce(_limit, 200), 1), 500)
  OFFSET greatest(coalesce(_offset, 0), 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_invite_create(
  _count integer DEFAULT 1,
  _label text DEFAULT NULL,
  _channel text DEFAULT NULL,
  _days integer DEFAULT NULL,
  _max_uses integer DEFAULT 1,
  _promotion_id uuid DEFAULT NULL,
  _code text DEFAULT NULL)
RETURNS TABLE (id uuid, code text, expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  b bytea;
  c text;
  k integer;
  n integer;
  custom text := NULLIF(lower(btrim(coalesce(_code, ''))), '');
  lbl text := NULLIF(left(btrim(regexp_replace(coalesce(_label, ''), '[[:cntrl:]]+', ' ', 'g')), 80), '');
  ch text := NULLIF(btrim(coalesce(_channel, '')), '');
  exp timestamptz;
BEGIN
  PERFORM public.owner_require_admin();
  IF _count IS NULL OR _count NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Create between 1 and 50 codes at a time.' USING ERRCODE = '22023';
  END IF;
  IF _max_uses IS NULL OR _max_uses NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'Uses per code must be between 1 and 100,000.' USING ERRCODE = '22023';
  END IF;
  IF ch IS NOT NULL AND ch NOT IN ('email', 'dm', 'in_person', 'social', 'other') THEN
    RAISE EXCEPTION 'Channel must be email, dm, in_person, social or other.' USING ERRCODE = '22023';
  END IF;
  IF _days IS NOT NULL AND _days NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'Codes can last 1 to 365 days.' USING ERRCODE = '22023';
  END IF;
  IF _promotion_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.promotions WHERE promotions.id = _promotion_id) THEN
    RAISE EXCEPTION 'No promotion with that id.' USING ERRCODE = 'P0002';
  END IF;
  IF custom IS NOT NULL THEN
    IF _count <> 1 THEN
      RAISE EXCEPTION 'A code you type yourself is made one at a time.' USING ERRCODE = '22023';
    END IF;
    IF custom !~ '^[a-z0-9][a-z0-9-]{3,39}$' OR custom LIKE 'fc-%' THEN
      RAISE EXCEPTION 'Codes are 4 to 40 letters, numbers or dashes, and can''t start with fc-.'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.invites WHERE invites.code = custom) THEN
      RAISE EXCEPTION 'That code is already taken.' USING ERRCODE = '23505';
    END IF;
  END IF;
  exp := CASE WHEN _days IS NULL THEN NULL ELSE now() + make_interval(days => _days) END;

  FOR n IN 1.._count LOOP
    IF custom IS NOT NULL THEN
      c := custom;
    ELSE
      LOOP
        b := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
        c := '';
        FOR k IN 0..7 LOOP
          c := c || substr(alphabet, (get_byte(b, k) % 31) + 1, 1);
        END LOOP;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.invites WHERE invites.code = c);
      END LOOP;
    END IF;
    INSERT INTO public.invites AS i (code, created_by, label, channel, expires_at, max_uses, promotion_id)
    VALUES (c, auth.uid(), lbl, ch, exp, _max_uses, _promotion_id)
    RETURNING i.id, i.code, i.expires_at INTO id, code, expires_at;
    RETURN NEXT;
  END LOOP;

  PERFORM public.write_admin_audit('invite.codes_created', 'promotion', _promotion_id::text,
    jsonb_build_object('count', _count, 'label', lbl, 'channel', ch, 'expires_at', exp,
                       'max_uses', _max_uses, 'custom', custom IS NOT NULL));
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_invite_revoke(_invite_id uuid, _reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  PERFORM public.owner_require_admin();
  r := public.owner_clean_reason(_reason);
  UPDATE public.invites
     SET revoked_at = now(), revoked_by = auth.uid(), revoked_reason = r
   WHERE id = _invite_id AND program IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only an active code can be revoked (Founding Member codes are revoked on their own page).'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public.write_admin_audit('invite.code_revoked', 'invite', _invite_id::text,
    jsonb_build_object('reason', r));
  RETURN true;
END;
$$;

-- A private note on who a code is for. Works for Founding Member codes too:
-- only the label changes, never the code, its expiry or its Plus months.
CREATE OR REPLACE FUNCTION public.owner_invite_set_label(_invite_id uuid, _label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lbl text := NULLIF(left(btrim(regexp_replace(coalesce(_label, ''), '[[:cntrl:]]+', ' ', 'g')), 80), '');
BEGIN
  PERFORM public.owner_require_admin();
  PERFORM set_config('yooits.beta_write', 'on', true);
  UPDATE public.invites SET label = lbl WHERE id = _invite_id;
  IF NOT FOUND THEN
    PERFORM set_config('yooits.beta_write', '', true);
    RAISE EXCEPTION 'No code with that id.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('yooits.beta_write', '', true);
  PERFORM public.write_admin_audit('invite.label_changed', 'invite', _invite_id::text,
    jsonb_build_object('label', lbl));
  RETURN lbl;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_invite_redemptions(
  _invite_id uuid DEFAULT NULL, _promotion_id uuid DEFAULT NULL, _limit integer DEFAULT 200)
RETURNS TABLE (
  redeemed_at timestamptz, user_id uuid, username text, code text, invite_id uuid,
  promotion_id uuid, promotion_name text, via_signup boolean, plus_until timestamptz,
  plan text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN QUERY
  SELECT r.redeemed_at, r.user_id, p.username, i.code, i.id, r.promotion_id, pr.name,
         r.via_signup, e.ends_at, public.current_plan(r.user_id)
    FROM public.invite_redemptions r
    JOIN public.invites i ON i.id = r.invite_id
    LEFT JOIN public.promotions pr ON pr.id = r.promotion_id
    LEFT JOIN public.profiles p ON p.user_id = r.user_id
    LEFT JOIN public.plan_entitlements e ON e.id = r.entitlement_id AND e.revoked_at IS NULL
   WHERE (_invite_id IS NULL OR r.invite_id = _invite_id)
     AND (_promotion_id IS NULL OR r.promotion_id = _promotion_id)
   ORDER BY r.redeemed_at DESC
   LIMIT least(greatest(coalesce(_limit, 200), 1), 1000);
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner: promotions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promotion_json(pr public.promotions)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(pr) || jsonb_build_object(
    'state', CASE
      WHEN pr.status <> 'active' THEN pr.status
      WHEN pr.ends_at IS NOT NULL AND pr.ends_at <= now() THEN 'ended'
      WHEN pr.starts_at IS NOT NULL AND pr.starts_at > now() THEN 'scheduled'
      ELSE 'live' END,
    'campaign_name', (SELECT c.name FROM public.marketing_campaigns c WHERE c.id = pr.campaign_id),
    'codes', (SELECT count(*) FROM public.invites i WHERE i.promotion_id = pr.id),
    'codes_open', (SELECT count(*) FROM public.invites i
                    WHERE i.promotion_id = pr.id AND public.invite_status(i) = 'open'),
    'redemptions', (SELECT count(*) FROM public.invite_redemptions r WHERE r.promotion_id = pr.id),
    'redemptions_7d', (SELECT count(*) FROM public.invite_redemptions r
                        WHERE r.promotion_id = pr.id AND r.redeemed_at > now() - interval '7 days'),
    'signups', (SELECT count(*) FROM public.invite_redemptions r
                 WHERE r.promotion_id = pr.id AND r.via_signup),
    'plus_now', (SELECT count(*) FROM public.plan_entitlements e
                  WHERE e.promotion_id = pr.id AND e.revoked_at IS NULL
                    AND now() >= e.starts_at AND now() < e.ends_at),
    'paying_now', (SELECT count(DISTINCT r.user_id) FROM public.invite_redemptions r
                    JOIN public.plus_subscriptions s ON s.user_id = r.user_id
                   WHERE r.promotion_id = pr.id AND s.livemode AND s.status IN ('active', 'past_due')))
$$;
REVOKE ALL ON FUNCTION public.promotion_json(public.promotions) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_promotions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'promotions', coalesce((SELECT jsonb_agg(public.promotion_json(pr) ORDER BY pr.created_at DESC)
                             FROM public.promotions pr), '[]'::jsonb),
    'campaigns', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.created_at DESC)
                            FROM public.marketing_campaigns c), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_promotion_save(_p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid := NULLIF(_p->>'id', '')::uuid;
  nm text := left(btrim(regexp_replace(coalesce(_p->>'name', ''), '[[:cntrl:]]+', ' ', 'g')), 80);
  ds text := NULLIF(left(btrim(coalesce(_p->>'description', '')), 500), '');
  st text := coalesce(NULLIF(_p->>'status', ''), 'active');
  sa timestamptz := NULLIF(_p->>'starts_at', '')::timestamptz;
  ea timestamptz := NULLIF(_p->>'ends_at', '')::timestamptz;
  pm integer := coalesce(NULLIF(_p->>'plus_months', '')::integer, 0);
  el text := coalesce(NULLIF(_p->>'eligibility', ''), 'anyone');
  mr integer := NULLIF(_p->>'max_redemptions', '')::integer;
  cid uuid := NULLIF(_p->>'campaign_id', '')::uuid;
  rec public.promotions%ROWTYPE;
BEGIN
  PERFORM public.owner_require_admin();
  IF char_length(nm) < 2 THEN
    RAISE EXCEPTION 'Give the promotion a name.' USING ERRCODE = '22023';
  END IF;
  IF pid IS NULL THEN
    INSERT INTO public.promotions
      (name, description, status, starts_at, ends_at, plus_months, eligibility, max_redemptions,
       campaign_id, created_by, updated_by)
    VALUES (nm, ds, st, sa, ea, pm, el, mr, cid, auth.uid(), auth.uid())
    RETURNING * INTO rec;
    PERFORM public.write_admin_audit('promotion.created', 'promotion', rec.id::text,
      jsonb_build_object('name', nm, 'plus_months', pm, 'eligibility', el, 'max_redemptions', mr));
  ELSE
    UPDATE public.promotions
       SET name = nm, description = ds, status = st, starts_at = sa, ends_at = ea,
           plus_months = pm, eligibility = el, max_redemptions = mr, campaign_id = cid,
           updated_by = auth.uid(), updated_at = now()
     WHERE id = pid
    RETURNING * INTO rec;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No promotion with that id.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.write_admin_audit('promotion.updated', 'promotion', pid::text,
      jsonb_build_object('name', nm, 'status', st, 'plus_months', pm, 'eligibility', el,
                         'max_redemptions', mr));
  END IF;
  RETURN public.promotion_json(rec);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_promotion_report(_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pr public.promotions%ROWTYPE;
  d integer := least(greatest(coalesce(_days, 30), 1), 365);
BEGIN
  PERFORM public.owner_require_admin();
  SELECT * INTO pr FROM public.promotions WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No promotion with that id.' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'promotion', public.promotion_json(pr),
    'daily', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', g.day, 'redemptions', coalesce(x.n, 0), 'signups', coalesce(x.s, 0)) ORDER BY g.day)
        FROM generate_series((now() - make_interval(days => d - 1))::date, now()::date, interval '1 day') AS g(day)
        LEFT JOIN (
          SELECT r.redeemed_at::date AS day, count(*) AS n, count(*) FILTER (WHERE r.via_signup) AS s
            FROM public.invite_redemptions r WHERE r.promotion_id = _id GROUP BY 1) x ON x.day = g.day::date),
      '[]'::jsonb),
    'codes', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'label', i.label,
               'status', public.invite_status(i), 'use_count', i.use_count, 'max_uses', i.max_uses,
               'expires_at', i.expires_at) ORDER BY i.use_count DESC, i.created_at)
        FROM public.invites i WHERE i.promotion_id = _id), '[]'::jsonb));
END;
$$;

-- Plus summary: founding and promotion grants counted apart.
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
                         WHERE plan = 'plus' AND source = 'founding_creator' AND revoked_at IS NULL
                           AND now() >= starts_at AND now() < ends_at),
    'promotion_active', (SELECT count(*) FROM public.plan_entitlements
                          WHERE plan = 'plus' AND promotion_id IS NOT NULL AND revoked_at IS NULL
                            AND now() >= starts_at AND now() < ends_at),
    'test_mode_active', (SELECT count(*) FROM public.plus_subscriptions
                          WHERE NOT livemode AND public.plus_status_is_active(status))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invite_status(public.invites) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_invite_list(uuid, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_invite_create(integer, text, text, integer, integer, uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_invite_revoke(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_invite_set_label(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_invite_redemptions(uuid, uuid, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_promotions() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_promotion_save(jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_promotion_report(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_invite_list(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_invite_create(integer, text, text, integer, integer, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_invite_revoke(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_invite_set_label(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_invite_redemptions(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_promotions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_promotion_save(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_promotion_report(uuid, integer) TO authenticated;
