-- Founding Members follow-up: pin search_path on the two helper functions the
-- Supabase security advisor flagged (function_search_path_mutable). Behaviour
-- is unchanged; it only stops a caller's search_path from changing what
-- these functions resolve. Rollback: ALTER FUNCTION ... RESET search_path.
ALTER FUNCTION public.invites_guard_beta_rows() SET search_path = public;
ALTER FUNCTION public.beta_invite_status(public.invites) SET search_path = public;
