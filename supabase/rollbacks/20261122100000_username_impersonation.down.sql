-- Rollback for 20261122100000_username_impersonation.sql.
-- Puts back the Phase 0 username_is_reserved() and removes the lookalike
-- check. No profile rows are touched by either direction.
BEGIN;

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

DROP FUNCTION IF EXISTS public.username_is_impersonation(text);
DROP FUNCTION IF EXISTS public.username_skeleton(text);
DROP TABLE IF EXISTS public.impersonation_terms;


COMMIT;
