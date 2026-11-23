-- Undoes 20261123040000_owner_assign_username.sql. Usernames already assigned
-- stay as they are; only the owner action goes away.
DROP FUNCTION IF EXISTS public.owner_assign_username(uuid, text, text);
DROP FUNCTION IF EXISTS public.username_is_site_path(text);

CREATE OR REPLACE FUNCTION public.enforce_username_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.username IS DISTINCT FROM OLD.username THEN
    IF public.username_is_reserved(NEW.username) THEN
      RAISE EXCEPTION 'That username is reserved' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
