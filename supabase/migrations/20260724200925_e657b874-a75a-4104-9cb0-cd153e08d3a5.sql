CREATE TABLE public.user_app_settings (
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

CREATE POLICY "Users manage own app settings"
  ON public.user_app_settings FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "App settings publicly readable"
  ON public.user_app_settings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE INDEX idx_user_app_settings_user ON public.user_app_settings(user_id);
CREATE INDEX idx_user_app_settings_app_visible ON public.user_app_settings(app_id, is_visible);