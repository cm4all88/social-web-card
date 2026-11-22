-- Rollback for 20261122150000_announcements_notifications.sql.
-- Removes announcements, dismissals and notifications (and their content).
-- feature_flags is shared: only this migration's row is removed, and the
-- table itself only when no other flag lives in it.
DROP TRIGGER IF EXISTS abuse_reports_notify_reviewed ON public.abuse_reports;
DROP TRIGGER IF EXISTS plan_entitlements_notify_founding ON public.plan_entitlements;
DROP TRIGGER IF EXISTS profiles_notify_welcome ON public.profiles;
DROP FUNCTION IF EXISTS public.notify_report_reviewed();
DROP FUNCTION IF EXISTS public.notify_founding_member();
DROP FUNCTION IF EXISTS public.notify_welcome();
DROP FUNCTION IF EXISTS public.owner_archive_announcement(uuid, boolean);
DROP FUNCTION IF EXISTS public.owner_save_announcement(uuid, text, text, text, text, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.owner_list_announcements();
DROP FUNCTION IF EXISTS public.mark_notifications_read(uuid[]);
DROP FUNCTION IF EXISTS public.dismiss_announcement(uuid);
DROP FUNCTION IF EXISTS public.my_dashboard_feed();
DROP FUNCTION IF EXISTS public.notify_user(uuid, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.announcement_targets(text, uuid);
DROP TABLE IF EXISTS public.notifications;
DROP TABLE IF EXISTS public.announcement_dismissals;
DROP TABLE IF EXISTS public.announcements;
DELETE FROM public.feature_flags WHERE key = 'dashboard_notifications';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.feature_flags) THEN
    DROP FUNCTION IF EXISTS public.owner_set_feature_flag(text, boolean);
    DROP FUNCTION IF EXISTS public.feature_enabled(text);
    DROP TABLE public.feature_flags;
  END IF;
END $$;
