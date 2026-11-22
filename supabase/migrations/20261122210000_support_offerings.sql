-- Support Offerings (GitHub issue #7), step 1: real digital offerings that
-- creators list, the owner approves version by version, and buyers receive
-- once they have paid. No checkout here and nothing can be bought: the
-- feature is off, checkout_enabled is off, and live payments wait for
-- Stripe's approval of Yooits' marketplace and digital content model.
--
-- Fee model (owner's spec, Nov 22): the creator keeps the whole price they
-- set; the buyer pays the existing $0.50 Yooits service fee on top, as tips
-- do today (src/lib/tipping/money.ts). The fee is applied on the server.
--
-- Every offering needs a real deliverable: a file in the private
-- support-files bucket, or (for an exclusive post) the post itself. A file
-- or post is never shown before a paid order; the database decides.
--
-- tip_settings, tips and their payment history are left exactly as they are.
--
-- Additive only. Rollback: supabase/rollbacks/20261122210000_support_offerings.down.sql

CREATE TABLE public.support_offering_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  checkout_enabled boolean NOT NULL DEFAULT false,
  price_min_cents integer NOT NULL DEFAULT 100 CHECK (price_min_cents >= 50),
  price_max_cents integer NOT NULL DEFAULT 50000 CHECK (price_max_cents <= 1000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CHECK (price_min_cents <= price_max_cents)
);
INSERT INTO public.support_offering_settings (id) VALUES (true);
ALTER TABLE public.support_offering_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_offering_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.support_offerings_on_for(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT enabled FROM public.support_offering_settings WHERE id), false)
      OR (_user_id IS NOT NULL AND public.has_role(_user_id, 'admin'))
$$;

-- One offering per thing a creator sells; its content lives in versions.
CREATE TABLE public.support_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  suspended_at timestamptz,
  suspended_by uuid,
  suspended_reason text CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 500)
);
CREATE INDEX idx_support_offerings_user ON public.support_offerings (user_id);
ALTER TABLE public.support_offerings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_offerings FROM anon, authenticated;

CREATE TABLE public.support_offering_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id uuid NOT NULL REFERENCES public.support_offerings (id) ON DELETE CASCADE,
  version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('download', 'digital_card', 'reader_pack', 'exclusive_post')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  description text NOT NULL CHECK (char_length(description) BETWEEN 20 AND 1000),
  -- Exactly what the buyer receives, shown before they pay.
  what_you_get text NOT NULL CHECK (char_length(what_you_get) BETWEEN 10 AND 280),
  min_price_cents integer NOT NULL CHECK (min_price_cents > 0),
  allow_pay_more boolean NOT NULL DEFAULT false,
  -- The deliverable: a private file, or the post itself.
  file_path text,
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  content_body text CHECK (content_body IS NULL OR char_length(content_body) <= 20000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'retired', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  UNIQUE (offering_id, version),
  CHECK (
    (kind = 'exclusive_post' AND content_body IS NOT NULL AND char_length(btrim(content_body)) >= 50 AND file_path IS NULL)
    OR (kind <> 'exclusive_post' AND file_path IS NOT NULL AND file_name IS NOT NULL)
  )
);
CREATE UNIQUE INDEX support_versions_one_pending ON public.support_offering_versions (offering_id) WHERE status = 'pending';
CREATE UNIQUE INDEX support_versions_one_approved ON public.support_offering_versions (offering_id) WHERE status = 'approved';
ALTER TABLE public.support_offering_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_offering_versions FROM anon, authenticated;

-- A version's content never changes; only its review status moves on.
CREATE OR REPLACE FUNCTION public.support_version_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.offering_id, NEW.version, NEW.kind, NEW.title, NEW.description, NEW.what_you_get,
      NEW.min_price_cents, NEW.allow_pay_more, NEW.file_path, NEW.file_name, NEW.content_body)
     IS DISTINCT FROM
     (OLD.offering_id, OLD.version, OLD.kind, OLD.title, OLD.description, OLD.what_you_get,
      OLD.min_price_cents, OLD.allow_pay_more, OLD.file_path, OLD.file_name, OLD.content_body) THEN
    RAISE EXCEPTION 'An offering version cannot be edited. Submit a new version.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER support_version_immutable BEFORE UPDATE ON public.support_offering_versions
  FOR EACH ROW EXECUTE FUNCTION public.support_version_immutable();

