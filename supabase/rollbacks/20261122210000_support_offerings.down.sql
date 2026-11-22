-- Rollback for 20261122210000_support_offerings.sql.
-- Removes only what that migration added. Run it only while no real support
-- order exists (support_orders is empty); otherwise keep the tables and
-- switch the feature off instead. Files in the private support-files bucket
-- are left in place. tip_settings and tips are untouched either way.

DROP POLICY IF EXISTS "Support files: owners, admins and paid buyers" ON storage.objects;
DROP POLICY IF EXISTS "Support files: creators upload to their folder" ON storage.objects;

DROP FUNCTION IF EXISTS public.owner_set_support_offering_suspended(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.owner_decide_support_version(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.owner_set_support_offering_settings(boolean, integer, integer);
DROP FUNCTION IF EXISTS public.owner_support_offerings();
DROP FUNCTION IF EXISTS public.my_support_offerings();
DROP FUNCTION IF EXISTS public.support_version_json(public.support_offering_versions);
DROP FUNCTION IF EXISTS public.creator_archive_support_offering(uuid);
DROP FUNCTION IF EXISTS public.creator_submit_support_offering(uuid, text, text, text, text, integer, boolean, text, text, text);
DROP FUNCTION IF EXISTS public.support_file_can_upload(text);
DROP FUNCTION IF EXISTS public.support_file_visible(text);
DROP FUNCTION IF EXISTS public.support_version_unlocked(uuid, uuid);

DROP TABLE IF EXISTS public.support_orders;
DROP TRIGGER IF EXISTS support_version_immutable ON public.support_offering_versions;
DROP TABLE IF EXISTS public.support_offering_versions;
DROP FUNCTION IF EXISTS public.support_version_immutable();
DROP TABLE IF EXISTS public.support_offerings;
DROP FUNCTION IF EXISTS public.support_offerings_on_for(uuid);
DROP TABLE IF EXISTS public.support_offering_settings;
