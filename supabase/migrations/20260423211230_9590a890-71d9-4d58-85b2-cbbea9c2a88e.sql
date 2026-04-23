-- Wipe existing links
DELETE FROM public.social_links;

-- Add user_id to social_links
ALTER TABLE public.social_links
  ADD COLUMN user_id uuid NOT NULL;

CREATE INDEX idx_social_links_user_id ON public.social_links(user_id);

-- Drop old single-user policies
DROP POLICY IF EXISTS "Admins can delete" ON public.social_links;
DROP POLICY IF EXISTS "Admins can insert" ON public.social_links;
DROP POLICY IF EXISTS "Admins can update" ON public.social_links;
DROP POLICY IF EXISTS "Admins can view all" ON public.social_links;
DROP POLICY IF EXISTS "Public can view enabled links" ON public.social_links;

-- New per-user policies
CREATE POLICY "Public can view enabled links"
  ON public.social_links FOR SELECT
  USING (enabled = true);

CREATE POLICY "Users view own links"
  ON public.social_links FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own links"
  ON public.social_links FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own links"
  ON public.social_links FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own links"
  ON public.social_links FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  username text NOT NULL UNIQUE,
  display_name text,
  bio text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT username_format CHECK (username ~ '^[a-z0-9_-]{2,30}$')
);

CREATE INDEX idx_profiles_username ON public.profiles(lower(username));

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are public"
  ON public.profiles FOR SELECT
  USING (true);

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- profiles inserts happen via trigger (security definer)

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Invites table
CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  used_by uuid,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invites_code ON public.invites(code);

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage invites"
  ON public.invites FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Function to validate an invite code (callable anon during signup check)
CREATE OR REPLACE FUNCTION public.invite_is_valid(_code text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invites
    WHERE code = _code AND used_by IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.invite_is_valid(text) TO anon, authenticated;

-- Handle new user: require invite (unless first user = admin), create profile, consume invite
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invite_code text;
  v_username text;
  v_display text;
  v_is_first boolean;
BEGIN
  v_invite_code := NULLIF(new.raw_user_meta_data->>'invite_code', '');
  v_username := lower(NULLIF(new.raw_user_meta_data->>'username', ''));
  v_display := NULLIF(new.raw_user_meta_data->>'display_name', '');

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO v_is_first;

  IF NOT v_is_first THEN
    IF v_invite_code IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.invites WHERE code = v_invite_code AND used_by IS NULL
    ) THEN
      RAISE EXCEPTION 'A valid invite code is required to sign up';
    END IF;
  END IF;

  IF v_username IS NULL OR v_username !~ '^[a-z0-9_-]{2,30}$' THEN
    RAISE EXCEPTION 'A valid username (2-30 chars, a-z 0-9 _ -) is required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) THEN
    RAISE EXCEPTION 'Username already taken';
  END IF;

  INSERT INTO public.profiles (user_id, username, display_name)
  VALUES (new.id, v_username, COALESCE(v_display, v_username));

  IF v_is_first THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'admin');
  ELSE
    UPDATE public.invites
      SET used_by = new.id, used_at = now()
      WHERE code = v_invite_code AND used_by IS NULL;
    INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'user');
  END IF;

  RETURN new;
END;
$$;

-- Replace any old grant_first_admin trigger usage
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS grant_first_admin_trigger ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();