-- Marketing Center (Owner Console > Marketing): campaigns, posts with an
-- approval workflow, a publishing calendar, social account records, post
-- history, and campaign attribution.
--
-- Additive only: new tables, functions and two cron jobs. No existing table,
-- column, policy, function or row is changed.
--
-- Nothing here posts to a social network. A post reaches "published" only
-- with the live post's address and a verification method (checked by the
-- platform's oEmbed endpoint, an official API read, or the owner's own
-- confirmation, recorded as such).
--
-- Rollback: supabase/rollbacks/20261123010000_marketing_center.down.sql

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
CREATE TABLE public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  -- Used as utm_campaign in every link the campaign's posts carry.
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,49}$'),
  goal text CHECK (goal IS NULL OR char_length(goal) <= 500),
  audiences text[] NOT NULL DEFAULT '{}',
  season text CHECK (season IS NULL OR char_length(season) <= 40),
  starts_on date,
  ends_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done', 'archived')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaigns_window CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_campaigns FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------
CREATE TABLE public.marketing_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.marketing_campaigns (id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'x', 'facebook', 'youtube', 'snapchat')),
  format text NOT NULL CHECK (format IN ('post', 'carousel', 'reel', 'story', 'short', 'video', 'thread')),
  kind text NOT NULL DEFAULT 'announcement'
    CHECK (kind IN ('tutorial', 'demo', 'announcement', 'invite', 'tip', 'community', 'seasonal')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 5000),
  hashtags text[] NOT NULL DEFAULT '{}',
  script text CHECK (script IS NULL OR char_length(script) <= 6000),
  -- The graphic template and its words (rendered in the browser).
  graphic jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Keys of the live features the post talks about (src/lib/marketing/features.ts).
  features text[] NOT NULL DEFAULT '{}',
  -- Where the campaign link lands on yooits.me.
  landing_path text NOT NULL DEFAULT '/' CHECK (
    char_length(landing_path) <= 200 AND (landing_path = '/' OR landing_path ~ '^/[A-Za-z0-9/_-]*$')),
  -- Short code put in utm_content so a sign-up can be tied to this post.
  code text NOT NULL UNIQUE DEFAULT substr(md5(gen_random_uuid()::text), 1, 8)
    CHECK (code ~ '^[a-z0-9]{4,16}$'),
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'archived')),
  publish_method text NOT NULL DEFAULT 'manual' CHECK (publish_method IN ('manual', 'api')),
  approved_at timestamptz,
  approved_by uuid,
  publishing_started_at timestamptz,
  published_at timestamptz,
  external_id text CHECK (external_id IS NULL OR char_length(external_id) <= 200),
  external_url text CHECK (external_url IS NULL OR (char_length(external_url) <= 500 AND external_url ~ '^https://')),
  verified_at timestamptz,
  verification text CHECK (verification IS NULL OR verification IN ('oembed', 'api', 'owner_confirmed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 1000),
  -- Same words on the same platform twice is a duplicate.
  content_hash text GENERATED ALWAYS AS (
    md5(platform || ':' || lower(regexp_replace(btrim(caption), '\s+', ' ', 'g')))) STORED,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_posts_scheduled_has_time CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CONSTRAINT marketing_posts_published_is_verified CHECK (
    status <> 'published' OR (external_url IS NOT NULL AND verified_at IS NOT NULL AND verification IS NOT NULL)),
  CONSTRAINT marketing_posts_approved_has_approver CHECK (
    status NOT IN ('approved', 'scheduled', 'publishing', 'published') OR approved_at IS NOT NULL)
);
CREATE UNIQUE INDEX idx_marketing_posts_no_duplicates ON public.marketing_posts (content_hash)
  WHERE status <> 'archived' AND caption <> '';
CREATE UNIQUE INDEX idx_marketing_posts_one_live_url ON public.marketing_posts (external_url)
  WHERE external_url IS NOT NULL;
CREATE INDEX idx_marketing_posts_schedule ON public.marketing_posts (scheduled_at);
CREATE INDEX idx_marketing_posts_status ON public.marketing_posts (status);
CREATE INDEX idx_marketing_posts_campaign ON public.marketing_posts (campaign_id);
ALTER TABLE public.marketing_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_posts FROM anon, authenticated;

-- Every change to a post, oldest first.
CREATE TABLE public.marketing_post_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES public.marketing_posts (id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL CHECK (event ~ '^[a-z][a-z_]{0,39}$'),
  from_status text,
  to_status text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor uuid
);
CREATE INDEX idx_marketing_post_events_post ON public.marketing_post_events (post_id, at);
ALTER TABLE public.marketing_post_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_post_events FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Social accounts (one row per platform). Tokens never live here: an API
-- connection keeps its tokens in marketing_account_tokens, which only the
-- server (service role) can read.
-- ---------------------------------------------------------------------------
CREATE TABLE public.marketing_accounts (
  platform text PRIMARY KEY CHECK (platform IN ('instagram', 'tiktok', 'x', 'facebook', 'youtube', 'snapchat')),
  handle text CHECK (handle IS NULL OR (char_length(handle) <= 60 AND handle ~ '^[A-Za-z0-9._-]+$')),
  profile_url text CHECK (profile_url IS NULL OR (char_length(profile_url) <= 300 AND profile_url ~ '^https://')),
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'api')),
  connection_status text NOT NULL DEFAULT 'not_connected'
    CHECK (connection_status IN ('not_connected', 'connected', 'needs_attention')),
  connected_at timestamptz,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marketing_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_accounts FROM anon, authenticated;
