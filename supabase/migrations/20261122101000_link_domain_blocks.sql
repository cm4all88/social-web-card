-- Blocking links to known malicious sites, with a review step for mistakes.
--
--   * link_domain_blocks: sites links may not point to. A block covers the
--     site and every subdomain. source says where it came from: 'manual'
--     (the owner) or 'feed' (a threat-intelligence import, for later).
--   * link_domain_allows: the false-positive list. An allowed site (or a
--     parent of it) is never blocked, whatever the block list says.
--   * New or changed links to a blocked site are refused with a plain error.
--     Existing links are never deleted: if a site is blocked later, its links
--     stay in the creator's dashboard but are hidden from everyone else.
--   * owner_* functions change the lists; each change is audit-logged.
-- Rollback: supabase/rollbacks/20261122101000_link_domain_blocks.down.sql

CREATE TABLE public.link_domain_blocks (
  domain text PRIMARY KEY CHECK (domain ~ '^([a-z0-9-]+\.)+[a-z0-9-]{2,}$' AND char_length(domain) <= 253),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'feed')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.link_domain_allows (
  domain text PRIMARY KEY CHECK (domain ~ '^([a-z0-9-]+\.)+[a-z0-9-]{2,}$' AND char_length(domain) <= 253),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.link_domain_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_domain_allows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read link domain blocks" ON public.link_domain_blocks
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins read link domain allows" ON public.link_domain_allows
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- The host a link opens, lower case, or NULL when it isn't a web link
-- (mailto:, tel:, sms:, a handle). Bare domains count, as the app adds
-- https:// to them.
CREATE OR REPLACE FUNCTION public.link_url_host(_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(rtrim(lower(substring(
    CASE
      WHEN _url ~* '^https?://' THEN regexp_replace(_url, '^[a-z]+://', '', 'i')
      WHEN _url ~* '^([a-z0-9-]+\.)+[a-z]{2,}([/?#:]|$)' THEN _url
    END
    FROM '^(?:[^/?#@]*@)?([^/?#:]+)')), '.'), '')
$$;

-- A domain as the owner typed it ("https://www.Evil.example/x" -> "evil.example").
CREATE OR REPLACE FUNCTION public.link_domain_normalize(_domain text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
           coalesce(public.link_url_host(
             CASE WHEN btrim(_domain) ~* '^[a-z]+://' THEN btrim(_domain)
                  ELSE 'https://' || regexp_replace(btrim(coalesce(_domain, '')), '^\*\.', '') END), ''),
           '^www\.', '')
$$;

CREATE OR REPLACE FUNCTION public.link_url_is_blocked(_url text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h text := public.link_url_host(_url);
  parts text[];
  candidates text[] := ARRAY[]::text[];
  i int;
BEGIN
  IF h IS NULL OR NOT EXISTS (SELECT 1 FROM public.link_domain_blocks) THEN
    RETURN false;
  END IF;
  parts := string_to_array(h, '.');
  FOR i IN 1 .. coalesce(array_length(parts, 1), 0) LOOP
    candidates := candidates || array_to_string(parts[i:], '.');
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.link_domain_allows WHERE domain = ANY (candidates)) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM public.link_domain_blocks WHERE domain = ANY (candidates));
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_url_is_blocked(text) TO anon, authenticated;

-- New or changed links only, so a later block never breaks someone's save of
-- an unrelated field.
CREATE OR REPLACE FUNCTION public.enforce_link_domain_blocks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.url IS DISTINCT FROM OLD.url) AND public.link_url_is_blocked(NEW.url) THEN
    RAISE EXCEPTION 'That link goes to a site Yooits has blocked for safety. If you think this is a mistake, contact us.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER social_links_enforce_domain_blocks
  BEFORE INSERT OR UPDATE OF url ON public.social_links
  FOR EACH ROW EXECUTE FUNCTION public.enforce_link_domain_blocks();

CREATE TRIGGER wishlist_items_enforce_domain_blocks
  BEFORE INSERT OR UPDATE OF url ON public.wishlist_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_link_domain_blocks();

-- Hide links to blocked sites from everyone but their owner and admins.
CREATE POLICY "Links to blocked sites are hidden"
  ON public.social_links AS RESTRICTIVE FOR SELECT
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR NOT public.link_url_is_blocked(url));

CREATE POLICY "Wishlist links to blocked sites are hidden"
  ON public.wishlist_items AS RESTRICTIVE FOR SELECT
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR NOT public.link_url_is_blocked(url));

-- ---------------------------------------------------------------------------
-- Owner functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_link_domain_lists()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.owner_require_admin();
  RETURN jsonb_build_object(
    'blocks', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'domain', b.domain, 'source', b.source, 'reason', b.reason, 'created_at', b.created_at,
        'links_hidden', (SELECT count(*) FROM public.social_links s WHERE public.link_url_is_blocked(s.url)
                           AND (public.link_url_host(s.url) = b.domain OR public.link_url_host(s.url) LIKE '%.' || b.domain))
      ) ORDER BY b.created_at DESC) FROM public.link_domain_blocks b), '[]'::jsonb),
    'allows', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'domain', a.domain, 'reason', a.reason, 'created_at', a.created_at
      ) ORDER BY a.created_at DESC) FROM public.link_domain_allows a), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_link_domain(_list text, _domain text, _on boolean, _reason text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d text := public.link_domain_normalize(_domain);
  r text := nullif(left(btrim(coalesce(_reason, '')), 200), '');
BEGIN
  PERFORM public.owner_require_admin();
  IF d = '' OR d !~ '^([a-z0-9-]+\.)+[a-z0-9-]{2,}$' THEN
    RAISE EXCEPTION 'Enter a site such as example.com' USING ERRCODE = '22023';
  END IF;
  IF _list = 'block' THEN
    IF _on THEN
      INSERT INTO public.link_domain_blocks (domain, source, reason, created_by)
      VALUES (d, 'manual', r, auth.uid())
      ON CONFLICT (domain) DO UPDATE SET reason = coalesce(EXCLUDED.reason, link_domain_blocks.reason);
    ELSE
      DELETE FROM public.link_domain_blocks WHERE domain = d;
    END IF;
  ELSIF _list = 'allow' THEN
    IF _on THEN
      INSERT INTO public.link_domain_allows (domain, reason, created_by)
      VALUES (d, r, auth.uid())
      ON CONFLICT (domain) DO UPDATE SET reason = coalesce(EXCLUDED.reason, link_domain_allows.reason);
    ELSE
      DELETE FROM public.link_domain_allows WHERE domain = d;
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown list' USING ERRCODE = '22023';
  END IF;
  PERFORM public.write_admin_audit(
    'link_domain.' || CASE WHEN _list = 'block' THEN (CASE WHEN _on THEN 'blocked' ELSE 'unblocked' END)
                           ELSE (CASE WHEN _on THEN 'allowed' ELSE 'unallowed' END) END,
    'domain', d, CASE WHEN r IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('reason', r) END);
  RETURN d;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_link_domain_lists() FROM public, anon;
REVOKE ALL ON FUNCTION public.owner_set_link_domain(text, text, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_link_domain_lists() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_link_domain(text, text, boolean, text) TO authenticated;
