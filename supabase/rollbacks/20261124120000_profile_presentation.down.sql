ALTER TABLE public.profiles
  DROP COLUMN avatar_size,
  DROP COLUMN bio_alignment,
  DROP COLUMN skin_intensity,
  DROP CONSTRAINT profiles_bio_length,
  ADD CONSTRAINT profiles_bio_length
    CHECK (bio IS NULL OR char_length(bio) <= 300) NOT VALID;
