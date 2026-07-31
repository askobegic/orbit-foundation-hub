
-- Restore public.profiles_public, public.premium_profiles_public, and
-- public.is_user_premium() -- the objects src/routes/u.$username.tsx (the
-- public profile page, /u/:username) depends on.
--
-- Same root cause as every other restoration this session: migration
-- 20260725070421 was in the earlier bulk `migration repair --status
-- applied` batch and evidently never actually ran. Confirmed live: querying
-- either view returns "Could not find the table ... in the schema cache".
-- This means /u/:username has been completely broken for every user, not
-- specific to username generation.
--
-- Scoped narrowly to what this route needs. The same migration also
-- recreates ~10 admin RLS policies referencing private.has_role() (on
-- applications, audit_logs, notifications, payments, subscription_plans,
-- subscriptions, user_roles) -- those are NOT restored here. They are not
-- required for /u/:username, and every admin write path already goes
-- through service_role (bypassing RLS), so their absence causes no visible
-- admin-panel breakage today -- only a defense-in-depth gap, out of scope
-- for this fix. Flagged separately, not addressed here.

CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = off) AS
SELECT
  id, username, first_name, last_name, avatar_url, city, country,
  language, user_type, is_verified, bio, is_active, created_at, updated_at
FROM public.profiles
WHERE is_active = true;

GRANT SELECT ON public.profiles_public TO anon, authenticated;

CREATE OR REPLACE VIEW public.premium_profiles_public
WITH (security_invoker = off) AS
SELECT
  id,
  user_id,
  CASE WHEN phone_public THEN phone END AS phone,
  phone_public,
  CASE WHEN whatsapp_public THEN whatsapp END AS whatsapp,
  whatsapp_public,
  CASE WHEN contact_email_public THEN contact_email END AS contact_email,
  contact_email_public,
  CASE WHEN website_public THEN website END AS website,
  website_public,
  primary_profession,
  secondary_professions,
  facebook_url, instagram_url, tiktok_url, youtube_url, linkedin_url, x_url,
  created_at, updated_at
FROM public.premium_profiles;

GRANT SELECT ON public.premium_profiles_public TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_user_premium(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _user_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  )
$$;

REVOKE ALL ON FUNCTION public.is_user_premium(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_user_premium(uuid) TO anon, authenticated;

-- Also restore the narrower user_app_settings read policy this same
-- migration introduced (my earlier 20260729130200 restoration re-created
-- the pre-hardening, unconditional "publicly readable" policy since that
-- was the version present in the migration that actually defines the
-- table -- this narrows it to match what was actually intended).
DROP POLICY IF EXISTS "App settings publicly readable" ON public.user_app_settings;
DROP POLICY IF EXISTS "Visible app settings publicly readable" ON public.user_app_settings;
CREATE POLICY "Visible app settings publicly readable" ON public.user_app_settings
  FOR SELECT TO anon, authenticated
  USING (is_visible = true);
