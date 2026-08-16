-- Universal Pre-Launch / Public Launch Standard for CORE-connected
-- applications (not the CORE platform itself -- see the 'core' row
-- exclusion below). See PROJECT_KNOWLEDGE.md -> Applications Registry &
-- Capabilities -> Pre-Launch / Public Launch.
--
-- This is a genuinely new axis, not a repurposing of the existing
-- `visibility` column (draft/coming_soon/active/archived): visibility
-- governs whether an application is *listed/discoverable* inside CORE's
-- own dashboard/API (Priority 8.9); launch_status governs whether the
-- application's own public site is open to ordinary visitors at all. An
-- application can be visibility='active' (fully listed in CORE) while
-- still launch_status='pre_launch' (its own site still gated) -- two
-- different questions, kept as two separate columns rather than folded
-- into one, per CLAUDE.md's rule against one flag silently answering two
-- questions.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS launch_status text NOT NULL DEFAULT 'pre_launch'
    CHECK (launch_status IN ('pre_launch', 'public'));

-- CORE itself (slug = 'core') is never gated by this mechanism -- it is
-- explicitly excluded by the requirement, not merely defaulted the same
-- way as every other application. Every other existing application row
-- keeps the conservative 'pre_launch' default: none of them have been
-- through an explicit admin "go public" decision, so none of them should
-- silently become publicly accessible as a side effect of this migration.
UPDATE public.applications SET launch_status = 'public' WHERE slug = 'core';

COMMENT ON COLUMN public.applications.launch_status IS
  'Whether this connected application''s own public site is open to ordinary visitors (public) or restricted to the admin/authorized test users behind a configurable Pre-Launch Front Page (pre_launch). Independent of visibility (CORE-listing concern). Never auto-transitions; only an explicit admin action changes it.';

-- === Pre-Launch Front Page content (per application, admin-configurable) ===
-- One row per application, mirroring share_invite_templates' shape exactly
-- (nullable fields, no server-side hardcoded content, publicly readable so
-- the Pre-Launch Front Page itself can render it for anonymous visitors).
CREATE TABLE IF NOT EXISTS public.application_pre_launch_content (
  app_id uuid PRIMARY KEY REFERENCES public.applications(id) ON DELETE CASCADE,
  logo_url text,
  banner_image_url text,
  title_bs text,
  title_en text,
  title_de text,
  info_text_bs text,
  info_text_en text,
  info_text_de text,
  facebook_url text,
  instagram_url text,
  tiktok_url text,
  youtube_url text,
  contact_email text,
  contact_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.application_pre_launch_content TO anon, authenticated;
GRANT ALL ON public.application_pre_launch_content TO service_role;

ALTER TABLE public.application_pre_launch_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pre-launch content is publicly readable" ON public.application_pre_launch_content;
CREATE POLICY "Pre-launch content is publicly readable"
  ON public.application_pre_launch_content FOR SELECT
  TO anon, authenticated
  USING (true);

-- === Authorized test users (per application, admin-granted) ===
-- Mirrors ad_trusted_advertisers exactly: composite (user_id, app_id) key,
-- grant is per-application (test access granted for one application says
-- nothing about any other), own-row-readable, service_role-writable only.
CREATE TABLE IF NOT EXISTS public.application_test_users (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_application_test_users_app ON public.application_test_users(app_id);

GRANT SELECT ON public.application_test_users TO authenticated;
GRANT ALL ON public.application_test_users TO service_role;

ALTER TABLE public.application_test_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own test-user grants" ON public.application_test_users;
CREATE POLICY "Users can view their own test-user grants"
  ON public.application_test_users FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
