-- Direct messages: opt-in, text-only messages between registered users, with
-- message requests, blocking, reporting, rate limits and owner moderation.
--
-- Safety defaults:
--  - Messaging is switched off for the whole site until the owner turns it on
--    (messaging_settings.enabled). Admins can use it before that, for testing.
--  - Every person's messages start OFF. Turning them on needs a confirmation
--    that the person is 18 or older (sign-ups are 13+, and Yooits stores no
--    birth date), so under-18s can't use messages at launch.
--  - "Requests" mode (the first choice offered): a stranger's first message
--    waits as a request, may not contain links, and only one is allowed until
--    it is accepted.
--  - Rows are written only by the SECURITY DEFINER functions below. Row-level
--    security lets only the two participants (and admins) read a conversation.
--
-- Additive, apart from two small changes to the abuse reports added on Nov 21:
--  - abuse_reports gets two nullable columns and accepts target_kind 'message';
--  - owner_list_reports returns the new columns too.
-- Every user-owned table cascades from auth.users, so deleting an account
-- removes that person's settings, blocks and conversations.
--
-- Rollback: supabase/rollbacks/20261122140000_direct_messages.down.sql

-- ---------------------------------------------------------------------------
-- Site-wide switch (one row)
-- ---------------------------------------------------------------------------
CREATE TABLE public.messaging_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.messaging_settings (id, enabled) VALUES (true, false);
ALTER TABLE public.messaging_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.messaging_settings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Each person's choice
-- ---------------------------------------------------------------------------
CREATE TABLE public.dm_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'requests', 'everyone')),
  adult_confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dm_settings_adult_to_enable CHECK (mode = 'off' OR adult_confirmed_at IS NOT NULL)
);
ALTER TABLE public.dm_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dm_settings FROM anon, authenticated;
GRANT SELECT ON public.dm_settings TO authenticated;
CREATE POLICY "Users read own message settings" ON public.dm_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Conversations (one per pair) and messages
-- ---------------------------------------------------------------------------
CREATE TABLE public.dm_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'request' CHECK (status IN ('request', 'active', 'declined')),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  a_last_read_at timestamptz,
  b_last_read_at timestamptz,
  CONSTRAINT dm_conversations_ordered CHECK (user_a < user_b),
  CONSTRAINT dm_conversations_requester CHECK (requested_by IN (user_a, user_b)),
  CONSTRAINT dm_conversations_pair UNIQUE (user_a, user_b)
);
CREATE INDEX idx_dm_conversations_b ON public.dm_conversations (user_b, last_message_at DESC);
CREATE INDEX idx_dm_conversations_a ON public.dm_conversations (user_a, last_message_at DESC);
CREATE INDEX idx_dm_conversations_requester ON public.dm_conversations (requested_by, created_at);

CREATE TABLE public.dm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.dm_conversations (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Cleared (NULL) when the owner removes the message; the text then lives
  -- only in dm_removed_messages, which participants can't read.
  body text CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid,
  removed_reason text CHECK (removed_reason IS NULL OR char_length(removed_reason) <= 200),
  CONSTRAINT dm_messages_removed_has_no_body CHECK ((removed_at IS NULL) = (body IS NOT NULL))
);
CREATE INDEX idx_dm_messages_conversation ON public.dm_messages (conversation_id, created_at DESC);
CREATE INDEX idx_dm_messages_sender ON public.dm_messages (sender_id, created_at DESC);

CREATE TABLE public.dm_removed_messages (
  message_id uuid PRIMARY KEY REFERENCES public.dm_messages (id) ON DELETE CASCADE,
  body text NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dm_removed_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dm_conversations, public.dm_messages, public.dm_removed_messages FROM anon, authenticated;
GRANT SELECT ON public.dm_conversations, public.dm_messages TO authenticated;

CREATE POLICY "Participants read conversations" ON public.dm_conversations
  FOR SELECT TO authenticated
  USING (auth.uid() IN (user_a, user_b) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Participants read messages" ON public.dm_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.dm_conversations c
             WHERE c.id = conversation_id AND auth.uid() IN (c.user_a, c.user_b))
    OR public.has_role(auth.uid(), 'admin')
  );
