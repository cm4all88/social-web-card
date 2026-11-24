ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_bio_length,
  ADD CONSTRAINT profiles_bio_length
    CHECK (bio IS NULL OR char_length(bio) <= 1000) NOT VALID,
  ADD COLUMN avatar_size smallint NOT NULL DEFAULT 144
    CHECK (avatar_size IN (112, 144, 176)),
  ADD COLUMN bio_alignment text NOT NULL DEFAULT 'center'
    CHECK (bio_alignment IN ('left', 'center')),
  ADD COLUMN skin_intensity text NOT NULL DEFAULT 'standard'
    CHECK (skin_intensity IN ('subtle', 'standard', 'full'));
