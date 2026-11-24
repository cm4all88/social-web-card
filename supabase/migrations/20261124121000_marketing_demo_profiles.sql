CREATE TABLE public.marketing_demo_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object' AND pg_column_size(profile) <= 1048576),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_demo_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_demo_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_demo_profiles TO authenticated;

CREATE POLICY "Admins manage fictional marketing profiles"
  ON public.marketing_demo_profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
