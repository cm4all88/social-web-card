-- Rollback for 20261121234000_abuse_reports.sql (abuse reports).
-- Run in one transaction. The migration only added things, so this only
-- removes them: four functions and the abuse_reports table. No other table,
-- function, policy or row is touched.
-- Dropping the table deletes the reports filed so far. Export them first:
--   COPY (SELECT * FROM public.abuse_reports) TO STDOUT WITH CSV HEADER;
-- Audit log rows written when reports were resolved stay in admin_audit_log.
-- After this, deploy code without the Report link and /owner/reports, or the
-- Report form shows an error (nothing else breaks).
BEGIN;
DROP FUNCTION IF EXISTS public.owner_resolve_report(uuid, text, text);
DROP FUNCTION IF EXISTS public.owner_list_reports(text);
DROP FUNCTION IF EXISTS public.owner_open_report_count();
DROP FUNCTION IF EXISTS public.record_abuse_report(text, text, text, text, text, uuid, text);
DROP TABLE IF EXISTS public.abuse_reports;
COMMIT;
