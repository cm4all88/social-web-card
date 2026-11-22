-- Dashboard announcements (written by the owner) and notifications (system
-- events for one person), shown on /dashboard. No email or push.
--
-- Additive only: new tables, functions and triggers. No existing table,
-- column, policy, function or row is changed.
--
-- Feature flag: feature_flags row 'dashboard_notifications'. While it is off,
-- only admins see announcements and notifications (so the owner can check
-- them first); notifications are still recorded.
--
-- Other features add notifications with public.notify_user(...), from server
-- code (service role) or their own SECURITY DEFINER functions.
--
-- Rollback: supabase/rollbacks/20261122150000_announcements_notifications.down.sql

-- ---------------------------------------------------------------------------
-- Feature flags (generic; readable by anyone, changed by the owner)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,59}$'),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feature_flags FROM anon, authenticated;
GRANT SELECT ON public.feature_flags TO anon, authenticated;
DROP POLICY IF EXISTS "Feature flags are readable" ON public.feature_flags;
CREATE POLICY "Feature flags are readable" ON public.feature_flags FOR SELECT USING (true);

INSERT INTO public.feature_flags (key, enabled) VALUES ('dashboard_notifications', false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.feature_enabled(_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT f.enabled FROM public.feature_flags f WHERE f.key = _key), false)
$$;
REVOKE ALL ON FUNCTION public.feature_enabled(text) FROM public;
GRANT EXECUTE ON FUNCTION public.feature_enabled(text) TO anon, authenticated, service_role;

