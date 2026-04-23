
-- Backfill profiles for any auth.users that don't have one
INSERT INTO public.profiles (user_id, username, display_name)
SELECT
  u.id,
  lower(regexp_replace(split_part(u.email, '@', 1), '[^a-z0-9_-]', '', 'g')) AS username,
  split_part(u.email, '@', 1) AS display_name
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.id IS NULL
  AND u.email IS NOT NULL;

-- Make sure first user has admin role
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::app_role
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin')
ORDER BY u.created_at ASC
LIMIT 1
ON CONFLICT DO NOTHING;

-- Attach the trigger that runs on every new signup (drop first if exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
