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
  v_is_first boolean;
BEGIN
  v_invite_code := NULLIF(new.raw_user_meta_data->>'invite_code', '');
  v_username := lower(NULLIF(new.raw_user_meta_data->>'username', ''));
  v_display := NULLIF(new.raw_user_meta_data->>'display_name', '');

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO v_is_first;

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
    -- If a valid invite code was provided, mark it used (still optional)
    IF v_invite_code IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.invites WHERE code = v_invite_code AND used_by IS NULL
    ) THEN
      UPDATE public.invites
        SET used_by = new.id, used_at = now()
        WHERE code = v_invite_code AND used_by IS NULL;
    END IF;
    INSERT INTO public.user_roles (user_id, role) VALUES (new.id, 'user');
  END IF;

  RETURN new;
END;
$function$;