-- dm_removed_messages: no policies and no grants; admins read it through owner_* functions.

-- ---------------------------------------------------------------------------
-- Blocks and messaging suspensions
-- ---------------------------------------------------------------------------
CREATE TABLE public.dm_blocks (
  blocker_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_dm_blocks_blocked ON public.dm_blocks (blocked_id);
ALTER TABLE public.dm_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dm_blocks FROM anon, authenticated;
GRANT SELECT ON public.dm_blocks TO authenticated;
CREATE POLICY "Users read own blocks" ON public.dm_blocks
  FOR SELECT TO authenticated USING (blocker_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.dm_suspensions (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  suspended_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dm_suspensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dm_suspensions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reports about messages reuse abuse_reports
-- ---------------------------------------------------------------------------
ALTER TABLE public.abuse_reports
  ADD COLUMN message_id uuid,
  ADD COLUMN message_excerpt text CHECK (message_excerpt IS NULL OR char_length(message_excerpt) <= 2000);
ALTER TABLE public.abuse_reports DROP CONSTRAINT abuse_reports_target_kind_check;
ALTER TABLE public.abuse_reports
  ADD CONSTRAINT abuse_reports_target_kind_check CHECK (target_kind IN ('profile', 'wishlist', 'message')),
  ADD CONSTRAINT abuse_reports_message_matches CHECK ((target_kind = 'message') = (message_id IS NOT NULL));
CREATE INDEX idx_abuse_reports_message ON public.abuse_reports (message_id) WHERE message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helpers (not callable from the browser)
-- ---------------------------------------------------------------------------
-- Can this person use messages at all right now? (Site switch, suspensions.)
CREATE OR REPLACE FUNCTION public.dm_user_can_use(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND ((SELECT enabled FROM public.messaging_settings WHERE id) OR public.has_role(_user_id, 'admin'))
     AND NOT public.account_is_suspended(_user_id)
     AND NOT EXISTS (SELECT 1 FROM public.dm_suspensions s WHERE s.user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.dm_mode(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT mode FROM public.dm_settings WHERE user_id = _user_id), 'off')
$$;

CREATE OR REPLACE FUNCTION public.dm_is_blocked_between(_x uuid, _y uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.dm_blocks b
                  WHERE (b.blocker_id = _x AND b.blocked_id = _y)
                     OR (b.blocker_id = _y AND b.blocked_id = _x))
$$;

-- Why can't _me message _them? NULL means they can. Same order the person
-- would fix things in: their own state first, then the other person's.
CREATE OR REPLACE FUNCTION public.dm_refusal(_me uuid, _them uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _me IS NULL THEN RETURN 'signed_out'; END IF;
  IF NOT (SELECT enabled FROM public.messaging_settings WHERE id) AND NOT public.has_role(_me, 'admin') THEN
    RETURN 'unavailable';
  END IF;
  IF public.account_is_suspended(_me) OR EXISTS (SELECT 1 FROM public.dm_suspensions WHERE user_id = _me) THEN
    RETURN 'suspended';
  END IF;
  IF _them IS NULL THEN RETURN 'not_found'; END IF;
  IF _them = _me THEN RETURN 'self'; END IF;
  IF public.dm_mode(_me) = 'off' THEN RETURN 'own_off'; END IF;
  IF EXISTS (SELECT 1 FROM public.dm_blocks WHERE blocker_id = _me AND blocked_id = _them) THEN
    RETURN 'you_blocked';
  END IF;
  -- Blocked by them, their messages off, or they can't use messages: one
  -- answer, so nobody learns they were blocked.
  IF EXISTS (SELECT 1 FROM public.dm_blocks WHERE blocker_id = _them AND blocked_id = _me)
     OR public.dm_mode(_them) = 'off'
     OR NOT public.dm_user_can_use(_them)
     OR NOT public.profile_is_public(_them) THEN
    RETURN 'closed';
  END IF;
  RETURN NULL;
END;
$$;

-- Per-sender limits, checked under a lock so parallel sends can't slip past.
CREATE OR REPLACE FUNCTION public.dm_check_rate(_me uuid, _new_conversation boolean)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('dm_send:' || _me::text));
  IF (SELECT count(*) FROM public.dm_messages
       WHERE sender_id = _me AND created_at > now() - interval '1 minute') >= 20
     OR (SELECT count(*) FROM public.dm_messages
          WHERE sender_id = _me AND created_at > now() - interval '1 day') >= 500 THEN
    RETURN 'rate_limited';
  END IF;
  IF _new_conversation AND (SELECT count(*) FROM public.dm_conversations
                             WHERE requested_by = _me AND created_at > now() - interval '1 day') >= 10 THEN
    RETURN 'too_many_new';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_clean_body(_body text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- Keep line breaks and tabs, drop other control characters, trim the ends.
  SELECT nullif(btrim(regexp_replace(coalesce(_body, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), '')
$$;

CREATE OR REPLACE FUNCTION public.dm_has_link(_body text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _body ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|io|co|me|app|ly|gg|link|xyz|info|biz|site|online|shop|store|ru|cn|tk)\M)'
$$;

REVOKE ALL ON FUNCTION public.dm_user_can_use(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.dm_mode(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.dm_is_blocked_between(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.dm_refusal(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.dm_check_rate(uuid, boolean) FROM public, anon, authenticated;

-- Insert one message into a conversation the caller belongs to, after every
-- check. Returns the new message id. Raises with a short code on refusal.
CREATE OR REPLACE FUNCTION public.dm_insert_message(_me uuid, _conv public.dm_conversations, _body text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  them uuid := CASE WHEN _conv.user_a = _me THEN _conv.user_b ELSE _conv.user_a END;
  b text := public.dm_clean_body(_body);
  why text;
  mid uuid;
  pending boolean := _conv.status <> 'active';
BEGIN
  IF b IS NULL THEN RAISE EXCEPTION 'empty' USING ERRCODE = '22023'; END IF;
  IF char_length(b) > 2000 THEN RAISE EXCEPTION 'too_long' USING ERRCODE = '22023'; END IF;
  why := public.dm_refusal(_me, them);
  IF why IS NOT NULL THEN RAISE EXCEPTION '%', why USING ERRCODE = '42501'; END IF;

  IF pending AND _conv.requested_by = _me THEN
    IF _conv.status = 'declined' THEN RAISE EXCEPTION 'closed' USING ERRCODE = '42501'; END IF;
    IF EXISTS (SELECT 1 FROM public.dm_messages WHERE conversation_id = _conv.id AND sender_id = _me) THEN
      RAISE EXCEPTION 'awaiting_accept' USING ERRCODE = '42501';
    END IF;
    IF public.dm_has_link(b) THEN RAISE EXCEPTION 'no_links_in_request' USING ERRCODE = '42501'; END IF;
  END IF;

  why := public.dm_check_rate(_me, false);
  IF why IS NOT NULL THEN RAISE EXCEPTION '%', why USING ERRCODE = '54000'; END IF;

  INSERT INTO public.dm_messages (conversation_id, sender_id, body) VALUES (_conv.id, _me, b) RETURNING id INTO mid;
  UPDATE public.dm_conversations
     SET last_message_at = now(),
         -- Replying to a request (or a declined one) accepts it.
         status = CASE WHEN status <> 'active' AND requested_by <> _me THEN 'active' ELSE status END,
         accepted_at = CASE WHEN status <> 'active' AND requested_by <> _me THEN now() ELSE accepted_at END,
         a_last_read_at = CASE WHEN user_a = _me THEN now() ELSE a_last_read_at END,
         b_last_read_at = CASE WHEN user_b = _me THEN now() ELSE b_last_read_at END
   WHERE id = _conv.id;
  RETURN mid;
END;
$$;
REVOKE ALL ON FUNCTION public.dm_insert_message(uuid, public.dm_conversations, text) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Browser-callable functions (signed-in people)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dm_my_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'signed_out' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'available', (SELECT enabled FROM public.messaging_settings WHERE id) OR public.has_role(me, 'admin'),
    'site_enabled', (SELECT enabled FROM public.messaging_settings WHERE id),
    'mode', public.dm_mode(me),
    'adult_confirmed', EXISTS (SELECT 1 FROM public.dm_settings WHERE user_id = me AND adult_confirmed_at IS NOT NULL),
    'suspended', public.account_is_suspended(me) OR EXISTS (SELECT 1 FROM public.dm_suspensions WHERE user_id = me)
  );
END;
$$;

-- Choose off / requests / everyone. Turning messages on needs _confirm_adult
-- the first time.
CREATE OR REPLACE FUNCTION public.dm_set_mode(_mode text, _confirm_adult boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  adult timestamptz;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'signed_out' USING ERRCODE = '42501'; END IF;
  IF _mode NOT IN ('off', 'requests', 'everyone') THEN
    RAISE EXCEPTION 'Unknown setting.' USING ERRCODE = '22023';
  END IF;
  SELECT adult_confirmed_at INTO adult FROM public.dm_settings WHERE user_id = me;
  IF _mode <> 'off' AND adult IS NULL AND NOT coalesce(_confirm_adult, false) THEN
    RAISE EXCEPTION 'adult_required' USING ERRCODE = '42501';
  END IF;
  adult := coalesce(adult, CASE WHEN coalesce(_confirm_adult, false) THEN now() END);
  INSERT INTO public.dm_settings (user_id, mode, adult_confirmed_at, updated_at)
  VALUES (me, _mode, adult, now())
  ON CONFLICT (user_id) DO UPDATE
    SET mode = EXCLUDED.mode, adult_confirmed_at = EXCLUDED.adult_confirmed_at, updated_at = now();
  RETURN public.dm_my_settings();
END;
$$;

-- For the Message button on a profile: 'ok', 'request' (it will arrive as a
-- request) or the reason it can't be sent, plus an existing conversation.
CREATE OR REPLACE FUNCTION public.dm_can_message(_username text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  them uuid;
  why text;
  conv uuid;
BEGIN
  SELECT p.user_id INTO them FROM public.profiles p WHERE p.username = lower(btrim(_username));
  why := public.dm_refusal(me, them);
  IF me IS NOT NULL AND them IS NOT NULL THEN
    SELECT id INTO conv FROM public.dm_conversations
     WHERE user_a = least(me, them) AND user_b = greatest(me, them);
  END IF;
  RETURN jsonb_build_object(
    'status', coalesce(why, CASE WHEN conv IS NULL AND public.dm_mode(them) = 'requests' THEN 'request' ELSE 'ok' END),
    'conversation_id', conv
  );
END;
$$;

-- Send the first message to someone by username (or add to the existing
-- conversation with them). Returns {conversation_id, status}.
CREATE OR REPLACE FUNCTION public.dm_start(_username text, _body text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  them uuid;
  why text;
  conv public.dm_conversations;
BEGIN
  SELECT p.user_id INTO them FROM public.profiles p WHERE p.username = lower(btrim(_username));
  why := public.dm_refusal(me, them);
  IF why IS NOT NULL THEN RAISE EXCEPTION '%', why USING ERRCODE = '42501'; END IF;

  SELECT * INTO conv FROM public.dm_conversations WHERE user_a = least(me, them) AND user_b = greatest(me, them);
  IF conv.id IS NULL THEN
    IF public.dm_clean_body(_body) IS NULL THEN RAISE EXCEPTION 'empty' USING ERRCODE = '22023'; END IF;
    why := public.dm_check_rate(me, true);
    IF why IS NOT NULL THEN RAISE EXCEPTION '%', why USING ERRCODE = '54000'; END IF;
    INSERT INTO public.dm_conversations (user_a, user_b, requested_by, status, accepted_at)
    VALUES (least(me, them), greatest(me, them), me,
            CASE WHEN public.dm_mode(them) = 'everyone' THEN 'active' ELSE 'request' END,
            CASE WHEN public.dm_mode(them) = 'everyone' THEN now() END)
    ON CONFLICT (user_a, user_b) DO NOTHING;
    SELECT * INTO conv FROM public.dm_conversations WHERE user_a = least(me, them) AND user_b = greatest(me, them);
  END IF;
  PERFORM public.dm_insert_message(me, conv, _body);
  SELECT * INTO conv FROM public.dm_conversations WHERE id = conv.id;
  RETURN jsonb_build_object('conversation_id', conv.id, 'status', conv.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_send(_conversation_id uuid, _body text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  conv public.dm_conversations;
BEGIN
  SELECT * INTO conv FROM public.dm_conversations WHERE id = _conversation_id AND me IN (user_a, user_b);
  IF conv.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN public.dm_insert_message(me, conv, _body);
END;
$$;

-- The person a request was sent to accepts or declines it.
CREATE OR REPLACE FUNCTION public.dm_respond(_conversation_id uuid, _accept boolean)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  s text;
BEGIN
  UPDATE public.dm_conversations
     SET status = CASE WHEN _accept THEN 'active' ELSE 'declined' END,
         accepted_at = CASE WHEN _accept THEN now() ELSE NULL END
   WHERE id = _conversation_id AND me IN (user_a, user_b) AND requested_by <> me AND status <> 'active'
  RETURNING status INTO s;
  IF s IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN s;
END;
$$;

-- Inbox: newest first, with the other person, a preview and unread counts.
CREATE OR REPLACE FUNCTION public.dm_list_conversations()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'signed_out' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.last_message_at DESC)
      FROM (
        SELECT c.id, c.status, c.last_message_at, c.created_at,
               (c.requested_by = me) AS i_requested,
               p.username AS other_username, p.display_name AS other_display_name, p.avatar_url AS other_avatar_url,
               EXISTS (SELECT 1 FROM public.dm_blocks b WHERE b.blocker_id = me AND b.blocked_id = o.id) AS i_blocked,
               (SELECT CASE WHEN m.body IS NULL THEN NULL ELSE left(m.body, 140) END
                  FROM public.dm_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview,
               (SELECT m.sender_id = me FROM public.dm_messages m WHERE m.conversation_id = c.id
                 ORDER BY m.created_at DESC LIMIT 1) AS preview_is_mine,
               (SELECT count(*)::int FROM public.dm_messages m
                 WHERE m.conversation_id = c.id AND m.sender_id <> me AND m.removed_at IS NULL
                   AND m.created_at > coalesce(CASE WHEN c.user_a = me THEN c.a_last_read_at ELSE c.b_last_read_at END, '-infinity')) AS unread
          FROM public.dm_conversations c
          CROSS JOIN LATERAL (SELECT CASE WHEN c.user_a = me THEN c.user_b ELSE c.user_a END AS id) o
          LEFT JOIN public.profiles p ON p.user_id = o.id
         WHERE me IN (c.user_a, c.user_b)
           -- A request someone else declined, or one sent by someone I blocked, is hidden from me.
           AND NOT (c.status = 'declined' AND c.requested_by <> me)
           AND NOT (c.status = 'request' AND c.requested_by <> me
                    AND EXISTS (SELECT 1 FROM public.dm_blocks b WHERE b.blocker_id = me AND b.blocked_id = o.id))
         ORDER BY c.last_message_at DESC
         LIMIT 200
      ) x
  ), '[]'::jsonb);
END;
$$;

-- One conversation's messages, newest 100 before _before (oldest first in the
-- result), plus what the caller may do in it.
CREATE OR REPLACE FUNCTION public.dm_get_conversation(_conversation_id uuid, _before timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  c public.dm_conversations;
  them uuid;
BEGIN
  SELECT * INTO c FROM public.dm_conversations WHERE id = _conversation_id AND me IN (user_a, user_b);
  IF c.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  them := CASE WHEN c.user_a = me THEN c.user_b ELSE c.user_a END;
  RETURN jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'i_requested', c.requested_by = me,
    'other', (SELECT jsonb_build_object('username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url)
                FROM public.profiles p WHERE p.user_id = them),
    'i_blocked', EXISTS (SELECT 1 FROM public.dm_blocks b WHERE b.blocker_id = me AND b.blocked_id = them),
    'can_send', public.dm_refusal(me, them),
    'messages', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', m.id, 'mine', m.sender_id = me, 'body', m.body,
               'removed', m.removed_at IS NOT NULL, 'created_at', m.created_at) ORDER BY m.created_at)
        FROM (SELECT * FROM public.dm_messages
               WHERE conversation_id = c.id AND (_before IS NULL OR created_at < _before)
               ORDER BY created_at DESC LIMIT 100) m
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_mark_read(_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  UPDATE public.dm_conversations
     SET a_last_read_at = CASE WHEN user_a = me THEN now() ELSE a_last_read_at END,
         b_last_read_at = CASE WHEN user_b = me THEN now() ELSE b_last_read_at END
   WHERE id = _conversation_id AND me IN (user_a, user_b);
END;
$$;

-- Unread messages across the inbox, for dashboard badges and notifications.
CREATE OR REPLACE FUNCTION public.dm_unread_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum((x->>'unread')::int), 0)::int
    FROM jsonb_array_elements(CASE WHEN auth.uid() IS NULL THEN '[]'::jsonb ELSE public.dm_list_conversations() END) x
$$;

CREATE OR REPLACE FUNCTION public.dm_set_block(_username text, _blocked boolean)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  them uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'signed_out' USING ERRCODE = '42501'; END IF;
  SELECT p.user_id INTO them FROM public.profiles p WHERE p.username = lower(btrim(_username));
  IF them IS NULL OR them = me THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF _blocked THEN
    INSERT INTO public.dm_blocks (blocker_id, blocked_id) VALUES (me, them) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.dm_blocks WHERE blocker_id = me AND blocked_id = them;
  END IF;
  RETURN _blocked;
END;
$$;

CREATE OR REPLACE FUNCTION public.dm_list_blocks()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('username', p.username, 'display_name', p.display_name, 'created_at', b.created_at)
                            ORDER BY b.created_at DESC), '[]'::jsonb)
    FROM public.dm_blocks b JOIN public.profiles p ON p.user_id = b.blocked_id
   WHERE b.blocker_id = auth.uid()
$$;

-- Report a message the caller received. 'ok', 'rate_limited' or 'not_found'.
CREATE OR REPLACE FUNCTION public.dm_report_message(_message_id uuid, _reason text, _details text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  m public.dm_messages;
  d text := nullif(left(btrim(coalesce(_details, '')), 1000), '');
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'signed_out' USING ERRCODE = '42501'; END IF;
  SELECT msg.* INTO m FROM public.dm_messages msg
    JOIN public.dm_conversations c ON c.id = msg.conversation_id
   WHERE msg.id = _message_id AND me IN (c.user_a, c.user_b) AND msg.sender_id <> me;
  IF m.id IS NULL THEN RETURN 'not_found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('dm_report:' || me::text));
  IF EXISTS (SELECT 1 FROM public.abuse_reports WHERE reporter_user_id = me AND message_id = m.id) THEN
    RETURN 'ok';
  END IF;
  IF (SELECT count(*) FROM public.abuse_reports
       WHERE reporter_user_id = me AND created_at > now() - interval '1 hour') >= 10 THEN
    RETURN 'rate_limited';
  END IF;
  INSERT INTO public.abuse_reports
    (target_user_id, target_kind, message_id, message_excerpt, reason, details, reporter_user_id)
  VALUES (m.sender_id, 'message', m.id, m.body, _reason, d, me);
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.dm_my_settings() FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_set_mode(text, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_can_message(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_start(text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_send(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_respond(uuid, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_list_conversations() FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_get_conversation(uuid, timestamptz) FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_mark_read(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_unread_count() FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_set_block(text, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_list_blocks() FROM public, anon;
REVOKE ALL ON FUNCTION public.dm_report_message(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dm_my_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_set_mode(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_can_message(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_start(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_send(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_respond(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_list_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_get_conversation(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_mark_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_unread_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_set_block(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_list_blocks() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dm_report_message(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Owner console
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_messaging_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'enabled', (SELECT enabled FROM public.messaging_settings WHERE id),
    'people_with_messages_on', (SELECT count(*)::int FROM public.dm_settings WHERE mode <> 'off'),
    'conversations', (SELECT count(*)::int FROM public.dm_conversations),
    'messages_7d', (SELECT count(*)::int FROM public.dm_messages WHERE created_at > now() - interval '7 days'),
    'suspended', (SELECT count(*)::int FROM public.dm_suspensions),
    'open_message_reports', (SELECT count(*)::int FROM public.abuse_reports WHERE target_kind = 'message' AND status = 'open')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_messaging_enabled(_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  UPDATE public.messaging_settings SET enabled = _enabled, updated_at = now(), updated_by = auth.uid() WHERE id;
  PERFORM public.write_admin_audit(CASE WHEN _enabled THEN 'messaging.enabled' ELSE 'messaging.disabled' END,
                                   'setting', 'messaging', '{}'::jsonb);
  RETURN _enabled;
END;
$$;

-- Hide a message from both people. The text is kept for the owner only.
CREATE OR REPLACE FUNCTION public.owner_remove_message(_message_id uuid, _reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
  m public.dm_messages;
BEGIN
  PERFORM public.owner_require_admin();
  r := CASE WHEN nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN NULL ELSE public.owner_clean_reason(_reason) END;
  SELECT * INTO m FROM public.dm_messages WHERE id = _message_id FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'No message with that id.' USING ERRCODE = 'P0002'; END IF;
  IF m.removed_at IS NOT NULL THEN RETURN true; END IF;
  INSERT INTO public.dm_removed_messages (message_id, body) VALUES (m.id, m.body);
  UPDATE public.dm_messages
     SET body = NULL, removed_at = now(), removed_by = auth.uid(), removed_reason = r
   WHERE id = m.id;
  PERFORM public.write_admin_audit('message.removed', 'message', m.id::text,
                                   jsonb_build_object('sender_user_id', m.sender_id, 'reason', r));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_messaging_suspended(_user_id uuid, _suspended boolean, _reason text DEFAULT NULL)
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
  PERFORM public.owner_assert_user_exists(_user_id);
  r := CASE WHEN nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN NULL ELSE public.owner_clean_reason(_reason) END;
  IF _suspended THEN
    INSERT INTO public.dm_suspensions (user_id, reason, suspended_by) VALUES (_user_id, r, auth.uid())
    ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, suspended_by = EXCLUDED.suspended_by, created_at = now();
  ELSE
    DELETE FROM public.dm_suspensions WHERE user_id = _user_id;
  END IF;
  PERFORM public.write_admin_audit(CASE WHEN _suspended THEN 'messaging.suspended' ELSE 'messaging.unsuspended' END,
                                   'user', _user_id::text, jsonb_build_object('reason', r));
  RETURN _suspended;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_user_messaging(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'mode', public.dm_mode(_user_id),
    'suspended', EXISTS (SELECT 1 FROM public.dm_suspensions WHERE user_id = _user_id),
    'suspended_reason', (SELECT reason FROM public.dm_suspensions WHERE user_id = _user_id),
    'messages_sent_7d', (SELECT count(*)::int FROM public.dm_messages WHERE sender_id = _user_id AND created_at > now() - interval '7 days'),
    'reports_about', (SELECT count(*)::int FROM public.abuse_reports WHERE target_kind = 'message' AND target_user_id = _user_id)
  );
END;
$$;

-- Same as before, plus the message columns.
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
               r.resolution_note, r.resolved_at,
               r.message_id, r.message_excerpt,
               (m.removed_at IS NOT NULL) AS message_removed,
               EXISTS (SELECT 1 FROM public.dm_suspensions s WHERE s.user_id = r.target_user_id) AS target_messaging_suspended
          FROM public.abuse_reports r
          LEFT JOIN public.profiles p ON p.user_id = r.target_user_id
          LEFT JOIN public.profiles rp ON rp.user_id = r.reporter_user_id
          LEFT JOIN public.wishlists w ON w.id = r.wishlist_id
          LEFT JOIN public.dm_messages m ON m.id = r.message_id
         WHERE _status = 'all' OR r.status = _status
         ORDER BY r.created_at DESC
         LIMIT 200
      ) x
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_messaging_status() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_messaging_enabled(boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_remove_message(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_messaging_suspended(uuid, boolean, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_user_messaging(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_messaging_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_messaging_enabled(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_remove_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_messaging_suspended(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_user_messaging(uuid) TO authenticated;
