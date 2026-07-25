
-- 1. Move has_role to private schema
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Recreate all policies referencing has_role
DROP POLICY IF EXISTS "Admins manage applications" ON public.applications;
CREATE POLICY "Admins manage applications" ON public.applications
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins view audit logs" ON public.audit_logs;
CREATE POLICY "Admins view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage notifications" ON public.notifications;
CREATE POLICY "Admins manage notifications" ON public.notifications
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage payments" ON public.payments;
CREATE POLICY "Admins manage payments" ON public.payments
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins view all payments" ON public.payments;
CREATE POLICY "Admins view all payments" ON public.payments
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage plans" ON public.subscription_plans;
CREATE POLICY "Admins manage plans" ON public.subscription_plans
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins manage subscriptions" ON public.subscriptions;
CREATE POLICY "Admins manage subscriptions" ON public.subscriptions
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins view all subscriptions" ON public.subscriptions;
CREATE POLICY "Admins view all subscriptions" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- Storage policy also referenced old function
DROP POLICY IF EXISTS "Admins manage app-logos" ON storage.objects;
CREATE POLICY "Admins manage app-logos" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'app-logos' AND private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (bucket_id = 'app-logos' AND private.has_role(auth.uid(), 'admin'::public.app_role));

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);

-- 2. profiles: remove public exposure
DROP POLICY IF EXISTS "Public profiles viewable by everyone" ON public.profiles;

CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = off) AS
SELECT
  id, username, first_name, last_name, avatar_url, city, country,
  language, user_type, is_verified, bio, is_active, created_at, updated_at
FROM public.profiles
WHERE is_active = true;

GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- 3. premium_profiles: mask private contact fields
DROP POLICY IF EXISTS "Premium profiles publicly readable" ON public.premium_profiles;

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

-- 4. subscriptions: drop public policy, provide minimal helper
DROP POLICY IF EXISTS "Active subscriptions publicly readable" ON public.subscriptions;

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

-- 5. subscription_plans: hide payment links from anon
REVOKE SELECT ON public.subscription_plans FROM anon;
GRANT SELECT (
  id, app_id, name, duration_months, price, currency,
  features_bs, features_en, features_de, is_active, created_at
) ON public.subscription_plans TO anon;
GRANT SELECT ON public.subscription_plans TO authenticated;

-- 6. user_app_settings: only visible rows public
DROP POLICY IF EXISTS "App settings publicly readable" ON public.user_app_settings;
CREATE POLICY "Visible app settings publicly readable" ON public.user_app_settings
  FOR SELECT TO anon, authenticated
  USING (is_visible = true);
