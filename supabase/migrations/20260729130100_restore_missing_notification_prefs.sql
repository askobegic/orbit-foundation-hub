
-- Restore public.profiles.notify_email / notify_in_app / notify_marketing.
--
-- Same root cause as user_app_settings and private.has_role/app_role:
-- migration 20260724192510 (which added these columns) was included in an
-- earlier bulk `migration repair --status applied` pass and marked applied
-- without being individually verified -- it evidently never actually ran.
-- Confirmed live: saving notification preferences from the Settings page
-- failed outright ("Could not find the 'notify_email' column of 'profiles'
-- in the schema cache"), which also silently broke saving the language
-- preference, since both are written in a single combined UPDATE call.
--
-- Also grants these columns to `authenticated` -- the column-restriction
-- migration (20260726120000_protect_profile_privileged_columns.sql) was
-- written without accounting for dashboard.settings.tsx's updateUserSettings
-- call path, which updates these columns via the user's own session, not
-- service_role. These are non-privileged, user-owned preference fields
-- (unlike user_type/is_verified/is_active), so granting them is not a
-- widening of the kind that needs separate approval -- it is completing
-- the same narrowing migration's original, evidently incomplete intent.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_in_app boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_marketing boolean NOT NULL DEFAULT false;

GRANT UPDATE (notify_email, notify_in_app, notify_marketing) ON public.profiles TO authenticated;