-- Owner switch for any flag that already exists. Logged.
CREATE OR REPLACE FUNCTION public.owner_set_feature_flag(_key text, _enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  was boolean;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT enabled INTO was FROM public.feature_flags WHERE key = _key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No feature flag with that key.' USING ERRCODE = 'P0002';
  END IF;
  IF was IS DISTINCT FROM _enabled THEN
    UPDATE public.feature_flags SET enabled = _enabled, updated_at = now(), updated_by = auth.uid() WHERE key = _key;
    PERFORM public.write_admin_audit(
      'feature_flag.' || CASE WHEN _enabled THEN 'enabled' ELSE 'disabled' END,
      'feature_flag', _key, '{}'::jsonb);
  END IF;
  RETURN _enabled;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_set_feature_flag(text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_set_feature_flag(text, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- Announcements (owner-written, shown to an audience)
-- ---------------------------------------------------------------------------
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  -- A Yooits path ("/dashboard/wishlists") or an https:// address.
  link_url text CHECK (link_url IS NULL OR (
    char_length(link_url) <= 500
    AND (link_url ~ '^/[^/\\]' OR link_url = '/' OR link_url ~ '^https://[^/@\s]+(/|$)')
    AND link_url !~ '[[:cntrl:][:space:]]'
  )),
  link_label text CHECK (link_label IS NULL OR char_length(link_label) BETWEEN 1 AND 40),
  audience text NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'founding', 'plus')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_window CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT announcements_label_needs_link CHECK (link_label IS NULL OR link_url IS NOT NULL)
);
CREATE INDEX idx_announcements_live ON public.announcements (starts_at DESC) WHERE archived_at IS NULL;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
-- No policies: read through my_dashboard_feed() and owner_* functions.
REVOKE ALL ON public.announcements FROM anon, authenticated;

CREATE TABLE public.announcement_dismissals (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL REFERENCES public.announcements (id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);
ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.announcement_dismissals FROM anon, authenticated;
GRANT SELECT ON public.announcement_dismissals TO authenticated;
CREATE POLICY "Users see own dismissals" ON public.announcement_dismissals
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Is this announcement meant for this person?
CREATE OR REPLACE FUNCTION public.announcement_targets(_audience text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE _audience
    WHEN 'all' THEN true
    WHEN 'plus' THEN public.current_plan(_user_id) = 'plus'
    WHEN 'founding' THEN EXISTS (
      SELECT 1 FROM public.plan_entitlements e
       WHERE e.user_id = _user_id AND e.source = 'founding_creator' AND e.revoked_at IS NULL)
    ELSE false
  END
$$;
REVOKE ALL ON FUNCTION public.announcement_targets(text, uuid) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Notifications (one person's system events)
-- ---------------------------------------------------------------------------
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{0,39}$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text CHECK (body IS NULL OR char_length(body) <= 500),
  -- Only a Yooits path: notifications never link off the site.
  link_path text CHECK (link_path IS NULL OR (
    char_length(link_path) <= 300 AND (link_path = '/' OR link_path ~ '^/[^/\\]')
    AND link_path !~ '[[:cntrl:][:space:]]'
  )),
  dedupe_key text CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 200),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_notifications_dedupe ON public.notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_notifications_user_created ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
CREATE POLICY "Users see own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Add a notification. Returns its id, or NULL when the same dedupe_key was
-- already used for this person. Server and SECURITY DEFINER callers only.
CREATE OR REPLACE FUNCTION public.notify_user(
  _user_id uuid,
  _kind text,
  _title text,
  _body text DEFAULT NULL,
  _link text DEFAULT NULL,
  _dedupe_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nid uuid;
BEGIN
  INSERT INTO public.notifications (user_id, kind, title, body, link_path, dedupe_key)
  VALUES (_user_id, _kind, left(btrim(_title), 120), nullif(left(btrim(coalesce(_body, '')), 500), ''),
          nullif(btrim(coalesce(_link, '')), ''), _dedupe_key)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO nid;
  RETURN nid;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- What the dashboard reads, in one call
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_dashboard_feed()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  is_admin boolean;
  on_flag boolean := public.feature_enabled('dashboard_notifications');
  dm integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  is_admin := public.has_role(uid, 'admin');
  IF NOT on_flag AND NOT is_admin THEN
    RETURN jsonb_build_object('enabled', false, 'announcements', '[]'::jsonb, 'notifications', '[]'::jsonb,
                              'unread', 0, 'dm_unread', 0);
  END IF;
  -- Unread direct messages, when the messaging feature provides the count.
  IF to_regprocedure('public.dm_unread_count()') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT coalesce(public.dm_unread_count(), 0)::int' INTO dm;
    EXCEPTION WHEN OTHERS THEN
      dm := 0;
    END;
  END IF;
  RETURN jsonb_build_object(
    'enabled', true,
    'preview', NOT on_flag,
    'announcements', coalesce((
      SELECT jsonb_agg(row_to_json(a) ORDER BY a.starts_at DESC)
        FROM (
          SELECT x.id, x.title, x.body, x.link_url, x.link_label, x.starts_at
            FROM public.announcements x
           WHERE x.archived_at IS NULL AND x.starts_at <= now() AND (x.ends_at IS NULL OR x.ends_at > now())
             AND public.announcement_targets(x.audience, uid)
             AND NOT EXISTS (SELECT 1 FROM public.announcement_dismissals d
                              WHERE d.user_id = uid AND d.announcement_id = x.id)
           ORDER BY x.starts_at DESC
           LIMIT 3
        ) a), '[]'::jsonb),
    'notifications', coalesce((
      SELECT jsonb_agg(row_to_json(n) ORDER BY n.created_at DESC)
        FROM (
          SELECT y.id, y.kind, y.title, y.body, y.link_path, y.read_at, y.created_at
            FROM public.notifications y
           WHERE y.user_id = uid
           ORDER BY y.created_at DESC
           LIMIT 30
        ) n), '[]'::jsonb),
    'unread', (SELECT count(*)::int FROM public.notifications z WHERE z.user_id = uid AND z.read_at IS NULL),
    'dm_unread', dm
  );
END;
$$;
REVOKE ALL ON FUNCTION public.my_dashboard_feed() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_dashboard_feed() TO authenticated;

CREATE OR REPLACE FUNCTION public.dismiss_announcement(_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.announcement_dismissals (user_id, announcement_id)
  SELECT auth.uid(), a.id FROM public.announcements a WHERE a.id = _id
  ON CONFLICT DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.dismiss_announcement(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_announcement(uuid) TO authenticated;

-- Mark the given notifications read, or all of them when _ids is NULL.
-- Returns how many changed.
CREATE OR REPLACE FUNCTION public.mark_notifications_read(_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications SET read_at = now()
   WHERE user_id = auth.uid() AND read_at IS NULL AND (_ids IS NULL OR id = ANY (_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Owner console
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_list_announcements()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'enabled', public.feature_enabled('dashboard_notifications'),
    'announcements', coalesce((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC)
        FROM (
          SELECT a.*,
                 CASE WHEN a.archived_at IS NOT NULL THEN 'archived'
                      WHEN a.ends_at IS NOT NULL AND a.ends_at <= now() THEN 'ended'
                      WHEN a.starts_at > now() THEN 'scheduled'
                      ELSE 'live' END AS state,
                 (SELECT count(*)::int FROM public.announcement_dismissals d WHERE d.announcement_id = a.id) AS dismissals
            FROM public.announcements a
           ORDER BY a.created_at DESC
           LIMIT 200
        ) x), '[]'::jsonb));
END;
$$;

-- Create (_id NULL) or edit an announcement. Returns its id. Logged.
CREATE OR REPLACE FUNCTION public.owner_save_announcement(
  _id uuid,
  _title text,
  _body text,
  _link_url text,
  _link_label text,
  _audience text,
  _starts_at timestamptz,
  _ends_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text := btrim(regexp_replace(coalesce(_title, ''), '[[:cntrl:]]+', ' ', 'g'));
  b text := btrim(coalesce(_body, ''));
  l text := nullif(btrim(coalesce(_link_url, '')), '');
  ll text := nullif(btrim(regexp_replace(coalesce(_link_label, ''), '[[:cntrl:]]+', ' ', 'g')), '');
  rid uuid;
BEGIN
  PERFORM public.owner_require_admin();
  IF t = '' OR b = '' THEN
    RAISE EXCEPTION 'An announcement needs a title and a message.' USING ERRCODE = '22023';
  END IF;
  IF l IS NULL THEN ll := NULL; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.announcements (title, body, link_url, link_label, audience, starts_at, ends_at, created_by)
    VALUES (t, b, l, ll, coalesce(_audience, 'all'), coalesce(_starts_at, now()), _ends_at, auth.uid())
    RETURNING id INTO rid;
    PERFORM public.write_admin_audit('announcement.created', 'announcement', rid::text,
      jsonb_build_object('title', t, 'audience', coalesce(_audience, 'all')));
  ELSE
    UPDATE public.announcements
       SET title = t, body = b, link_url = l, link_label = ll, audience = coalesce(_audience, 'all'),
           starts_at = coalesce(_starts_at, starts_at), ends_at = _ends_at, updated_at = now()
     WHERE id = _id
    RETURNING id INTO rid;
    IF rid IS NULL THEN
      RAISE EXCEPTION 'No announcement with that id.' USING ERRCODE = 'P0002';
    END IF;
    PERFORM public.write_admin_audit('announcement.edited', 'announcement', rid::text,
      jsonb_build_object('title', t, 'audience', coalesce(_audience, 'all')));
  END IF;
  RETURN rid;
END;
$$;

-- Archive (hide for everyone) or restore an announcement. Logged.
CREATE OR REPLACE FUNCTION public.owner_archive_announcement(_id uuid, _archived boolean)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid uuid;
BEGIN
  PERFORM public.owner_require_admin();
  UPDATE public.announcements
     SET archived_at = CASE WHEN _archived THEN coalesce(archived_at, now()) ELSE NULL END, updated_at = now()
   WHERE id = _id
  RETURNING id INTO rid;
  IF rid IS NULL THEN
    RAISE EXCEPTION 'No announcement with that id.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.write_admin_audit(
    'announcement.' || CASE WHEN _archived THEN 'archived' ELSE 'restored' END,
    'announcement', rid::text, '{}'::jsonb);
  RETURN _archived;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_list_announcements() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_save_announcement(uuid, text, text, text, text, text, timestamptz, timestamptz) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_archive_announcement(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_announcements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_save_announcement(uuid, text, text, text, text, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_archive_announcement(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- System notifications. Each trigger is fail-safe: a problem here never
-- blocks the signup, grant or report change that caused it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_welcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.notify_user(NEW.user_id, 'welcome', 'Welcome to Yooits',
      'Add your links, then share yooits.me/' || NEW.username || ' anywhere.', '/dashboard', 'welcome');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'welcome notification skipped: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_welcome() FROM public, anon, authenticated;
CREATE TRIGGER profiles_notify_welcome
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_welcome();

CREATE OR REPLACE FUNCTION public.notify_founding_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.source = 'founding_creator' AND NEW.revoked_at IS NULL THEN
    BEGIN
      PERFORM public.notify_user(NEW.user_id, 'founding_member', 'You''re a Founding Member',
        'Yooits Plus is yours free until ' || to_char(NEW.ends_at AT TIME ZONE 'UTC', 'FMMonth FMDD, YYYY')
          || '. No card needed, and it won''t renew by itself.',
        '/dashboard', 'founding:' || NEW.id::text);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'founding member notification skipped: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_founding_member() FROM public, anon, authenticated;
CREATE TRIGGER plan_entitlements_notify_founding
  AFTER INSERT ON public.plan_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.notify_founding_member();

-- Tell a signed-in reporter their report was reviewed (not the outcome).
-- Covers every kind of report (pages, wishlists, messages).
CREATE OR REPLACE FUNCTION public.notify_report_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reporter_user_id IS NOT NULL AND OLD.status = 'open' AND NEW.status IN ('resolved', 'dismissed') THEN
    BEGIN
      PERFORM public.notify_user(NEW.reporter_user_id, 'report_reviewed', 'We reviewed your report',
        'Thanks for helping keep Yooits safe. Our team has looked at what you reported.',
        NULL, 'report:' || NEW.id::text);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'report notification skipped: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_report_reviewed() FROM public, anon, authenticated;
CREATE TRIGGER abuse_reports_notify_reviewed
  AFTER UPDATE OF status ON public.abuse_reports
  FOR EACH ROW EXECUTE FUNCTION public.notify_report_reviewed();
