-- Extends the existing Share & Invite / referral functionality (Dashboard
-- Share and Invite widget, ShareAndInvite.tsx) with per-application,
-- admin-configurable templates -- Configuration-First, same as every other
-- Priority 8 module: no marketing copy is hardcoded in the client.
--
-- Share is application-focused (a fixed title/description/URL an admin
-- sets once, not derived from whichever user happens to be sharing).
-- Invite is personal: the client fills {user_name} (the inviting user's
-- own display name) and {invite_link} (their existing `?ref=<username>`
-- referral link, unchanged from Priority 8.3) into an admin-authored
-- template.
--
-- One row per application, not a global-default + override pair like
-- ad_config/ad_application_settings -- Share is inherently
-- application-specific (a Share URL only ever makes sense for one
-- application), so there's no meaningful platform-wide default to
-- fall back to. Nothing here is NOT NULL: getShareInviteConfig returns
-- whatever is configured (nullable) and the client fills any gap with a
-- locale-aware fallback -- no server-side hardcoded English default.

CREATE TABLE IF NOT EXISTS public.share_invite_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL UNIQUE,
  share_title text,
  share_description text,
  share_url text,
  invite_template text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.share_invite_templates TO anon, authenticated;
GRANT ALL ON public.share_invite_templates TO service_role;

ALTER TABLE public.share_invite_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Share invite templates are publicly readable" ON public.share_invite_templates;
CREATE POLICY "Share invite templates are publicly readable"
  ON public.share_invite_templates FOR SELECT
  TO anon, authenticated
  USING (true);
