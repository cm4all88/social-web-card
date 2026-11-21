-- Lookalike usernames for major brands and Yooits staff.
--
-- The Phase 0 list blocks exact names ("admin", "paypal" isn't on it at all).
-- This adds a small, targeted check on top:
--   * a "skeleton" of the name that undoes common disguises: separators
--     (- _ .), digits used as letters (0→o, 1→l, 3→e, 4→a, 5→s, 7→t), i→l
--     and rn→m, so "pay-pa1", "y00its" and "adm1n" look like what they copy;
--   * impersonation_terms: brand names blocked anywhere in the name
--     ('contains'), short or common words blocked only as the whole name
--     ('exact'), and staff words blocked at the start or end ('affix', so
--     "support-team" and "yooitsadmin" are caught but "badminton" isn't);
--   * every reserved name, compared by skeleton ("supp0rt", "h-e-l-p").
--
-- It is enforced through username_is_reserved(), which signup
-- (handle_new_user) and the profiles trigger already call, and only when a
-- name is chosen or changed. Existing usernames are never renamed or removed.
-- Rollback: supabase/rollbacks/20261122100000_username_impersonation.down.sql

CREATE TABLE public.impersonation_terms (
  term text PRIMARY KEY CHECK (term ~ '^[a-z0-9]{2,30}$'),
  match text NOT NULL CHECK (match IN ('contains', 'exact', 'affix')),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Server managed. No browser access; use username_is_reserved().
ALTER TABLE public.impersonation_terms ENABLE ROW LEVEL SECURITY;

INSERT INTO public.impersonation_terms (term, match) VALUES
  -- money and crypto
  ('paypal', 'contains'), ('venmo', 'contains'), ('cashapp', 'contains'),
  ('zelle', 'exact'), ('coinbase', 'contains'), ('binance', 'contains'),
  ('metamask', 'contains'), ('robinhood', 'contains'), ('wellsfargo', 'contains'),
  ('bankofamerica', 'contains'), ('americanexpress', 'contains'),
  ('mastercard', 'contains'), ('applepay', 'contains'), ('googlepay', 'contains'),
  ('chase', 'exact'), ('stripe', 'exact'), ('visa', 'exact'), ('amex', 'exact'),
  ('klarna', 'contains'), ('afterpay', 'contains'),
  -- platforms people link to from Yooits
  ('instagram', 'contains'), ('whatsapp', 'contains'), ('tiktok', 'contains'),
  ('snapchat', 'contains'), ('facebook', 'contains'), ('messenger', 'exact'),
  ('youtube', 'contains'), ('twitter', 'contains'), ('threads', 'exact'),
  ('bluesky', 'contains'), ('linkedin', 'contains'), ('telegram', 'contains'),
  ('discord', 'contains'), ('twitch', 'contains'), ('spotify', 'contains'),
  ('netflix', 'contains'), ('onlyfans', 'contains'), ('patreon', 'contains'),
  ('kofi', 'exact'), ('linktree', 'contains'), ('pinterest', 'contains'),
  ('reddit', 'contains'), ('meta', 'exact'),
  -- big tech and retail
  ('google', 'contains'), ('gmail', 'contains'), ('microsoft', 'contains'),
  ('outlook', 'exact'), ('icloud', 'contains'), ('apple', 'exact'),
  ('appleid', 'contains'), ('amazon', 'contains'), ('ebay', 'exact'),
  ('walmart', 'contains'), ('shopify', 'contains'), ('openai', 'contains'),
  ('chatgpt', 'contains'), ('anthropic', 'contains'),
  -- Yooits itself and its owner
  ('yooits', 'contains'), ('tahoma', 'contains'),
  -- staff and trust words, as a prefix or suffix
  ('admin', 'affix'), ('administrator', 'affix'), ('moderator', 'affix'),
  ('support', 'affix'), ('helpdesk', 'affix'), ('security', 'affix'),
  ('official', 'affix'), ('verify', 'affix'), ('verified', 'affix'),
  ('customerservice', 'affix'), ('trustandsafety', 'affix')
ON CONFLICT (term) DO NOTHING;

-- Visible shape of a name, with common disguises undone.
CREATE OR REPLACE FUNCTION public.username_skeleton(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT replace(
           translate(regexp_replace(lower(btrim(coalesce(_name, ''))), '[-_.]', '', 'g'),
                     '0134579i', 'oleastgl'),
           'rn', 'm')
$$;

CREATE OR REPLACE FUNCTION public.username_is_impersonation(_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (SELECT public.username_skeleton(_username) AS k)
  SELECT (SELECT k FROM s) <> '' AND (
    EXISTS (
      SELECT 1 FROM public.impersonation_terms t, s
      WHERE (t.match = 'exact' AND s.k = public.username_skeleton(t.term))
         OR (t.match = 'contains' AND strpos(s.k, public.username_skeleton(t.term)) > 0)
         OR (t.match = 'affix' AND (s.k LIKE public.username_skeleton(t.term) || '%'
                                    OR s.k LIKE '%' || public.username_skeleton(t.term)))
    )
    OR EXISTS (
      SELECT 1 FROM public.reserved_usernames r, s
      WHERE public.username_skeleton(r.username) = s.k
    )
  )
$$;

GRANT EXECUTE ON FUNCTION public.username_is_impersonation(text) TO anon, authenticated;

-- Same signature and grants as Phase 0; now also refuses lookalikes.
CREATE OR REPLACE FUNCTION public.username_is_reserved(_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reserved_usernames WHERE username = lower(btrim(_username))
  ) OR public.username_is_impersonation(_username)
$$;
