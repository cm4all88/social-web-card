-- Creator subscriptions, step 2: applications, owner approval, subscription
-- offers, creator posts with private media, and the settings the owner sets
-- (price limits and fee rates). No checkout and no payment code here.
--
-- Everything is switched off: creators see none of it until the owner turns
-- on creator_subscription_settings.enabled; admins can use it meanwhile to
-- test. Selling stays impossible: checkout_enabled is false, no checkout
-- exists yet, and live payments wait for Stripe's approval of the model.
--
-- Money model (owner's spec, Nov 22): creators keep 100% of the price they
-- set; Yooits adds a clearly shown service and processing fee to the buyer's
-- total. The fee rates are NULL until the owner sets them; with no rates,
-- no fee can be shown and nothing can be sold.
--
-- Access to subscriber-only posts is decided only in the database
-- (creator_post_unlocked) and enforced on the posts feed and on the private
-- storage bucket; the browser never decides.
--
-- 18+: applying, and later subscribing, needs a confirmed age of 18 or older.
--
-- Additive only: new tables, functions, one private bucket and its policies.
-- Rollback: supabase/rollbacks/20261122200000_creator_subscriptions_foundation.down.sql

-- ---------------------------------------------------------------------------
-- Settings (one row)
-- ---------------------------------------------------------------------------
CREATE TABLE public.creator_subscription_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  checkout_enabled boolean NOT NULL DEFAULT false,
  price_min_cents integer NOT NULL DEFAULT 100 CHECK (price_min_cents >= 50),
  price_max_cents integer NOT NULL DEFAULT 50000 CHECK (price_max_cents <= 1000000),
  -- Fee rates. NULL = not set by the owner yet.
  yooits_percent_bps integer CHECK (yooits_percent_bps BETWEEN 0 AND 5000),
  yooits_fixed_cents integer CHECK (yooits_fixed_cents BETWEEN 0 AND 10000),
  stripe_percent_bps integer CHECK (stripe_percent_bps BETWEEN 0 AND 2000),
  stripe_fixed_cents integer CHECK (stripe_fixed_cents BETWEEN 0 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CHECK (price_min_cents <= price_max_cents)
);
INSERT INTO public.creator_subscription_settings (id) VALUES (true);
ALTER TABLE public.creator_subscription_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_subscription_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.creator_subscriptions_on_for(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT enabled FROM public.creator_subscription_settings WHERE id), false)
      OR (_user_id IS NOT NULL AND public.has_role(_user_id, 'admin'))
$$;

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------
CREATE TABLE public.creator_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  about text NOT NULL CHECK (char_length(about) BETWEEN 20 AND 1000),
  content_types text[] NOT NULL CHECK (content_types <@ ARRAY['text', 'photos', 'updates', 'other']::text[] AND cardinality(content_types) >= 1),
  adult_confirmed boolean NOT NULL CHECK (adult_confirmed),
  sfw_confirmed boolean NOT NULL CHECK (sfw_confirmed),
  qualifying_visitors integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500)
);
CREATE UNIQUE INDEX creator_applications_one_open ON public.creator_applications (user_id) WHERE status = 'pending';
CREATE INDEX idx_creator_applications_status ON public.creator_applications (status, created_at DESC);
ALTER TABLE public.creator_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_applications FROM anon, authenticated;

-- Who may sell subscriptions: approved by the owner, and not suspended.
CREATE TABLE public.creator_monetization (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  application_id uuid REFERENCES public.creator_applications (id) ON DELETE SET NULL,
  suspended_at timestamptz,
  suspended_by uuid,
  suspended_reason text CHECK (suspended_reason IS NULL OR char_length(suspended_reason) <= 500)
);
ALTER TABLE public.creator_monetization ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_monetization FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.creator_is_monetized(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.creator_monetization m
                  WHERE m.user_id = _user_id AND m.suspended_at IS NULL)
     AND NOT public.account_is_suspended(_user_id)
$$;

