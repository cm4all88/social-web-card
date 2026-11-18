-- Phase 0 security hardening for Yooits.
--
-- 1. Removes BOTH automatic admin-assignment paths (the first-signup branch of
--    handle_new_user and the old grant_first_admin trigger). Admin is granted
--    only by an explicit SQL statement from now on.
-- 2. Protects existing admin access: the migration refuses to run if users
--    exist but no admin does, never touches existing user_roles rows, and adds
--    a guard so the last admin row can't be deleted, demoted or truncated
--    (that also blocks deleting the last admin's auth account).
-- 3. Server-side input rules: link URL schemes, reserved usernames, text
--    lengths, custom theme values, avatar URLs, avatar bucket type/size limits.
--
-- New constraints on existing tables are NOT VALID: existing rows are left as
-- they are and the rule applies to every new insert and update.
--
-- To grant admin on a fresh database (no automatic grant any more):
--   INSERT INTO public.user_roles (user_id, role)
--   SELECT id, 'admin' FROM auth.users WHERE email = '<owner email>'
--   ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 0. Pre-flight: never run on a database that has users but no admin.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RAISE EXCEPTION
      'Phase 0 stopped: users exist but no admin role is assigned. Grant the owner admin first, then re-run.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Remove automatic admin assignment
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created_grant_admin ON auth.users;
DROP FUNCTION IF EXISTS public.grant_first_admin();

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
    UPDATE public.invites
      SET used_by = new.id, used_at = now()
      WHERE code = v_invite_code AND used_by IS NULL;
  END IF;

  -- Every new account is an ordinary user. Admin is never granted here.
  INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'user')
  ON CONFLICT DO NOTHING;

  RETURN new;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Never lose the last admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'admin'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NEW.user_id <> OLD.user_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE role = 'admin' AND user_id <> OLD.user_id
    ) THEN
      RAISE EXCEPTION 'Cannot remove the last Yooits admin. Grant another admin first.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_protect_last_admin ON public.user_roles;
CREATE TRIGGER user_roles_protect_last_admin
  BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_admin();

CREATE OR REPLACE FUNCTION public.block_user_roles_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'user_roles cannot be truncated (it holds the Yooits admin).'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS user_roles_block_truncate ON public.user_roles;
CREATE TRIGGER user_roles_block_truncate
  BEFORE TRUNCATE ON public.user_roles
  FOR EACH STATEMENT EXECUTE FUNCTION public.block_user_roles_truncate();

