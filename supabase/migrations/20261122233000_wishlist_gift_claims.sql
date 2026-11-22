-- Wishlist gift claims ("I'll buy it") and a "for" name on a list.
--
-- A signed-in visitor can claim an item on a public wishlist to buy it and
-- hand it over themselves. Everyone else then sees the item as taken, so two
-- people don't buy the same thing. No money moves through Yooits.
--
-- Privacy: who claimed an item is never shown to anyone but the claimer.
-- By default the list owner doesn't even see which items are taken, to keep
-- the surprise; they can turn reveal_claims on (for example a parent running
-- a child's list who wants to avoid buying the same thing).
--
-- Claims are written only through the SECURITY DEFINER functions below.
-- Switched on by wishlist_claim_settings.enabled (admins can always use it,
-- for testing). Rollback: supabase/rollbacks/20261122233000_wishlist_gift_claims.down.sql

ALTER TABLE public.wishlists
  ADD COLUMN recipient_name text
    CHECK (recipient_name IS NULL OR char_length(btrim(recipient_name)) BETWEEN 1 AND 40),
  ADD COLUMN reveal_claims boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wishlists.recipient_name IS
  'Who the list is for when it is not the owner, e.g. a child''s first name. Shown publicly.';
COMMENT ON COLUMN public.wishlists.reveal_claims IS
  'When true the owner can see which items are taken (never who took them).';

-- ---------------------------------------------------------------------------
-- Settings (one row)
-- ---------------------------------------------------------------------------
CREATE TABLE public.wishlist_claim_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  max_claims_per_list integer NOT NULL DEFAULT 20 CHECK (max_claims_per_list BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.wishlist_claim_settings (id) VALUES (true);
ALTER TABLE public.wishlist_claim_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wishlist_claim_settings FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claims (server-written only; the claimer can read their own)
-- ---------------------------------------------------------------------------
CREATE TABLE public.wishlist_item_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL UNIQUE REFERENCES public.wishlist_items (id) ON DELETE CASCADE,
  wishlist_id uuid NOT NULL REFERENCES public.wishlists (id) ON DELETE CASCADE,
  claimer_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wishlist_item_claims_list ON public.wishlist_item_claims (wishlist_id);
CREATE INDEX idx_wishlist_item_claims_claimer ON public.wishlist_item_claims (claimer_user_id, wishlist_id);

ALTER TABLE public.wishlist_item_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wishlist_item_claims FROM anon, authenticated;
GRANT SELECT ON public.wishlist_item_claims TO authenticated;

CREATE POLICY "Claimers view own claims"
  ON public.wishlist_item_claims FOR SELECT
  TO authenticated
  USING (claimer_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wishlist_claims_on_for(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT enabled FROM public.wishlist_claim_settings WHERE id), false)
      OR (_user_id IS NOT NULL AND public.has_role(_user_id, 'admin'))
$$;

-- What a viewer may know about claims on one list:
--   enabled  - whether this viewer can claim here
--   is_owner - the viewer owns the list
--   claims_on - the feature is switched on for this viewer
--   claimed  - [{item_id, mine}] for taken items; empty for the owner unless
--              reveal_claims is on. Never says who claimed.
CREATE OR REPLACE FUNCTION public.wishlist_claim_status(_wishlist_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.wishlists;
  me uuid := auth.uid();
  owner boolean;
BEGIN
  SELECT * INTO w FROM public.wishlists WHERE id = _wishlist_id;
  IF w.id IS NULL THEN
    RETURN jsonb_build_object('enabled', false, 'is_owner', false, 'claimed', '[]'::jsonb);
  END IF;
  owner := me IS NOT NULL AND w.user_id = me;
  -- Same visibility as the list itself: public on a public page, or the owner.
  IF NOT owner AND (w.visibility <> 'public' OR NOT public.profile_is_public(w.user_id)) THEN
    RETURN jsonb_build_object('enabled', false, 'is_owner', false, 'claimed', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'enabled', NOT owner AND w.visibility = 'public' AND public.wishlist_claims_on_for(me),
    'is_owner', owner,
    'claims_on', public.wishlist_claims_on_for(me),
    'reveal_claims', w.reveal_claims,
    'claimed', CASE WHEN owner AND NOT w.reveal_claims THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object('item_id', c.item_id, 'mine', coalesce(c.claimer_user_id = me, false)))
        FROM public.wishlist_item_claims c WHERE c.wishlist_id = w.id), '[]'::jsonb) END
  );
END;
$$;