-- ---------------------------------------------------------------------------
-- Subscription offers: one price and description per version. A change is a
-- new version that needs approval; an approved version is never edited.
-- ---------------------------------------------------------------------------
CREATE TABLE public.creator_subscription_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  version integer NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'retired', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  -- Filled in by checkout setup later (Stripe product and price).
  stripe_product_id text,
  stripe_price_id text,
  UNIQUE (user_id, version)
);
CREATE UNIQUE INDEX creator_offers_one_pending ON public.creator_subscription_offers (user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX creator_offers_one_approved ON public.creator_subscription_offers (user_id) WHERE status = 'approved';
ALTER TABLE public.creator_subscription_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_subscription_offers FROM anon, authenticated;

-- Approved versions can't be changed, only retired.
CREATE OR REPLACE FUNCTION public.creator_offer_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'approved' AND (NEW.price_cents <> OLD.price_cents OR NEW.description <> OLD.description
                                  OR NEW.version <> OLD.version OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'An approved offer cannot be edited.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER creator_offer_immutable BEFORE UPDATE ON public.creator_subscription_offers
  FOR EACH ROW EXECUTE FUNCTION public.creator_offer_immutable();

-- ---------------------------------------------------------------------------
-- Subscriptions (written only by the payment webhook, which comes later)
-- ---------------------------------------------------------------------------
CREATE TABLE public.creator_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  -- Kept (with the creator cleared) if an account is deleted: these are financial records.
  creator_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  offer_id uuid REFERENCES public.creator_subscription_offers (id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('incomplete', 'active', 'past_due', 'canceled', 'unpaid', 'expired')),
  livemode boolean NOT NULL DEFAULT false,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  fee_cents integer NOT NULL CHECK (fee_cents >= 0),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  stripe_subscription_id text UNIQUE,
  stripe_customer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_creator_subscriptions_pair ON public.creator_subscriptions (creator_user_id, subscriber_user_id);
ALTER TABLE public.creator_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_subscriptions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_active_creator_subscription(_viewer uuid, _creator uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _viewer IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.creator_subscriptions s
     WHERE s.subscriber_user_id = _viewer AND s.creator_user_id = _creator
       AND s.status IN ('active', 'past_due')
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
  )
$$;

-- ---------------------------------------------------------------------------
-- Posts and private media
-- ---------------------------------------------------------------------------
CREATE TABLE public.creator_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK (visibility IN ('public', 'subscribers')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 10000),
  -- What visitors without a subscription see of a subscriber-only post.
  preview text CHECK (preview IS NULL OR char_length(preview) <= 280),
  media_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(media_paths) <= 8),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  removed_at timestamptz,
  removed_by uuid,
  removed_reason text CHECK (removed_reason IS NULL OR char_length(removed_reason) <= 500)
);
CREATE INDEX idx_creator_posts_user ON public.creator_posts (user_id, created_at DESC);
ALTER TABLE public.creator_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_posts FROM anon, authenticated;

-- May this viewer see the whole of this post (body and media)?
CREATE OR REPLACE FUNCTION public.creator_post_unlocked(_post_id uuid, _viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN _viewer IS NOT NULL AND (_viewer = p.user_id OR public.has_role(_viewer, 'admin')) THEN true
      WHEN p.deleted_at IS NOT NULL OR p.removed_at IS NOT NULL THEN false
      WHEN NOT public.profile_is_public(p.user_id) THEN false
      WHEN NOT public.creator_subscriptions_on_for(_viewer) THEN false
      WHEN p.visibility = 'public' THEN true
      ELSE public.creator_is_monetized(p.user_id)
           AND public.has_active_creator_subscription(_viewer, p.user_id)
    END
      FROM public.creator_posts p WHERE p.id = _post_id
  ), false)
$$;

-- A private bucket. Files are at <creator user id>/<file>. A file can be
-- downloaded (signed URL) only when a post that lists it is unlocked for the
-- viewer.
INSERT INTO storage.buckets (id, name, public) VALUES ('creator-media', 'creator-media', false)
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types') THEN
    UPDATE storage.buckets
       SET public = false,
           file_size_limit = 10485760,
           allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
     WHERE id = 'creator-media';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.creator_media_visible(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.creator_posts p
     WHERE _name = ANY (p.media_paths)
       AND split_part(_name, '/', 1) = p.user_id::text
       AND public.creator_post_unlocked(p.id, auth.uid())
  ) OR (split_part(_name, '/', 1) = coalesce(auth.uid()::text, '-'))
