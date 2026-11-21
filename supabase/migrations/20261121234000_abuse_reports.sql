-- Abuse reports: anyone can report a profile or a wishlist; the owner reviews
-- them in the owner console.
--
-- Additive only: one new table and four new functions. No existing table,
-- policy, function or row is changed.
--
-- Rollback: supabase/rollbacks/20261121234000_abuse_reports.down.sql
-- (nothing else depends on these):
--   DROP FUNCTION IF EXISTS public.owner_resolve_report(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.owner_list_reports(text);
--   DROP FUNCTION IF EXISTS public.owner_open_report_count();
--   DROP FUNCTION IF EXISTS public.record_abuse_report(text, text, text, text, text, uuid, text);
--   DROP TABLE IF EXISTS public.abuse_reports;

-- ---------------------------------------------------------------------------
-- Reports (server-written only)
-- ---------------------------------------------------------------------------
CREATE TABLE public.abuse_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('profile', 'wishlist')),
  -- No foreign key: a report outlives the wishlist it is about.
  wishlist_id uuid,
  reason text NOT NULL CHECK (reason IN (
    'spam', 'scam', 'impersonation', 'harassment', 'sexual_content', 'illegal', 'other'
  )),
  details text CHECK (details IS NULL OR char_length(details) <= 1000),
  reporter_user_id uuid,
  reporter_contact text CHECK (reporter_contact IS NULL OR char_length(reporter_contact) <= 254),
  -- Salted hash of the reporter's IP, for rate limiting only; never the address.
  reporter_ip_hash text CHECK (reporter_ip_hash IS NULL OR char_length(reporter_ip_hash) <= 128),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abuse_reports_wishlist_matches CHECK ((target_kind = 'wishlist') = (wishlist_id IS NOT NULL))
);

CREATE INDEX idx_abuse_reports_status_created ON public.abuse_reports (status, created_at DESC);
CREATE INDEX idx_abuse_reports_ip_created ON public.abuse_reports (reporter_ip_hash, created_at);
CREATE INDEX idx_abuse_reports_target ON public.abuse_reports (target_user_id);

ALTER TABLE public.abuse_reports ENABLE ROW LEVEL SECURITY;
-- No policies: browsers can neither read nor write reports. Reports are
-- written by the server (record_abuse_report) and read through owner_* below.
REVOKE ALL ON public.abuse_reports FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Record a report (server only). Checks the target exists and applies limits
-- inside one locked call, so parallel requests can't slip past them.
-- Returns 'ok', 'not_found' or 'rate_limited'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_abuse_report(
  _username text,
  _wishlist_slug text,
  _reason text,
  _details text,
  _contact text,
  _reporter_user_id uuid,
  _ip_hash text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
  wl uuid;
  d text := nullif(left(btrim(coalesce(_details, '')), 1000), '');
  c text := nullif(left(btrim(coalesce(_contact, '')), 254), '');
BEGIN
  SELECT p.user_id INTO target FROM public.profiles p WHERE p.username = lower(btrim(_username));
  IF target IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF _wishlist_slug IS NOT NULL THEN
    SELECT w.id INTO wl FROM public.wishlists w
     WHERE w.user_id = target AND w.slug = lower(btrim(_wishlist_slug));
    IF wl IS NULL THEN
      RETURN 'not_found';
    END IF;
  END IF;

  IF _ip_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('abuse_report:' || _ip_hash));
    -- At most 5 reports an hour from one visitor, and one a day per target.
    IF (SELECT count(*) FROM public.abuse_reports
         WHERE reporter_ip_hash = _ip_hash AND created_at > now() - interval '1 hour') >= 5
       OR EXISTS (SELECT 1 FROM public.abuse_reports
                   WHERE reporter_ip_hash = _ip_hash AND target_user_id = target
                     AND wishlist_id IS NOT DISTINCT FROM wl
                     AND created_at > now() - interval '1 day') THEN
      RETURN 'rate_limited';
    END IF;
  END IF;
  -- A ceiling for the whole site, so a flood can't bury real reports.
  IF (SELECT count(*) FROM public.abuse_reports WHERE created_at > now() - interval '1 hour') >= 300 THEN
    RETURN 'rate_limited';
  END IF;

  INSERT INTO public.abuse_reports
    (target_user_id, target_kind, wishlist_id, reason, details, reporter_user_id, reporter_contact, reporter_ip_hash)
  VALUES
    (target, CASE WHEN wl IS NULL THEN 'profile' ELSE 'wishlist' END, wl, _reason, d, _reporter_user_id, c, _ip_hash);
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.record_abuse_report(text, text, text, text, text, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_abuse_report(text, text, text, text, text, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Owner console
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_open_report_count()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN (SELECT count(*)::int FROM public.abuse_reports WHERE status = 'open');
END;
$$;

-- Newest first, at most 200. _status: 'open' (default), 'resolved', 'dismissed' or 'all'.
CREATE OR REPLACE FUNCTION public.owner_list_reports(_status text DEFAULT 'open')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  IF _status NOT IN ('open', 'resolved', 'dismissed', 'all') THEN
    RAISE EXCEPTION 'Unknown report status.' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.created_at DESC)
      FROM (
        SELECT r.id, r.created_at, r.status, r.reason, r.details, r.target_kind,
               r.target_user_id, p.username AS target_username,
               w.slug AS wishlist_slug, w.title AS wishlist_title,
               r.reporter_user_id, rp.username AS reporter_username, r.reporter_contact,
               r.resolution_note, r.resolved_at
          FROM public.abuse_reports r
          LEFT JOIN public.profiles p ON p.user_id = r.target_user_id
          LEFT JOIN public.profiles rp ON rp.user_id = r.reporter_user_id
          LEFT JOIN public.wishlists w ON w.id = r.wishlist_id
         WHERE _status = 'all' OR r.status = _status
         ORDER BY r.created_at DESC
         LIMIT 200
      ) x
  ), '[]'::jsonb);
END;
$$;

-- Close a report as resolved or dismissed, with an optional note. Logged.
CREATE OR REPLACE FUNCTION public.owner_resolve_report(_id uuid, _status text, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n text := nullif(left(btrim(regexp_replace(coalesce(_note, ''), '[[:cntrl:]]+', ' ', 'g')), 500), '');
  t uuid;
BEGIN
  PERFORM public.owner_require_admin();
  IF _status NOT IN ('open', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Unknown report status.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.abuse_reports
     SET status = _status,
         resolution_note = n,
         resolved_by = CASE WHEN _status = 'open' THEN NULL ELSE auth.uid() END,
         resolved_at = CASE WHEN _status = 'open' THEN NULL ELSE now() END
   WHERE id = _id
  RETURNING target_user_id INTO t;
  IF t IS NULL THEN
    RAISE EXCEPTION 'No report with that id.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.write_admin_audit(
    'report.' || CASE _status WHEN 'open' THEN 'reopened' ELSE _status END,
    'report', _id::text,
    jsonb_build_object('target_user_id', t, 'note', n)
  );
  RETURN _status;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_open_report_count() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_list_reports(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_resolve_report(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_open_report_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_list_reports(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_resolve_report(uuid, text, text) TO authenticated;
