ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'midnight',
  ADD COLUMN IF NOT EXISTS custom_theme jsonb;