INSERT INTO public.marketing_accounts (platform) VALUES
  ('instagram'), ('tiktok'), ('x'), ('facebook'), ('youtube'), ('snapchat')
ON CONFLICT (platform) DO NOTHING;

CREATE TABLE public.marketing_account_tokens (
  platform text PRIMARY KEY REFERENCES public.marketing_accounts (platform) ON DELETE CASCADE,
  -- Encrypted by the server before it is stored; never sent to a browser.
  sealed text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marketing_account_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_account_tokens FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketing_log(
  _post uuid, _event text, _from text, _to text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.marketing_post_events (post_id, event, from_status, to_status, detail, actor)
  VALUES (_post, _event, _from, _to, coalesce(_detail, '{}'::jsonb), auth.uid())
$$;
REVOKE ALL ON FUNCTION public.marketing_log(uuid, text, text, text, jsonb) FROM public, anon, authenticated;

-- Does this address belong to the platform? (host check, no path rules)
CREATE OR REPLACE FUNCTION public.marketing_url_matches(_platform text, _url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _platform
    WHEN 'instagram' THEN _url ~* '^https://(www\.)?instagram\.com/'
    WHEN 'tiktok' THEN _url ~* '^https://(www\.|vm\.|vt\.)?tiktok\.com/'
    WHEN 'x' THEN _url ~* '^https://(www\.|mobile\.)?(x|twitter)\.com/'
    WHEN 'facebook' THEN _url ~* '^https://(www\.|m\.|web\.)?(facebook\.com|fb\.watch)/'
    WHEN 'youtube' THEN _url ~* '^https://((www|m)\.)?(youtube\.com|youtu\.be)/'
    WHEN 'snapchat' THEN _url ~* '^https://(www\.|story\.)?snapchat\.com/'
    ELSE false
  END AND _url !~ '[[:space:][:cntrl:]]'
$$;

-- One post as the console shows it.
CREATE OR REPLACE FUNCTION public.marketing_post_json(p public.marketing_posts)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_jsonb(p) - 'content_hash' - 'created_by' - 'approved_by'
$$;
REVOKE ALL ON FUNCTION public.marketing_post_json(public.marketing_posts) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the Marketing Center reads, in one call
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_marketing_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'campaigns', coalesce((
      SELECT jsonb_agg(to_jsonb(c) - 'created_by' ORDER BY c.starts_on NULLS LAST, c.created_at)
        FROM public.marketing_campaigns c WHERE c.status <> 'archived'), '[]'::jsonb),
    'posts', coalesce((
      SELECT jsonb_agg(public.marketing_post_json(p) ORDER BY p.scheduled_at NULLS LAST, p.created_at)
        FROM public.marketing_posts p
       WHERE p.status <> 'archived' OR p.updated_at > now() - interval '30 days'), '[]'::jsonb),
    'accounts', coalesce((
      SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object(
               'has_token', EXISTS (SELECT 1 FROM public.marketing_account_tokens t WHERE t.platform = a.platform))
             ORDER BY a.platform)
        FROM public.marketing_accounts a), '[]'::jsonb),
    'counts', coalesce((
      SELECT jsonb_object_agg(status, n) FROM (
        SELECT status, count(*)::int AS n FROM public.marketing_posts GROUP BY status) s), '{}'::jsonb),
    'now', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.owner_marketing_state() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_marketing_state() TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_marketing_post_history(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('at', e.at, 'event', e.event, 'from', e.from_status,
                                        'to', e.to_status, 'detail', e.detail) ORDER BY e.at, e.id)
      FROM public.marketing_post_events e WHERE e.post_id = _id), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_marketing_post_history(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_marketing_post_history(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_marketing_save_campaign(_c jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cid uuid := nullif(_c->>'id', '')::uuid;
  aud text[] := coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(_c->'audiences', '[]'::jsonb))), '{}');
BEGIN
  PERFORM public.owner_require_admin();
  IF cid IS NULL THEN
    INSERT INTO public.marketing_campaigns (name, slug, goal, audiences, season, starts_on, ends_on, status, created_by)
    VALUES (btrim(_c->>'name'), lower(btrim(_c->>'slug')), nullif(btrim(coalesce(_c->>'goal', '')), ''), aud,
            nullif(btrim(coalesce(_c->>'season', '')), ''), nullif(_c->>'starts_on', '')::date,
            nullif(_c->>'ends_on', '')::date, coalesce(nullif(_c->>'status', ''), 'active'), auth.uid())
    ON CONFLICT (slug) DO UPDATE SET updated_at = now()
    RETURNING id INTO cid;
    PERFORM public.write_admin_audit('marketing.campaign_saved', 'marketing_campaign', cid::text,
      jsonb_build_object('slug', lower(btrim(_c->>'slug'))));
  ELSE
    UPDATE public.marketing_campaigns SET
      name = coalesce(nullif(btrim(_c->>'name'), ''), name),
      goal = CASE WHEN _c ? 'goal' THEN nullif(btrim(coalesce(_c->>'goal', '')), '') ELSE goal END,
      audiences = CASE WHEN _c ? 'audiences' THEN aud ELSE audiences END,
      season = CASE WHEN _c ? 'season' THEN nullif(btrim(coalesce(_c->>'season', '')), '') ELSE season END,
      starts_on = CASE WHEN _c ? 'starts_on' THEN nullif(_c->>'starts_on', '')::date ELSE starts_on END,
      ends_on = CASE WHEN _c ? 'ends_on' THEN nullif(_c->>'ends_on', '')::date ELSE ends_on END,
      status = coalesce(nullif(_c->>'status', ''), status),
      updated_at = now()
    WHERE id = cid;
    IF NOT FOUND THEN RAISE EXCEPTION 'No campaign with that id.' USING ERRCODE = 'P0002'; END IF;
    PERFORM public.write_admin_audit('marketing.campaign_updated', 'marketing_campaign', cid::text, '{}'::jsonb);
  END IF;
  RETURN cid;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_marketing_save_campaign(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_marketing_save_campaign(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Posts: add drafts (from the generator). Duplicates are skipped, not errors.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_marketing_add_posts(_campaign uuid, _posts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  pid uuid;
  added int := 0;
  skipped int := 0;
BEGIN
  PERFORM public.owner_require_admin();
  IF jsonb_typeof(_posts) <> 'array' OR jsonb_array_length(_posts) > 400 THEN
    RAISE EXCEPTION 'Send between 1 and 400 posts.' USING ERRCODE = '22023';
  END IF;
  IF _campaign IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.marketing_campaigns WHERE id = _campaign) THEN
    RAISE EXCEPTION 'No campaign with that id.' USING ERRCODE = 'P0002';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(_posts) LOOP
    INSERT INTO public.marketing_posts (campaign_id, platform, format, kind, title, caption, hashtags, script,
                                        graphic, features, landing_path, scheduled_at, created_by)
    VALUES (_campaign, item->>'platform', item->>'format', coalesce(item->>'kind', 'announcement'),
            left(btrim(item->>'title'), 120), coalesce(item->>'caption', ''),
            coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'hashtags', '[]'::jsonb))), '{}'),
            nullif(item->>'script', ''), coalesce(item->'graphic', '{}'::jsonb),
            coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'features', '[]'::jsonb))), '{}'),
            coalesce(nullif(item->>'landing_path', ''), '/'), nullif(item->>'scheduled_at', '')::timestamptz,
            auth.uid())
    ON CONFLICT DO NOTHING
    RETURNING id INTO pid;
    IF pid IS NULL THEN
      skipped := skipped + 1;
    ELSE
      added := added + 1;
      PERFORM public.marketing_log(pid, 'created', NULL, 'draft', jsonb_build_object('source', coalesce(item->>'source', 'generator')));
    END IF;
    pid := NULL;
  END LOOP;
  IF added > 0 THEN
    PERFORM public.write_admin_audit('marketing.posts_added', 'marketing_campaign', coalesce(_campaign::text, ''),
      jsonb_build_object('added', added, 'skipped_duplicates', skipped));
  END IF;
  RETURN jsonb_build_object('added', added, 'skipped_duplicates', skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_marketing_add_posts(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_marketing_add_posts(uuid, jsonb) TO authenticated;

-- Edit a post. Changing the words of an approved or scheduled post sends it
-- back to draft, because the approval was for the old words. Moving the time
-- keeps the approval.
CREATE OR REPLACE FUNCTION public.owner_marketing_update_post(_id uuid, _patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.marketing_posts;
  words_changed boolean;
  new_status text;
  old_status text;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT * INTO p FROM public.marketing_posts WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No post with that id.' USING ERRCODE = 'P0002'; END IF;
  IF p.status IN ('publishing', 'published') THEN
    RAISE EXCEPTION 'This post is being published or is live, so it can''t be edited.' USING ERRCODE = '55000';
  END IF;
  old_status := p.status;
  words_changed := (_patch ? 'caption' AND _patch->>'caption' IS DISTINCT FROM p.caption)
    OR (_patch ? 'hashtags' AND _patch->'hashtags' IS DISTINCT FROM to_jsonb(p.hashtags))
    OR (_patch ? 'script' AND nullif(_patch->>'script', '') IS DISTINCT FROM p.script)
    OR (_patch ? 'graphic' AND _patch->'graphic' IS DISTINCT FROM p.graphic)
    OR (_patch ? 'landing_path' AND _patch->>'landing_path' IS DISTINCT FROM p.landing_path);
  new_status := CASE WHEN words_changed AND p.status IN ('approved', 'scheduled') THEN 'draft' ELSE p.status END;

  UPDATE public.marketing_posts SET
    title = CASE WHEN _patch ? 'title' THEN left(btrim(_patch->>'title'), 120) ELSE title END,
    caption = CASE WHEN _patch ? 'caption' THEN coalesce(_patch->>'caption', '') ELSE caption END,
    hashtags = CASE WHEN _patch ? 'hashtags'
                    THEN coalesce(ARRAY(SELECT jsonb_array_elements_text(_patch->'hashtags')), '{}') ELSE hashtags END,
    script = CASE WHEN _patch ? 'script' THEN nullif(_patch->>'script', '') ELSE script END,
    graphic = CASE WHEN _patch ? 'graphic' THEN coalesce(_patch->'graphic', '{}'::jsonb) ELSE graphic END,
    landing_path = CASE WHEN _patch ? 'landing_path' THEN coalesce(nullif(_patch->>'landing_path', ''), '/') ELSE landing_path END,
    format = CASE WHEN _patch ? 'format' THEN _patch->>'format' ELSE format END,
    scheduled_at = CASE WHEN _patch ? 'scheduled_at' THEN nullif(_patch->>'scheduled_at', '')::timestamptz ELSE scheduled_at END,
    status = CASE WHEN new_status = 'scheduled' AND _patch ? 'scheduled_at' AND nullif(_patch->>'scheduled_at', '') IS NULL
                  THEN 'approved' ELSE new_status END,
    approved_at = CASE WHEN new_status = 'draft' THEN NULL ELSE approved_at END,
    approved_by = CASE WHEN new_status = 'draft' THEN NULL ELSE approved_by END,
    updated_at = now()
  WHERE id = _id
  RETURNING * INTO p;

  PERFORM public.marketing_log(_id, CASE WHEN words_changed THEN 'edited' WHEN _patch ? 'scheduled_at' THEN 'rescheduled' ELSE 'updated' END,
    old_status, p.status,
    jsonb_build_object('fields', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(_patch) k),
                       'approval_cleared', words_changed AND new_status = 'draft'));
  RETURN public.marketing_post_json(p);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Another post on this platform already has these exact words.' USING ERRCODE = '23505';
END;
$$;
REVOKE ALL ON FUNCTION public.owner_marketing_update_post(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_marketing_update_post(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Status changes. Allowed moves:
--   draft -> approved | archived
--   approved -> draft | scheduled | archived
--   scheduled -> approved | publishing | archived
--   publishing -> failed  (published only through owner_marketing_mark_published)
--   failed -> scheduled (retry, counts an attempt) | draft | archived
--   archived -> draft
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_marketing_set_status(_ids uuid[], _to text, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.marketing_posts;
  ok int := 0;
  refused jsonb := '[]'::jsonb;
  allowed boolean;
  why text;
BEGIN
  PERFORM public.owner_require_admin();
  IF _to NOT IN ('draft', 'approved', 'scheduled', 'publishing', 'failed', 'archived') THEN
    RAISE EXCEPTION 'Unknown status.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(array_length(_ids, 1), 0) = 0 OR array_length(_ids, 1) > 400 THEN
    RAISE EXCEPTION 'Pick between 1 and 400 posts.' USING ERRCODE = '22023';
  END IF;
  FOR p IN SELECT * FROM public.marketing_posts WHERE id = ANY(_ids) ORDER BY scheduled_at NULLS LAST FOR UPDATE LOOP
    why := NULL;
    allowed := CASE p.status
      WHEN 'draft' THEN _to IN ('approved', 'archived')
      WHEN 'approved' THEN _to IN ('draft', 'scheduled', 'archived')
      WHEN 'scheduled' THEN _to IN ('approved', 'publishing', 'archived')
      WHEN 'publishing' THEN _to IN ('failed')
      WHEN 'failed' THEN _to IN ('scheduled', 'draft', 'archived')
      WHEN 'archived' THEN _to IN ('draft')
      ELSE false END;
    IF NOT allowed THEN
      why := 'can''t go from ' || p.status || ' to ' || _to;
    ELSIF _to = 'approved' AND btrim(p.caption) = '' THEN
      why := 'has no caption';
    ELSIF _to = 'scheduled' AND p.scheduled_at IS NULL THEN
      why := 'has no date and time';
    END IF;
    IF why IS NOT NULL THEN
      refused := refused || jsonb_build_object('id', p.id, 'title', p.title, 'reason', why);
      CONTINUE;
    END IF;
    UPDATE public.marketing_posts SET
      status = _to,
      approved_at = CASE WHEN _to = 'approved' AND p.status = 'draft' THEN now()
                         WHEN _to IN ('draft', 'archived') THEN NULL ELSE approved_at END,
      approved_by = CASE WHEN _to = 'approved' AND p.status = 'draft' THEN auth.uid()
                         WHEN _to IN ('draft', 'archived') THEN NULL ELSE approved_by END,
      publishing_started_at = CASE WHEN _to = 'publishing' THEN now() ELSE publishing_started_at END,
      attempts = CASE WHEN _to = 'scheduled' AND p.status = 'failed' THEN attempts + 1 ELSE attempts END,
      last_error = CASE WHEN _to = 'failed' THEN left(coalesce(_note, 'Marked failed by the owner.'), 1000)
                        WHEN _to IN ('scheduled', 'draft') THEN NULL ELSE last_error END,
      scheduled_at = CASE WHEN _to = 'scheduled' AND p.status = 'failed' AND p.scheduled_at < now()
                          THEN now() ELSE scheduled_at END,
      updated_at = now()
    WHERE id = p.id;
    PERFORM public.marketing_log(p.id,
      CASE WHEN _to = 'scheduled' AND p.status = 'failed' THEN 'retried' ELSE 'status_' || _to END,
      p.status, _to, CASE WHEN _note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('note', left(_note, 500)) END);
    ok := ok + 1;
  END LOOP;
  IF ok > 0 THEN
    PERFORM public.write_admin_audit('marketing.posts_' || _to, 'marketing_post', array_to_string(_ids[1:5], ','),
      jsonb_build_object('count', ok));
  END IF;
  RETURN jsonb_build_object('changed', ok, 'refused', refused);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_marketing_set_status(uuid[], text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_marketing_set_status(uuid[], text, text) TO authenticated;

-- A post is live: record its address and how that was verified. Only the
-- server calls this (service role), after it has checked the address with
-- the platform (oEmbed or an API read) or, where no public check exists, on
-- the owner's own confirmation through owner_marketing_confirm_published.
CREATE OR REPLACE FUNCTION public.marketing_record_published(
  _id uuid, _url text, _external_id text, _verification text, _detail jsonb, _actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.marketing_posts;
  clean_url text := btrim(coalesce(_url, ''));
  old_status text;
BEGIN
  IF _actor IS NULL OR NOT public.has_role(_actor, 'admin') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF _verification NOT IN ('oembed', 'api', 'owner_confirmed') THEN
    RAISE EXCEPTION 'Unknown verification.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.marketing_posts WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No post with that id.' USING ERRCODE = 'P0002'; END IF;
  IF p.status = 'published' THEN
    RAISE EXCEPTION 'This post is already marked live.' USING ERRCODE = '55000';
  END IF;
  IF p.status NOT IN ('approved', 'scheduled', 'publishing', 'failed') THEN
    RAISE EXCEPTION 'Approve the post before marking it live.' USING ERRCODE = '55000';
  END IF;
  old_status := p.status;
  IF NOT public.marketing_url_matches(p.platform, clean_url) THEN
    RAISE EXCEPTION 'That address isn''t a % post address.', p.platform USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.marketing_posts WHERE external_url = clean_url AND id <> _id) THEN
    RAISE EXCEPTION 'Another post is already recorded at that address.' USING ERRCODE = '23505';
  END IF;
  UPDATE public.marketing_posts SET
    status = 'published',
    external_url = clean_url,
    external_id = nullif(left(btrim(coalesce(_external_id, '')), 200), ''),
    verification = _verification,
    verified_at = now(),
    published_at = coalesce(published_at, now()),
    publishing_started_at = coalesce(publishing_started_at, now()),
    last_error = NULL,
    updated_at = now()
  WHERE id = _id
  RETURNING * INTO p;
  INSERT INTO public.marketing_post_events (post_id, event, from_status, to_status, detail, actor)
  VALUES (_id, 'published', old_status, 'published',
    jsonb_build_object('url', clean_url, 'verification', _verification) || coalesce(_detail, '{}'::jsonb), _actor);
  INSERT INTO public.admin_audit_log (actor_user_id, action, target_type, target_id, details)
  VALUES (_actor, 'marketing.post_published', 'marketing_post', _id::text,
    jsonb_build_object('platform', p.platform, 'verification', _verification));
  RETURN public.marketing_post_json(p);
END;
$$;
REVOKE ALL ON FUNCTION public.marketing_record_published(uuid, text, text, text, jsonb, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_record_published(uuid, text, text, text, jsonb, uuid) TO service_role;

-- The owner says a post is live where the platform offers no public check
-- (Instagram, Facebook, Snapchat without an API connection). Recorded as
-- "owner_confirmed", never as verified by the platform.
CREATE OR REPLACE FUNCTION public.owner_marketing_confirm_published(_id uuid, _url text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN public.marketing_record_published(_id, _url, NULL, 'owner_confirmed', '{}'::jsonb, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.owner_marketing_confirm_published(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_marketing_confirm_published(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_marketing_save_account(_platform text, _handle text, _profile_url text, _notes text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  UPDATE public.marketing_accounts SET
    handle = nullif(regexp_replace(btrim(coalesce(_handle, '')), '^@', ''), ''),
    profile_url = nullif(btrim(coalesce(_profile_url, '')), ''),
    notes = nullif(btrim(coalesce(_notes, '')), ''),
    updated_at = now()
  WHERE platform = _platform;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown platform.' USING ERRCODE = '22023'; END IF;
  IF nullif(btrim(coalesce(_profile_url, '')), '') IS NOT NULL
     AND NOT public.marketing_url_matches(_platform, btrim(_profile_url)) THEN
    RAISE EXCEPTION 'That profile address isn''t on %.', _platform USING ERRCODE = '22023';
  END IF;
  PERFORM public.write_admin_audit('marketing.account_saved', 'marketing_account', _platform, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.owner_marketing_save_account(text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_marketing_save_account(text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Performance: what campaign links brought in.
--   visits: home and profile views whose utm_campaign is a campaign slug
--   signup clicks: "Claim your link" taps from those visits
--   signups: accounts whose sign-up carried that campaign (mkt_campaign in
--            the sign-up metadata, set from the first campaign link seen)
--   profile completions: those accounts that earned profile_complete
--   paid: those accounts with a live paid Plus subscription
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_marketing_performance(_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d integer := CASE WHEN _days IN (7, 14, 30, 90) THEN _days ELSE 30 END;
  since timestamptz := date_trunc('day', now()) - make_interval(days => d - 1);
  has_plus boolean := to_regclass('public.plus_subscriptions') IS NOT NULL;
  result jsonb;
BEGIN
  PERFORM public.owner_require_admin();

  CREATE TEMP TABLE IF NOT EXISTS _mkt_signups (user_id uuid, campaign text, source text, content text,
    ref text, created_at timestamptz, completed boolean, paid boolean) ON COMMIT DROP;
  TRUNCATE _mkt_signups;
  INSERT INTO _mkt_signups
  SELECT u.id,
         nullif(lower(left(u.raw_user_meta_data->>'mkt_campaign', 100)), ''),
         nullif(lower(left(u.raw_user_meta_data->>'mkt_source', 100)), ''),
         nullif(lower(left(u.raw_user_meta_data->>'mkt_content', 100)), ''),
         nullif(lower(left(u.raw_user_meta_data->>'mkt_ref', 100)), ''),
         u.created_at,
         EXISTS (SELECT 1 FROM public.user_rewards r WHERE r.user_id = u.id AND r.reward_key = 'profile_complete'),
         false
    FROM auth.users u WHERE u.created_at >= since;
  IF has_plus THEN
    EXECUTE $q$UPDATE _mkt_signups s SET paid = EXISTS (
               SELECT 1 FROM public.plus_subscriptions ps WHERE ps.user_id = s.user_id AND ps.livemode
                  AND ps.status IN ('active', 'trialing', 'past_due'))$q$;
  END IF;

  SELECT jsonb_build_object(
    'days', d,
    'since', since,
    'totals', (
      SELECT jsonb_build_object(
        'signups', count(*),
        'attributed_signups', count(*) FILTER (WHERE campaign IS NOT NULL),
        'referred_signups', count(*) FILTER (WHERE ref IS NOT NULL),
        'profile_completions', count(*) FILTER (WHERE completed),
        'paid', count(*) FILTER (WHERE paid))
        FROM _mkt_signups),
    'campaign_visits', (
      SELECT count(*) FROM public.analytics_events e
       WHERE e.occurred_at >= since AND e.kind IN ('home_view', 'profile_view')
         AND e.utm_campaign IN (SELECT slug FROM public.marketing_campaigns)),
    'campaigns', coalesce((
      SELECT jsonb_agg(x ORDER BY x.signups DESC, x.visits DESC) FROM (
        SELECT c.id, c.name, c.slug,
               (SELECT count(*) FROM public.analytics_events e WHERE e.occurred_at >= since
                   AND e.kind IN ('home_view', 'profile_view') AND e.utm_campaign = c.slug)::int AS visits,
               (SELECT count(*) FROM public.analytics_events e WHERE e.occurred_at >= since
                   AND e.kind = 'signup_cta' AND e.utm_campaign = c.slug)::int AS signup_clicks,
               (SELECT count(*) FROM _mkt_signups s WHERE s.campaign = c.slug)::int AS signups,
               (SELECT count(*) FROM _mkt_signups s WHERE s.campaign = c.slug AND s.completed)::int AS completions,
               (SELECT count(*) FROM _mkt_signups s WHERE s.campaign = c.slug AND s.paid)::int AS paid,
               (SELECT count(*) FROM public.marketing_posts p WHERE p.campaign_id = c.id AND p.status = 'published')::int AS published
          FROM public.marketing_campaigns c WHERE c.status <> 'archived') x), '[]'::jsonb),
    'platforms', coalesce((
      SELECT jsonb_agg(x ORDER BY x.signups DESC, x.visits DESC) FROM (
        SELECT pl.platform,
               (SELECT count(*) FROM public.analytics_events e WHERE e.occurred_at >= since
                   AND e.kind IN ('home_view', 'profile_view')
                   AND (lower(e.utm_source) = pl.platform OR (e.utm_source IS NULL AND e.source = pl.platform)))::int AS visits,
               (SELECT count(*) FROM _mkt_signups s WHERE s.source = pl.platform)::int AS signups,
               (SELECT count(*) FROM _mkt_signups s WHERE s.source = pl.platform AND s.completed)::int AS completions,
               (SELECT count(*) FROM _mkt_signups s WHERE s.source = pl.platform AND s.paid)::int AS paid,
               (SELECT count(*) FROM public.marketing_posts p WHERE p.platform = pl.platform AND p.status = 'published')::int AS published
          FROM (VALUES ('instagram'), ('tiktok'), ('x'), ('facebook'), ('youtube'), ('snapchat')) pl(platform)) x), '[]'::jsonb),
    'posts', coalesce((
      SELECT jsonb_agg(x ORDER BY x.signups DESC, x.published_at DESC NULLS LAST) FROM (
        SELECT p.id, p.title, p.platform, p.code, p.published_at, p.external_url,
               (SELECT count(*) FROM _mkt_signups s WHERE s.content = p.code)::int AS signups,
               (SELECT count(*) FROM _mkt_signups s WHERE s.content = p.code AND s.completed)::int AS completions,
               (SELECT count(*) FROM _mkt_signups s WHERE s.content = p.code AND s.paid)::int AS paid
          FROM public.marketing_posts p
         WHERE p.status = 'published' AND p.published_at >= since
         LIMIT 100) x), '[]'::jsonb),
    'referrers', coalesce((
      SELECT jsonb_agg(x ORDER BY x.signups DESC) FROM (
        SELECT ref AS username, count(*)::int AS signups FROM _mkt_signups
         WHERE ref IS NOT NULL GROUP BY ref ORDER BY count(*) DESC LIMIT 10) x), '[]'::jsonb),
    'analytics_enabled', public.analytics_is_enabled()
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.owner_marketing_performance(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_marketing_performance(integer) TO authenticated;

-- Last 7 days against the 7 before, for the weekly summary.
CREATE OR REPLACE FUNCTION public.owner_marketing_weekly()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  this_start timestamptz := now() - interval '7 days';
  last_start timestamptz := now() - interval '14 days';
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'generated_at', now(),
    'week', jsonb_build_object('from', this_start, 'to', now()),
    'this', jsonb_build_object(
      'published', (SELECT count(*) FROM public.marketing_posts WHERE published_at >= this_start),
      'failed', (SELECT count(*) FROM public.marketing_post_events WHERE to_status = 'failed' AND at >= this_start),
      'campaign_visits', (SELECT count(*) FROM public.analytics_events e WHERE e.occurred_at >= this_start
                            AND e.kind IN ('home_view', 'profile_view') AND e.utm_campaign IS NOT NULL),
      'home_views', (SELECT count(*) FROM public.analytics_events WHERE occurred_at >= this_start AND kind = 'home_view'),
      'signup_clicks', (SELECT count(*) FROM public.analytics_events WHERE occurred_at >= this_start AND kind = 'signup_cta'),
      'signups', (SELECT count(*) FROM auth.users WHERE created_at >= this_start),
      'attributed_signups', (SELECT count(*) FROM auth.users WHERE created_at >= this_start
                               AND nullif(raw_user_meta_data->>'mkt_campaign', '') IS NOT NULL),
      'profile_completions', (SELECT count(*) FROM public.user_rewards WHERE reward_key = 'profile_complete'
                                AND unlocked_at >= this_start)),
    'last', jsonb_build_object(
      'published', (SELECT count(*) FROM public.marketing_posts WHERE published_at >= last_start AND published_at < this_start),
      'campaign_visits', (SELECT count(*) FROM public.analytics_events e WHERE e.occurred_at >= last_start
                            AND e.occurred_at < this_start
                            AND e.kind IN ('home_view', 'profile_view') AND e.utm_campaign IS NOT NULL),
      'home_views', (SELECT count(*) FROM public.analytics_events WHERE occurred_at >= last_start
                       AND occurred_at < this_start AND kind = 'home_view'),
      'signup_clicks', (SELECT count(*) FROM public.analytics_events WHERE occurred_at >= last_start
                          AND occurred_at < this_start AND kind = 'signup_cta'),
      'signups', (SELECT count(*) FROM auth.users WHERE created_at >= last_start AND created_at < this_start),
      'attributed_signups', (SELECT count(*) FROM auth.users WHERE created_at >= last_start AND created_at < this_start
                               AND nullif(raw_user_meta_data->>'mkt_campaign', '') IS NOT NULL)),
    'sources', coalesce((
      SELECT jsonb_agg(x ORDER BY x.visits DESC) FROM (
        SELECT coalesce(lower(utm_source), source) AS source, count(*)::int AS visits
          FROM public.analytics_events WHERE occurred_at >= this_start AND kind IN ('home_view', 'profile_view')
         GROUP BY 1 ORDER BY 2 DESC LIMIT 8) x), '[]'::jsonb),
    'due_now', (SELECT count(*) FROM public.marketing_posts WHERE status = 'publishing'),
    'awaiting_approval', (SELECT count(*) FROM public.marketing_posts WHERE status = 'draft'),
    'scheduled_next_7', (SELECT count(*) FROM public.marketing_posts WHERE status = 'scheduled'
                           AND scheduled_at < now() + interval '7 days'),
    'approved_unscheduled', (SELECT count(*) FROM public.marketing_posts WHERE status = 'approved'),
    'stuck_publishing', (SELECT count(*) FROM public.marketing_posts WHERE status = 'publishing'
                           AND publishing_started_at < now() - interval '24 hours')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.owner_marketing_weekly() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_marketing_weekly() TO authenticated;

-- ---------------------------------------------------------------------------
-- Scheduling (pg_cron). Every 5 minutes, scheduled posts whose time has come
-- move to "publishing" and each admin gets a bell notification to post it
-- (manual posts) — an API publisher, once connected, picks up the same rows.
-- Mondays at 16:00 UTC the admins are told the weekly summary is ready.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketing_due_tick()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.marketing_posts;
  n int := 0;
  admin uuid;
BEGIN
  FOR p IN SELECT * FROM public.marketing_posts
            WHERE status = 'scheduled' AND scheduled_at <= now()
            ORDER BY scheduled_at LIMIT 50 FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.marketing_posts SET status = 'publishing', publishing_started_at = now(), updated_at = now()
     WHERE id = p.id;
    INSERT INTO public.marketing_post_events (post_id, event, from_status, to_status, detail)
    VALUES (p.id, 'due', 'scheduled', 'publishing', jsonb_build_object('method', p.publish_method));
    IF p.publish_method = 'manual' AND to_regprocedure('public.notify_user(uuid,text,text,text,text,text)') IS NOT NULL THEN
      FOR admin IN SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'admin' LOOP
        PERFORM public.notify_user(admin, 'marketing_due', left('Time to post: ' || p.title, 120),
          'It''s ready to copy in the Marketing Center. Paste the live link there when it''s up.',
          '/owner/marketing', 'marketing_due:' || p.id::text || ':' || p.attempts::text);
      END LOOP;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.marketing_due_tick() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.marketing_weekly_notice()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE admin uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.marketing_posts) THEN RETURN; END IF;
  IF to_regprocedure('public.notify_user(uuid,text,text,text,text,text)') IS NULL THEN RETURN; END IF;
  FOR admin IN SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    PERFORM public.notify_user(admin, 'marketing_weekly', 'Your weekly marketing summary is ready',
      'What went out, what it brought in, and what to try next.', '/owner/marketing',
      'marketing_weekly:' || to_char(now(), 'IYYY-IW'));
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.marketing_weekly_notice() FROM public, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('yooits-marketing-due', 'yooits-marketing-weekly');
    PERFORM cron.schedule('yooits-marketing-due', '*/5 * * * *', 'SELECT public.marketing_due_tick()');
    PERFORM cron.schedule('yooits-marketing-weekly', '0 16 * * 1', 'SELECT public.marketing_weekly_notice()');
  END IF;
END;
$$;