$$;

CREATE OR REPLACE FUNCTION public.creator_media_can_upload(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND split_part(_name, '/', 1) = auth.uid()::text
     AND (public.creator_is_monetized(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
     AND NOT public.account_is_suspended(auth.uid())
$$;

CREATE POLICY "Creator media: unlocked posts only"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'creator-media' AND public.creator_media_visible(name));
CREATE POLICY "Creator media: approved creators upload to their folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'creator-media' AND public.creator_media_can_upload(name));
CREATE POLICY "Creator media: creators delete their own files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'creator-media' AND split_part(name, '/', 1) = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Creator side
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.creator_require_on()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.creator_subscriptions_on_for(me) THEN
    RAISE EXCEPTION 'Creator subscriptions are not available yet.' USING ERRCODE = '42501';
  END IF;
  IF public.account_is_suspended(me) THEN
    RAISE EXCEPTION 'Your account is suspended.' USING ERRCODE = '42501';
  END IF;
  RETURN me;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_can_apply(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.creator_milestone_reached(_user_id, 'subscriptions_apply')
      OR public.has_role(_user_id, 'admin')
$$;

CREATE OR REPLACE FUNCTION public.creator_apply(
  _about text,
  _content_types text[],
  _adult_confirmed boolean,
  _sfw_confirmed boolean
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := public.creator_require_on();
  new_id uuid;
BEGIN
  IF NOT public.creator_can_apply(me) THEN
    RAISE EXCEPTION 'You can apply once you reach the visitor milestone.' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(_adult_confirmed, false) THEN
    RAISE EXCEPTION 'You must be 18 or older to offer subscriptions.' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(_sfw_confirmed, false) THEN
    RAISE EXCEPTION 'All content must be safe for work.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.creator_monetization WHERE user_id = me) THEN
    RAISE EXCEPTION 'You are already approved.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.creator_applications WHERE user_id = me AND status = 'pending') THEN
    RAISE EXCEPTION 'Your application is already waiting for review.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.creator_applications (user_id, about, content_types, adult_confirmed, sfw_confirmed, qualifying_visitors)
  VALUES (me, btrim(_about), (SELECT array_agg(DISTINCT t) FROM unnest(_content_types) t),
          true, true, public.creator_qualifying_visitors(me))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_withdraw_application()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := public.creator_require_on();
BEGIN
  UPDATE public.creator_applications SET status = 'withdrawn', decided_at = now()
   WHERE user_id = me AND status = 'pending';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_submit_offer(_price_cents integer, _description text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := public.creator_require_on();
  s public.creator_subscription_settings;
  new_id uuid;
BEGIN
  IF NOT public.creator_is_monetized(me) THEN
    RAISE EXCEPTION 'Your creator subscriptions are not approved.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.creator_subscription_settings WHERE id;
  IF _price_cents IS NULL OR _price_cents < s.price_min_cents OR _price_cents > s.price_max_cents THEN
    RAISE EXCEPTION 'Choose a monthly price between % and %.',
      '$' || to_char(s.price_min_cents / 100.0, 'FM999,990.00'), '$' || to_char(s.price_max_cents / 100.0, 'FM999,990.00')
      USING ERRCODE = '22023';
  END IF;
  -- Replaces a version still waiting for review; an approved one stays until the new one is approved.
  UPDATE public.creator_subscription_offers SET status = 'withdrawn', decided_at = now()
   WHERE user_id = me AND status = 'pending';
  INSERT INTO public.creator_subscription_offers (user_id, version, price_cents, description)
  VALUES (me, coalesce((SELECT max(version) FROM public.creator_subscription_offers WHERE user_id = me), 0) + 1,
          _price_cents, btrim(coalesce(_description, '')))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_save_post(
  _id uuid,
  _visibility text,
  _title text,
  _body text,
  _preview text,
  _media_paths text[]
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := public.creator_require_on();
  paths text[] := coalesce(_media_paths, '{}');
  pid uuid;
BEGIN
  IF NOT (public.creator_is_monetized(me) OR public.has_role(me, 'admin')) THEN
    RAISE EXCEPTION 'Posts open once your creator subscriptions are approved.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(paths) x WHERE split_part(x, '/', 1) <> me::text OR x LIKE '%..%') THEN
    RAISE EXCEPTION 'Attach only your own uploads.' USING ERRCODE = '42501';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.creator_posts (user_id, visibility, title, body, preview, media_paths)
    VALUES (me, _visibility, btrim(_title), coalesce(_body, ''), nullif(btrim(coalesce(_preview, '')), ''), paths)
    RETURNING id INTO pid;
  ELSE
    UPDATE public.creator_posts
       SET visibility = _visibility, title = btrim(_title), body = coalesce(_body, ''),
           preview = nullif(btrim(coalesce(_preview, '')), ''), media_paths = paths, updated_at = now()
     WHERE id = _id AND user_id = me AND deleted_at IS NULL AND removed_at IS NULL
    RETURNING id INTO pid;
    IF pid IS NULL THEN
      RAISE EXCEPTION 'Post not found.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN pid;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_delete_post(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := public.creator_require_on();
BEGIN
  UPDATE public.creator_posts SET deleted_at = now() WHERE id = _id AND user_id = me AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.creator_post_json(p public.creator_posts, _viewer uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.creator_post_unlocked(p.id, _viewer) THEN
    jsonb_build_object('id', p.id, 'visibility', p.visibility, 'title', p.title, 'body', p.body,
                       'preview', p.preview, 'media_paths', to_jsonb(p.media_paths), 'locked', false,
                       'created_at', p.created_at, 'updated_at', p.updated_at)
  ELSE
    jsonb_build_object('id', p.id, 'visibility', p.visibility, 'title', p.title,
                       'preview', p.preview, 'media_count', cardinality(p.media_paths), 'locked', true,
                       'created_at', p.created_at)
  END
$$;

-- The creator's own view: settings that matter to them, eligibility,
-- application, approval, offers and posts.
CREATE OR REPLACE FUNCTION public.my_creator_subscriptions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  s public.creator_subscription_settings;
  m public.creator_monetization;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.creator_subscriptions_on_for(me) THEN
    RETURN jsonb_build_object('visible', false);
  END IF;
  SELECT * INTO s FROM public.creator_subscription_settings WHERE id;
  SELECT * INTO m FROM public.creator_monetization WHERE user_id = me;
  RETURN jsonb_build_object(
    'visible', true,
    'enabled', s.enabled,
    'checkout_enabled', s.checkout_enabled,
    'price_min_cents', s.price_min_cents,
    'price_max_cents', s.price_max_cents,
    'fees', CASE WHEN s.yooits_percent_bps IS NULL OR s.yooits_fixed_cents IS NULL
                   OR s.stripe_percent_bps IS NULL OR s.stripe_fixed_cents IS NULL THEN NULL
            ELSE jsonb_build_object('yooits_percent_bps', s.yooits_percent_bps, 'yooits_fixed_cents', s.yooits_fixed_cents,
                                    'stripe_percent_bps', s.stripe_percent_bps, 'stripe_fixed_cents', s.stripe_fixed_cents) END,
    'can_apply', public.creator_can_apply(me),
    'application', (SELECT jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at,
                                              'decided_at', a.decided_at, 'decision_note', a.decision_note)
                      FROM public.creator_applications a WHERE a.user_id = me
                     ORDER BY a.created_at DESC LIMIT 1),
    'monetization', CASE WHEN m.user_id IS NULL THEN NULL ELSE jsonb_build_object(
                      'approved_at', m.approved_at, 'suspended', m.suspended_at IS NOT NULL,
                      'suspended_reason', m.suspended_reason) END,
    'offers', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'version', o.version, 'price_cents', o.price_cents,
                                  'description', o.description, 'status', o.status, 'created_at', o.created_at,
                                  'decision_note', o.decision_note) ORDER BY o.version DESC)
                          FROM public.creator_subscription_offers o
                         WHERE o.user_id = me AND o.status IN ('pending', 'approved', 'rejected')), '[]'::jsonb),
    'subscribers', (SELECT count(DISTINCT subscriber_user_id)::int FROM public.creator_subscriptions
                     WHERE creator_user_id = me AND status IN ('active', 'past_due')
                       AND (current_period_end IS NULL OR current_period_end > now())),
    'posts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'visibility', p.visibility, 'title', p.title,
                                  'body', p.body, 'preview', p.preview, 'media_paths', to_jsonb(p.media_paths),
                                  'created_at', p.created_at, 'removed', p.removed_at IS NOT NULL,
                                  'removed_reason', p.removed_reason) ORDER BY p.created_at DESC)
                         FROM public.creator_posts p WHERE p.user_id = me AND p.deleted_at IS NULL), '[]'::jsonb)
  );