-- Returns 'claimed', 'taken', 'limit', 'own_list', 'unavailable', 'sign_in' or 'off'.
CREATE OR REPLACE FUNCTION public.claim_wishlist_item(_item_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  it public.wishlist_items;
  w public.wishlists;
  lim integer;
  n integer;
BEGIN
  IF me IS NULL THEN RETURN 'sign_in'; END IF;
  IF NOT public.wishlist_claims_on_for(me) THEN RETURN 'off'; END IF;
  IF public.account_is_suspended(me) THEN RETURN 'unavailable'; END IF;

  SELECT * INTO it FROM public.wishlist_items WHERE id = _item_id;
  IF it.id IS NULL THEN RETURN 'unavailable'; END IF;
  SELECT * INTO w FROM public.wishlists WHERE id = it.wishlist_id;
  IF w.user_id = me THEN RETURN 'own_list'; END IF;
  IF w.visibility <> 'public' OR NOT public.profile_is_public(w.user_id) THEN
    RETURN 'unavailable';
  END IF;

  -- Serialise one claimer's claims so the per-list limit holds under races.
  PERFORM pg_advisory_xact_lock(hashtextextended('yooits_wishlist_claim:' || me::text, 0));
  SELECT max_claims_per_list INTO lim FROM public.wishlist_claim_settings WHERE id;
  SELECT count(*) INTO n FROM public.wishlist_item_claims
   WHERE claimer_user_id = me AND wishlist_id = w.id;
  IF n >= lim THEN RETURN 'limit'; END IF;

  INSERT INTO public.wishlist_item_claims (item_id, wishlist_id, claimer_user_id)
  VALUES (it.id, w.id, me)
  ON CONFLICT (item_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN CASE WHEN EXISTS (SELECT 1 FROM public.wishlist_item_claims
                              WHERE item_id = it.id AND claimer_user_id = me)
                THEN 'claimed' ELSE 'taken' END;
  END IF;
  RETURN 'claimed';
END;
$$;

-- Only the claimer can let an item go. Returns true when a claim was removed.
CREATE OR REPLACE FUNCTION public.unclaim_wishlist_item(_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  DELETE FROM public.wishlist_item_claims
   WHERE item_id = _item_id AND claimer_user_id = auth.uid();
  RETURN FOUND;
END;
$$;

-- Gifts the signed-in person said they'll buy, with where they're from.
CREATE OR REPLACE FUNCTION public.my_wishlist_claims()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'item_id', i.id, 'item_name', i.name, 'url', i.url, 'price_text', i.price_text,
      'wishlist_title', w.title, 'wishlist_slug', w.slug, 'recipient_name', w.recipient_name,
      'username', p.username, 'claimed_at', c.created_at)
      ORDER BY c.created_at DESC), '[]'::jsonb)
    FROM public.wishlist_item_claims c
    JOIN public.wishlist_items i ON i.id = c.item_id
    JOIN public.wishlists w ON w.id = c.wishlist_id
    JOIN public.profiles p ON p.user_id = w.user_id
   WHERE c.claimer_user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Owner console
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_wishlist_claim_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN (SELECT to_jsonb(s) - 'id' FROM public.wishlist_claim_settings s WHERE id)
    || jsonb_build_object(
      'active_claims', (SELECT count(*) FROM public.wishlist_item_claims),
      'lists_with_claims', (SELECT count(DISTINCT wishlist_id) FROM public.wishlist_item_claims));
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_wishlist_claim_settings(
  _enabled boolean,
  _max_claims_per_list integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  before jsonb;
  after jsonb;
BEGIN
  PERFORM public.owner_require_admin();
  SELECT to_jsonb(s) - 'id' INTO before FROM public.wishlist_claim_settings s WHERE id;
  UPDATE public.wishlist_claim_settings
     SET enabled = coalesce(_enabled, enabled),
         max_claims_per_list = coalesce(_max_claims_per_list, max_claims_per_list),
         updated_at = now(), updated_by = auth.uid()
   WHERE id;
  SELECT to_jsonb(s) - 'id' INTO after FROM public.wishlist_claim_settings s WHERE id;
  PERFORM public.write_admin_audit('wishlist_claims.settings', 'setting', 'wishlist_claims',
                                   jsonb_build_object('before', before, 'after', after));
  RETURN after;
END;
$$;

REVOKE ALL ON FUNCTION public.wishlist_claims_on_for(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wishlist_claim_status(uuid) FROM public;
REVOKE ALL ON FUNCTION public.claim_wishlist_item(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.unclaim_wishlist_item(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.my_wishlist_claims() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_wishlist_claim_settings() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_wishlist_claim_settings(boolean, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wishlist_claim_status(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_wishlist_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unclaim_wishlist_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_wishlist_claims() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_wishlist_claim_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_wishlist_claim_settings(boolean, integer) TO authenticated;