-- ---------------------------------------------------------------------------
-- 3. Reserved usernames
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reserved_usernames (
  username text PRIMARY KEY CHECK (username = lower(username)),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Server/admin managed. No browser access; use username_is_reserved().
ALTER TABLE public.reserved_usernames ENABLE ROW LEVEL SECURITY;

INSERT INTO public.reserved_usernames (username) VALUES
  -- app routes and system words
  ('admin'), ('administrator'), ('owner'), ('dashboard'), ('auth'), ('api'),
  ('login'), ('logout'), ('signin'), ('signup'), ('sign-in'), ('sign-up'),
  ('register'), ('reset-password'), ('password'), ('verify'), ('callback'),
  ('settings'), ('account'), ('accounts'), ('profile'), ('profiles'),
  ('user'), ('users'), ('me'), ('home'), ('index'), ('app'), ('www'),
  ('static'), ('assets'), ('public'), ('favicon'), ('robots'), ('sitemap'),
  ('webhook'), ('webhooks'), ('stripe'), ('tip'), ('tips'), ('wishlist'),
  ('wishlists'), ('revenue'), ('billing'), ('payments'), ('payment'),
  ('explore'), ('search'), ('null'), ('undefined'), ('root'), ('system'),
  -- brand and trust words
  ('yooits'), ('yooitsme'), ('yoo'), ('official'), ('staff'), ('team'),
  ('support'), ('help'), ('helpdesk'), ('contact'), ('about'), ('security'),
  ('abuse'), ('report'), ('moderator'), ('mod'), ('mods'), ('legal'),
  ('terms'), ('privacy'), ('status'), ('pricing'), ('pro'), ('premium'),
  ('verified'), ('mail'), ('email'), ('noreply'), ('no-reply'), ('blog'),
  ('news'), ('press'), ('jobs'), ('careers'), ('docs'), ('shop'), ('store')
ON CONFLICT (username) DO NOTHING;

CREATE OR REPLACE FUNCTION public.username_is_reserved(_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reserved_usernames WHERE username = lower(btrim(_username))
  )
$$;

GRANT EXECUTE ON FUNCTION public.username_is_reserved(text) TO anon, authenticated;

-- Applies on signup and on every username change. Existing holders of a
-- reserved name keep it until they change it.
CREATE OR REPLACE FUNCTION public.enforce_username_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.username IS DISTINCT FROM OLD.username THEN
    IF public.username_is_reserved(NEW.username) THEN
      RAISE EXCEPTION 'That username is reserved' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_username_rules ON public.profiles;
CREATE TRIGGER profiles_enforce_username_rules
  BEFORE INSERT OR UPDATE OF username ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_username_rules();

-- ---------------------------------------------------------------------------
-- 4. Profile text, theme and avatar rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_theme_is_valid(_t jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _t IS NULL OR (
    jsonb_typeof(_t) = 'object'
    AND octet_length(_t::text) <= 1024
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(_t) AS e(k, v)
      WHERE NOT (
        (e.k IN ('background', 'foreground', 'card', 'cardForeground', 'border', 'accent')
          AND jsonb_typeof(e.v) = 'string'
          AND (e.v #>> '{}') ~ '^#[0-9a-fA-F]{3,8}$')
        OR (e.k = 'buttonStyle' AND (e.v #>> '{}') IN ('rounded', 'pill', 'square', 'outline', 'soft'))
        OR (e.k = 'font' AND (e.v #>> '{}') IN ('sans', 'serif', 'mono', 'display'))
      )
    )
  )
$$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_length
    CHECK (display_name IS NULL OR char_length(display_name) <= 50) NOT VALID,
  ADD CONSTRAINT profiles_bio_length
    CHECK (bio IS NULL OR char_length(bio) <= 300) NOT VALID,
  ADD CONSTRAINT profiles_theme_key
    CHECK (theme ~ '^[a-z0-9_-]{1,40}$') NOT VALID,
  ADD CONSTRAINT profiles_custom_theme_valid
    CHECK (public.custom_theme_is_valid(custom_theme)) NOT VALID,
  -- Avatars must be this project's public avatars bucket, in the owner's folder.
  ADD CONSTRAINT profiles_avatar_url_own_bucket
    CHECK (
      avatar_url IS NULL OR (
        char_length(avatar_url) <= 1024
        AND avatar_url ~ (
          '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/'
          || user_id::text || '/[A-Za-z0-9._-]+$'
        )
      )
    ) NOT VALID;

-- ---------------------------------------------------------------------------
-- 5. Profile link rules
--    Allowed: empty, http(s)://, mailto:, tel:, sms:, or plain text with no
--    scheme (handles and emails for Discord, Zelle, Google Pay). Any other
--    scheme (javascript:, data:, vbscript:, file: ...) is rejected, as are
--    control characters and leading/trailing spaces that browsers strip.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_url_is_allowed(_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _url IS NOT NULL
    AND char_length(_url) <= 2048
    AND _url = btrim(_url)
    AND _url !~ '[[:cntrl:]]'
    AND (
      _url = ''
      OR _url ~* '^(https?://|mailto:|tel:|sms:)'
      OR _url !~* '^[a-z][a-z0-9+.-]*:'
    )
$$;

ALTER TABLE public.social_links
  ADD CONSTRAINT social_links_url_allowed
    CHECK (public.link_url_is_allowed(url)) NOT VALID,
  ADD CONSTRAINT social_links_platform_key
    CHECK (platform ~ '^[a-z0-9_-]{1,40}$') NOT VALID;

-- ---------------------------------------------------------------------------
-- 6. Avatar bucket: images only, 5 MB. (Guarded so plain Postgres test
--    databases without these Supabase columns still apply the migration.)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types'
  ) THEN
    EXECUTE $q$
      UPDATE storage.buckets
         SET file_size_limit = 5242880,
             allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
       WHERE id = 'avatars'
    $q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Post-check: the migration must leave at least one admin if users exist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'Phase 0 post-check failed: no admin would remain.';
  END IF;
END $$;