END;
$$;

-- A creator's posts for whoever is looking. Subscriber-only posts come back
-- as title and preview only unless the viewer may see them.
CREATE OR REPLACE FUNCTION public.creator_feed(_username text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer uuid := auth.uid();
  owner_id uuid;
BEGIN
  IF NOT public.creator_subscriptions_on_for(viewer) THEN
    RETURN jsonb_build_object('enabled', false, 'posts', '[]'::jsonb);
  END IF;
  SELECT p.user_id INTO owner_id FROM public.profiles p WHERE p.username = lower(btrim(coalesce(_username, '')));
  IF owner_id IS NULL OR (NOT public.profile_is_public(owner_id) AND viewer IS DISTINCT FROM owner_id) THEN
    RETURN jsonb_build_object('enabled', true, 'posts', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'enabled', true,
    'subscribed', public.has_active_creator_subscription(viewer, owner_id),
    'posts', coalesce((
      SELECT jsonb_agg(public.creator_post_json(p, viewer) ORDER BY p.created_at DESC)
        FROM public.creator_posts p
       WHERE p.id IN (SELECT x.id FROM public.creator_posts x
                       WHERE x.user_id = owner_id AND x.deleted_at IS NULL AND x.removed_at IS NULL
                         -- Subscriber posts show only for creators who are approved and not suspended.
                         AND (x.visibility = 'public' OR public.creator_is_monetized(owner_id))
                       ORDER BY x.created_at DESC LIMIT 50)
    ), '[]'::jsonb)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner console
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_creator_subscriptions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(s) - 'id' FROM public.creator_subscription_settings s WHERE id),
    'applications', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', a.id, 'user_id', a.user_id, 'username', pr.username, 'status', a.status,
               'about', a.about, 'content_types', to_jsonb(a.content_types), 'qualifying_visitors', a.qualifying_visitors,
               'created_at', a.created_at, 'decided_at', a.decided_at, 'decision_note', a.decision_note)
             ORDER BY (a.status = 'pending') DESC, a.created_at DESC)
        FROM (SELECT * FROM public.creator_applications ORDER BY created_at DESC LIMIT 100) a
        LEFT JOIN public.profiles pr ON pr.user_id = a.user_id
    ), '[]'::jsonb),
    'creators', coalesce((
      SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', pr.username, 'approved_at', m.approved_at,
               'suspended', m.suspended_at IS NOT NULL, 'suspended_reason', m.suspended_reason,
               'posts', (SELECT count(*)::int FROM public.creator_posts p WHERE p.user_id = m.user_id AND p.deleted_at IS NULL),
               'subscribers', (SELECT count(DISTINCT subscriber_user_id)::int FROM public.creator_subscriptions s
                                WHERE s.creator_user_id = m.user_id AND s.status IN ('active', 'past_due')))
             ORDER BY m.approved_at DESC)
        FROM public.creator_monetization m LEFT JOIN public.profiles pr ON pr.user_id = m.user_id
    ), '[]'::jsonb),
    'offers', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', o.id, 'user_id', o.user_id, 'username', pr.username, 'version', o.version,
               'price_cents', o.price_cents, 'description', o.description, 'status', o.status,
               'created_at', o.created_at, 'decision_note', o.decision_note)
             ORDER BY (o.status = 'pending') DESC, o.created_at DESC)
        FROM (SELECT * FROM public.creator_subscription_offers WHERE status IN ('pending', 'approved', 'rejected')
               ORDER BY created_at DESC LIMIT 100) o
        LEFT JOIN public.profiles pr ON pr.user_id = o.user_id
    ), '[]'::jsonb),
    'posts', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'user_id', p.user_id, 'username', pr.username,
               'visibility', p.visibility, 'title', p.title, 'body', left(p.body, 500), 'preview', p.preview,
               'media_count', cardinality(p.media_paths), 'created_at', p.created_at,
               'removed', p.removed_at IS NOT NULL, 'removed_reason', p.removed_reason)
             ORDER BY p.created_at DESC)
        FROM (SELECT * FROM public.creator_posts WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 50) p
        LEFT JOIN public.profiles pr ON pr.user_id = p.user_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_creator_subscription_settings(
  _enabled boolean,
  _price_min_cents integer,
  _price_max_cents integer,
  _yooits_percent_bps integer,
  _yooits_fixed_cents integer,
  _stripe_percent_bps integer,
  _stripe_fixed_cents integer
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
  SELECT to_jsonb(s) - 'id' INTO before FROM public.creator_subscription_settings s WHERE id;
  -- Fee rates are replaced as given (NULL clears a rate); the rest keep their value when NULL.
  UPDATE public.creator_subscription_settings
     SET enabled = coalesce(_enabled, enabled),
         price_min_cents = coalesce(_price_min_cents, price_min_cents),
         price_max_cents = coalesce(_price_max_cents, price_max_cents),
         yooits_percent_bps = _yooits_percent_bps,
         yooits_fixed_cents = _yooits_fixed_cents,
         stripe_percent_bps = _stripe_percent_bps,
         stripe_fixed_cents = _stripe_fixed_cents,
         updated_at = now(), updated_by = auth.uid()
   WHERE id;
  SELECT to_jsonb(s) - 'id' INTO after FROM public.creator_subscription_settings s WHERE id;
  PERFORM public.write_admin_audit('creator_subscriptions.settings', 'setting', 'creator_subscriptions',
                                   jsonb_build_object('before', before, 'after', after));
  RETURN after;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_decide_creator_application(_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.creator_applications;
  note text := nullif(left(btrim(coalesce(_note, '')), 500), '');
BEGIN
  PERFORM public.owner_require_admin();
  SELECT * INTO a FROM public.creator_applications WHERE id = _id FOR UPDATE;
  IF a.id IS NULL OR a.status <> 'pending' THEN
    RAISE EXCEPTION 'That application is not waiting for review.' USING ERRCODE = '22023';
  END IF;
  IF NOT _approve AND note IS NULL THEN
    RAISE EXCEPTION 'Give a reason for the creator.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.creator_applications
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         decided_at = now(), decided_by = auth.uid(), decision_note = note
   WHERE id = _id;
  IF _approve THEN
    INSERT INTO public.creator_monetization (user_id, approved_by, application_id)
    VALUES (a.user_id, auth.uid(), a.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  PERFORM public.write_admin_audit(
    CASE WHEN _approve THEN 'creator.application_approved' ELSE 'creator.application_rejected' END,
    'user', a.user_id::text, jsonb_build_object('application_id', a.id, 'note', note));
  RETURN CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_decide_creator_offer(_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.creator_subscription_offers;
  note text := nullif(left(btrim(coalesce(_note, '')), 500), '');
BEGIN
  PERFORM public.owner_require_admin();
  SELECT * INTO o FROM public.creator_subscription_offers WHERE id = _id FOR UPDATE;
  IF o.id IS NULL OR o.status <> 'pending' THEN
    RAISE EXCEPTION 'That offer is not waiting for review.' USING ERRCODE = '22023';
  END IF;
  IF NOT _approve AND note IS NULL THEN
    RAISE EXCEPTION 'Give a reason for the creator.' USING ERRCODE = '22023';
  END IF;
  IF _approve THEN
    UPDATE public.creator_subscription_offers SET status = 'retired'
     WHERE user_id = o.user_id AND status = 'approved';
  END IF;
  UPDATE public.creator_subscription_offers
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         decided_at = now(), decided_by = auth.uid(), decision_note = note
   WHERE id = _id;
  PERFORM public.write_admin_audit(
    CASE WHEN _approve THEN 'creator.offer_approved' ELSE 'creator.offer_rejected' END,
    'user', o.user_id::text,
    jsonb_build_object('offer_id', o.id, 'version', o.version, 'price_cents', o.price_cents, 'note', note));
  RETURN CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_creator_monetization_suspended(_user_id uuid, _suspended boolean, _reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reason text := nullif(left(btrim(coalesce(_reason, '')), 500), '');
BEGIN
  PERFORM public.owner_require_admin();
  IF _suspended AND reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.creator_monetization
     SET suspended_at = CASE WHEN _suspended THEN now() END,
         suspended_by = CASE WHEN _suspended THEN auth.uid() END,
         suspended_reason = CASE WHEN _suspended THEN reason END
   WHERE user_id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That creator is not approved for subscriptions.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.write_admin_audit(
    CASE WHEN _suspended THEN 'creator.monetization_suspended' ELSE 'creator.monetization_restored' END,
    'user', _user_id::text, jsonb_build_object('reason', reason));
  RETURN _suspended;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_remove_creator_post(_id uuid, _removed boolean, _reason text DEFAULT NULL)
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
  IF _removed AND reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.creator_posts
     SET removed_at = CASE WHEN _removed THEN now() END,
         removed_by = CASE WHEN _removed THEN auth.uid() END,
         removed_reason = CASE WHEN _removed THEN reason END
   WHERE id = _id
  RETURNING user_id INTO owner_id;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Post not found.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.write_admin_audit(
    CASE WHEN _removed THEN 'creator.post_removed' ELSE 'creator.post_restored' END,
    'user', owner_id::text, jsonb_build_object('post_id', _id, 'reason', reason));
  RETURN _removed;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.creator_subscriptions_on_for(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_is_monetized(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_active_creator_subscription(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_post_unlocked(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_require_on() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_can_apply(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_post_json(public.creator_posts, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_offer_immutable() FROM public, anon, authenticated;
-- Storage policies call these as the viewer.
REVOKE ALL ON FUNCTION public.creator_media_visible(text) FROM public;
REVOKE ALL ON FUNCTION public.creator_media_can_upload(text) FROM public;
GRANT EXECUTE ON FUNCTION public.creator_media_visible(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creator_media_can_upload(text) TO authenticated;

REVOKE ALL ON FUNCTION public.creator_apply(text, text[], boolean, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.creator_withdraw_application() FROM public, anon;
REVOKE ALL ON FUNCTION public.creator_submit_offer(integer, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.creator_save_post(uuid, text, text, text, text, text[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.creator_delete_post(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.my_creator_subscriptions() FROM public, anon;
REVOKE ALL ON FUNCTION public.creator_feed(text) FROM public;
GRANT EXECUTE ON FUNCTION public.creator_apply(text, text[], boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_withdraw_application() TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_submit_offer(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_save_post(uuid, text, text, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_delete_post(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_creator_subscriptions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_feed(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.owner_creator_subscriptions() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_creator_subscription_settings(boolean, integer, integer, integer, integer, integer, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_decide_creator_application(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_decide_creator_offer(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_creator_monetization_suspended(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_remove_creator_post(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_creator_subscriptions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_creator_subscription_settings(boolean, integer, integer, integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_decide_creator_application(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_decide_creator_offer(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_creator_monetization_suspended(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_remove_creator_post(uuid, boolean, text) TO authenticated;
