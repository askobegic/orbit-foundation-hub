
-- Restore public.user_app_settings.
--
-- Migration 20260724200925 defines this table, and was marked "applied" in
-- an earlier bulk `migration repair --status applied` pass -- but the table
-- was confirmed (via direct live query) to not actually exist. Same root
-- cause as the missing private.has_role()/public.app_role objects: that
-- repair pass trusted partial evidence (profiles/applications structure)
-- rather than verifying every one of the 21 migrations individually.
--
-- This is a straight restoration of the original migration's content, not
-- a redesign -- identical table/policies/indexes. Unlike the storage
-- policy fix, this one does not reference private.has_role()/app_role, so
-- it applies cleanly via db push.

CREATE TABLE IF NOT EXISTS public.user_app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  is_contactable boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, app_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_app_settings TO authenticated;
GRANT SELECT ON public.user_app_settings TO anon;
GRANT ALL ON public.user_app_settings TO service_role;

ALTER TABLE public.user_app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own app settings" ON public.user_app_settings;
CREATE POLICY "Users manage own app settings"
  ON public.user_app_settings FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "App settings publicly readable" ON public.user_app_settings;
CREATE POLICY "App settings publicly readable"
  ON public.user_app_settings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_user_app_settings_user ON public.user_app_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_app_settings_app_visible ON public.user_app_settings(app_id, is_visible);
