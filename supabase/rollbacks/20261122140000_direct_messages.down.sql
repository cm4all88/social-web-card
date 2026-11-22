-- Rollback for 20261122140000_direct_messages.sql (direct messages).
-- Run in one transaction. Puts the schema back as it was before messages:
-- owner_list_reports returns its Nov 21 columns again, abuse_reports loses the
-- two message columns and accepts only 'profile' and 'wishlist' again, and the
-- messaging tables and functions are dropped.
-- This DELETES every message, conversation, block, messaging setting and
-- message report. Export them first if they matter, for example:
--   COPY (SELECT * FROM public.dm_messages) TO STDOUT WITH CSV HEADER;
--   COPY (SELECT * FROM public.abuse_reports WHERE target_kind = 'message') TO STDOUT WITH CSV HEADER;
-- Audit log rows written by owner actions stay in admin_audit_log.
-- After this, deploy code without /messages, or those pages show an error.
BEGIN;
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

DROP FUNCTION IF EXISTS public.owner_user_messaging(uuid);
DROP FUNCTION IF EXISTS public.owner_set_messaging_suspended(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.owner_remove_message(uuid, text);
DROP FUNCTION IF EXISTS public.owner_set_messaging_enabled(boolean);
DROP FUNCTION IF EXISTS public.owner_messaging_status();
DROP FUNCTION IF EXISTS public.dm_report_message(uuid, text, text);
DROP FUNCTION IF EXISTS public.dm_list_blocks();
DROP FUNCTION IF EXISTS public.dm_set_block(text, boolean);
DROP FUNCTION IF EXISTS public.dm_unread_count();
DROP FUNCTION IF EXISTS public.dm_mark_read(uuid);
DROP FUNCTION IF EXISTS public.dm_get_conversation(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.dm_list_conversations();
DROP FUNCTION IF EXISTS public.dm_respond(uuid, boolean);
DROP FUNCTION IF EXISTS public.dm_send(uuid, text);
DROP FUNCTION IF EXISTS public.dm_start(text, text);
DROP FUNCTION IF EXISTS public.dm_can_message(text);
DROP FUNCTION IF EXISTS public.dm_set_mode(text, boolean);
DROP FUNCTION IF EXISTS public.dm_my_settings();
DROP FUNCTION IF EXISTS public.dm_insert_message(uuid, public.dm_conversations, text);
DROP FUNCTION IF EXISTS public.dm_has_link(text);
DROP FUNCTION IF EXISTS public.dm_clean_body(text);
DROP FUNCTION IF EXISTS public.dm_check_rate(uuid, boolean);
DROP FUNCTION IF EXISTS public.dm_refusal(uuid, uuid);
DROP FUNCTION IF EXISTS public.dm_is_blocked_between(uuid, uuid);
DROP FUNCTION IF EXISTS public.dm_mode(uuid);
DROP FUNCTION IF EXISTS public.dm_user_can_use(uuid);

DELETE FROM public.abuse_reports WHERE target_kind = 'message';
DROP INDEX IF EXISTS public.idx_abuse_reports_message;
ALTER TABLE public.abuse_reports DROP CONSTRAINT IF EXISTS abuse_reports_message_matches;
ALTER TABLE public.abuse_reports DROP CONSTRAINT IF EXISTS abuse_reports_target_kind_check;
ALTER TABLE public.abuse_reports ADD CONSTRAINT abuse_reports_target_kind_check CHECK (target_kind IN ('profile', 'wishlist'));
ALTER TABLE public.abuse_reports DROP COLUMN IF EXISTS message_excerpt, DROP COLUMN IF EXISTS message_id;

DROP TABLE IF EXISTS public.dm_suspensions;
DROP TABLE IF EXISTS public.dm_blocks;
DROP TABLE IF EXISTS public.dm_removed_messages;
DROP TABLE IF EXISTS public.dm_messages;
DROP TABLE IF EXISTS public.dm_conversations;
DROP TABLE IF EXISTS public.dm_settings;
DROP TABLE IF EXISTS public.messaging_settings;
COMMIT;