-- Orders, written only by the payment webhook (which comes later). An order
-- points at the exact version bought, so a later change never alters it.
CREATE TABLE public.support_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid REFERENCES public.support_offering_versions (id) ON DELETE SET NULL,
  -- Kept (with people cleared) if an account is deleted: these are financial records.
  creator_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  buyer_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'refunded', 'disputed', 'revoked')),
  livemode boolean NOT NULL DEFAULT false,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  fee_cents integer NOT NULL CHECK (fee_cents >= 0),
  checkout_session_id text UNIQUE,
  payment_intent_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_orders_buyer ON public.support_orders (buyer_user_id, version_id);
CREATE INDEX idx_support_orders_creator ON public.support_orders (creator_user_id, created_at DESC);
ALTER TABLE public.support_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_orders FROM anon, authenticated;

-- May this viewer have the deliverable of this version?
CREATE OR REPLACE FUNCTION public.support_version_unlocked(_version_id uuid, _viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _viewer IS NOT NULL AND coalesce((
    SELECT o.user_id = _viewer
        OR public.has_role(_viewer, 'admin')
        OR EXISTS (SELECT 1 FROM public.support_orders so
                    WHERE so.version_id = v.id AND so.buyer_user_id = _viewer AND so.status = 'paid')
      FROM public.support_offering_versions v
      JOIN public.support_offerings o ON o.id = v.offering_id
     WHERE v.id = _version_id
  ), false)
$$;

-- Private bucket for deliverables: <creator user id>/<file>.
INSERT INTO storage.buckets (id, name, public) VALUES ('support-files', 'support-files', false)
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types') THEN
    UPDATE storage.buckets
       SET public = false,
           file_size_limit = 52428800,
           allowed_mime_types = ARRAY['application/pdf', 'application/epub+zip', 'application/zip',
                                      'image/png', 'image/jpeg', 'image/webp', 'image/gif']
     WHERE id = 'support-files';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.support_file_visible(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() IS NOT NULL AND split_part(_name, '/', 1) = auth.uid()::text)
      OR EXISTS (
        SELECT 1 FROM public.support_offering_versions v
          JOIN public.support_offerings o ON o.id = v.offering_id
         WHERE v.file_path = _name
           AND split_part(_name, '/', 1) = o.user_id::text
           AND public.support_version_unlocked(v.id, auth.uid())
      )
$$;

CREATE OR REPLACE FUNCTION public.support_file_can_upload(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND split_part(_name, '/', 1) = auth.uid()::text
     AND public.support_offerings_on_for(auth.uid())
     AND NOT public.account_is_suspended(auth.uid())
$$;

CREATE POLICY "Support files: owners, admins and paid buyers"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'support-files' AND public.support_file_visible(name));
CREATE POLICY "Support files: creators upload to their folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'support-files' AND public.support_file_can_upload(name));
-- No delete policy: a file in an approved or sold version must stay.

-- ---------------------------------------------------------------------------
-- Creator side
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.creator_submit_support_offering(
  _offering_id uuid,
  _kind text,
  _title text,
  _description text,
  _what_you_get text,
  _min_price_cents integer,
  _allow_pay_more boolean,
  _file_path text,
  _file_name text,
  _content_body text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  s public.support_offering_settings;
  off public.support_offerings;
  vid uuid;
  path text := nullif(btrim(coalesce(_file_path, '')), '');
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.support_offerings_on_for(me) THEN
    RAISE EXCEPTION 'Support offerings are not available yet.' USING ERRCODE = '42501';
  END IF;
  IF public.account_is_suspended(me) THEN
    RAISE EXCEPTION 'Your account is suspended.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.support_offering_settings WHERE id;
  IF _min_price_cents IS NULL OR _min_price_cents < s.price_min_cents OR _min_price_cents > s.price_max_cents THEN
    RAISE EXCEPTION 'Choose a price between % and %.',
      '$' || to_char(s.price_min_cents / 100.0, 'FM999,990.00'), '$' || to_char(s.price_max_cents / 100.0, 'FM999,990.00')
      USING ERRCODE = '22023';
  END IF;
  IF _kind <> 'exclusive_post' THEN
    IF path IS NULL THEN
      RAISE EXCEPTION 'Upload the file buyers will receive.' USING ERRCODE = '22023';
    END IF;
    IF split_part(path, '/', 1) <> me::text OR path LIKE '%..%' THEN
      RAISE EXCEPTION 'Attach only your own upload.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'support-files' AND name = path) THEN
      RAISE EXCEPTION 'That file was not found. Upload it again.' USING ERRCODE = '22023';
    END IF;
  ELSIF char_length(btrim(coalesce(_content_body, ''))) < 50 THEN
    RAISE EXCEPTION 'Write the post buyers will receive (at least 50 characters).' USING ERRCODE = '22023';
  END IF;

  IF _offering_id IS NULL THEN
    INSERT INTO public.support_offerings (user_id) VALUES (me) RETURNING * INTO off;
  ELSE
    SELECT * INTO off FROM public.support_offerings WHERE id = _offering_id AND user_id = me FOR UPDATE;
    IF off.id IS NULL OR off.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Offering not found.' USING ERRCODE = '22023';
    END IF;
    IF off.suspended_at IS NOT NULL THEN
      RAISE EXCEPTION 'This offering is paused by Yooits.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.support_offering_versions SET status = 'withdrawn', decided_at = now()
     WHERE offering_id = off.id AND status = 'pending';
  END IF;

  INSERT INTO public.support_offering_versions
    (offering_id, version, kind, title, description, what_you_get, min_price_cents, allow_pay_more,
     file_path, file_name, content_body)
  VALUES (off.id,
          coalesce((SELECT max(version) FROM public.support_offering_versions WHERE offering_id = off.id), 0) + 1,
          _kind, btrim(_title), btrim(_description), btrim(_what_you_get), _min_price_cents,
          coalesce(_allow_pay_more, false),
          CASE WHEN _kind = 'exclusive_post' THEN NULL ELSE path END,
          CASE WHEN _kind = 'exclusive_post' THEN NULL ELSE nullif(btrim(coalesce(_file_name, '')), '') END,
          CASE WHEN _kind = 'exclusive_post' THEN btrim(_content_body) ELSE NULL END)
  RETURNING id INTO vid;
  RETURN vid;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_archive_support_offering(_offering_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  UPDATE public.support_offering_versions SET status = 'withdrawn', decided_at = now()
   WHERE offering_id = _offering_id AND status = 'pending'
     AND offering_id IN (SELECT id FROM public.support_offerings WHERE user_id = me);
  UPDATE public.support_offerings SET archived_at = now()
   WHERE id = _offering_id AND user_id = me AND archived_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.support_version_json(v public.support_offering_versions)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('id', v.id, 'version', v.version, 'kind', v.kind, 'title', v.title,
    'description', v.description, 'what_you_get', v.what_you_get, 'min_price_cents', v.min_price_cents,
    'allow_pay_more', v.allow_pay_more, 'file_name', v.file_name, 'status', v.status,
    'created_at', v.created_at, 'decision_note', v.decision_note)
$$;

CREATE OR REPLACE FUNCTION public.my_support_offerings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  s public.support_offering_settings;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.support_offerings_on_for(me) THEN
    RETURN jsonb_build_object('visible', false);
  END IF;
  SELECT * INTO s FROM public.support_offering_settings WHERE id;
  RETURN jsonb_build_object(
    'visible', true,
    'enabled', s.enabled,
    'checkout_enabled', s.checkout_enabled,
    'price_min_cents', s.price_min_cents,
    'price_max_cents', s.price_max_cents,
    'offerings', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', o.id, 'created_at', o.created_at,
               'suspended', o.suspended_at IS NOT NULL, 'suspended_reason', o.suspended_reason,
               'sales', (SELECT count(*)::int FROM public.support_orders so
                           JOIN public.support_offering_versions sv ON sv.id = so.version_id
                          WHERE sv.offering_id = o.id AND so.status = 'paid'),
               'versions', (SELECT jsonb_agg(public.support_version_json(v) ORDER BY v.version DESC)
                              FROM public.support_offering_versions v
                             WHERE v.offering_id = o.id AND v.status IN ('pending', 'approved', 'rejected')))
             ORDER BY o.created_at DESC)
        FROM public.support_offerings o WHERE o.user_id = me AND o.archived_at IS NULL
    ), '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner console (Support Approvals)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_support_offerings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(s) - 'id' FROM public.support_offering_settings s WHERE id),
    'offerings', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', o.id, 'user_id', o.user_id, 'username', pr.username, 'created_at', o.created_at,
               'archived', o.archived_at IS NOT NULL,
               'suspended', o.suspended_at IS NOT NULL, 'suspended_reason', o.suspended_reason,
               'versions', (SELECT jsonb_agg(public.support_version_json(v)
                                             || jsonb_build_object('content_body', v.content_body, 'file_path', v.file_path,
                                                                   'decided_at', v.decided_at)
                                             ORDER BY v.version DESC)
                              FROM public.support_offering_versions v WHERE v.offering_id = o.id))
             ORDER BY (EXISTS (SELECT 1 FROM public.support_offering_versions v
                                WHERE v.offering_id = o.id AND v.status = 'pending')) DESC, o.created_at DESC)
        FROM (SELECT * FROM public.support_offerings ORDER BY created_at DESC LIMIT 100) o
        LEFT JOIN public.profiles pr ON pr.user_id = o.user_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_support_offering_settings(
  _enabled boolean,
  _price_min_cents integer,
  _price_max_cents integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before jsonb;
  after jsonb;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT to_jsonb(s) - 'id' INTO before FROM public.support_offering_settings s WHERE id;
  UPDATE public.support_offering_settings
     SET enabled = coalesce(_enabled, enabled),
         price_min_cents = coalesce(_price_min_cents, price_min_cents),
         price_max_cents = coalesce(_price_max_cents, price_max_cents),
         updated_at = now(), updated_by = auth.uid()
   WHERE id;
  SELECT to_jsonb(s) - 'id' INTO after FROM public.support_offering_settings s WHERE id;
  PERFORM public.write_admin_audit('support_offerings.settings', 'setting', 'support_offerings',
                                   jsonb_build_object('before', before, 'after', after));
  RETURN after;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_decide_support_version(_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.support_offering_versions;
  owner_id uuid;
  note text := nullif(left(btrim(coalesce(_note, '')), 500), '');
BEGIN
  PERFORM public.owner_require_admin();
  SELECT * INTO v FROM public.support_offering_versions WHERE id = _id FOR UPDATE;
  IF v.id IS NULL OR v.status <> 'pending' THEN
    RAISE EXCEPTION 'That version is not waiting for review.' USING ERRCODE = '22023';
  END IF;
  IF NOT _approve AND note IS NULL THEN
    RAISE EXCEPTION 'Give a reason for the creator.' USING ERRCODE = '22023';
  END IF;
  SELECT user_id INTO owner_id FROM public.support_offerings WHERE id = v.offering_id;
  IF _approve THEN
    UPDATE public.support_offering_versions SET status = 'retired'
     WHERE offering_id = v.offering_id AND status = 'approved';
  END IF;
  UPDATE public.support_offering_versions
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         decided_at = now(), decided_by = auth.uid(), decision_note = note
   WHERE id = _id;
  PERFORM public.write_admin_audit(
    CASE WHEN _approve THEN 'support.version_approved' ELSE 'support.version_rejected' END,
    'user', owner_id::text,
    jsonb_build_object('offering_id', v.offering_id, 'version_id', v.id, 'version', v.version,
                       'title', v.title, 'min_price_cents', v.min_price_cents, 'note', note));
  RETURN CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_support_offering_suspended(_offering_id uuid, _suspended boolean, _reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reason text := nullif(left(btrim(coalesce(_reason, '')), 500), '');
  owner_id uuid;
BEGIN
  PERFORM public.owner_require_admin();
  IF _suspended AND reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.support_offerings
     SET suspended_at = CASE WHEN _suspended THEN now() END,
         suspended_by = CASE WHEN _suspended THEN auth.uid() END,
         suspended_reason = CASE WHEN _suspended THEN reason END
   WHERE id = _offering_id
  RETURNING user_id INTO owner_id;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Offering not found.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.write_admin_audit(
    CASE WHEN _suspended THEN 'support.offering_suspended' ELSE 'support.offering_restored' END,
    'user', owner_id::text, jsonb_build_object('offering_id', _offering_id, 'reason', reason));
  RETURN _suspended;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.support_offerings_on_for(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_version_unlocked(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_version_json(public.support_offering_versions) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_version_immutable() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.support_file_visible(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.support_file_can_upload(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.support_file_visible(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_file_can_upload(text) TO authenticated;

REVOKE ALL ON FUNCTION public.creator_submit_support_offering(uuid, text, text, text, text, integer, boolean, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.creator_archive_support_offering(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.my_support_offerings() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.creator_submit_support_offering(uuid, text, text, text, text, integer, boolean, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_archive_support_offering(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_support_offerings() TO authenticated;

REVOKE ALL ON FUNCTION public.owner_support_offerings() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_support_offering_settings(boolean, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_decide_support_version(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_support_offering_suspended(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_support_offerings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_support_offering_settings(boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_decide_support_version(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_support_offering_suspended(uuid, boolean, text) TO authenticated;
