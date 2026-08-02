-- Priority 8.2: Dashboard Widget Modularity.
--
-- Same registry + per-application-override shape as capability_definitions
-- / application_capabilities (Priority 8.1) -- deliberately reused rather
-- than inventing a second pattern for what is structurally the same
-- problem ("is X visible for this application, globally or by override").
-- See PROJECT_KNOWLEDGE.md -> Dashboard Widget Modularity.

CREATE TABLE IF NOT EXISTS public.dashboard_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  -- Dependency validation hook (adjustment 2): a widget tied to a not-yet-
  -- built capability (e.g. a future Rewards widget requiring the
  -- "rewards" capability) automatically disappears the moment that
  -- capability is disabled for the application, with no separate check
  -- anywhere else needing to remember to look at both flags.
  requires_capability text REFERENCES public.capability_definitions(key) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dashboard_widgets TO anon, authenticated;
GRANT ALL ON public.dashboard_widgets TO service_role;

ALTER TABLE public.dashboard_widgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dashboard widgets are publicly readable" ON public.dashboard_widgets;
CREATE POLICY "Dashboard widgets are publicly readable"
  ON public.dashboard_widgets FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS public.dashboard_widget_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_key text REFERENCES public.dashboard_widgets(key) ON DELETE CASCADE NOT NULL,
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL,
  enabled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (widget_key, app_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_widget_settings_app ON public.dashboard_widget_settings(app_id);

GRANT SELECT ON public.dashboard_widget_settings TO anon, authenticated;
GRANT ALL ON public.dashboard_widget_settings TO service_role;

ALTER TABLE public.dashboard_widget_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dashboard widget settings are publicly readable" ON public.dashboard_widget_settings;
CREATE POLICY "Dashboard widget settings are publicly readable"
  ON public.dashboard_widget_settings FOR SELECT
  TO anon, authenticated
  USING (true);

-- Seed the widgets that already exist as distinct sections in
-- DashboardPage.tsx today -- this migration modularizes real, shipped UI,
-- not a hypothetical one. display_order matches their current visual order.
INSERT INTO public.dashboard_widgets (key, label, display_order) VALUES
  ('trial_banner', 'Trial Banner', 10),
  ('my_applications', 'My Applications', 20),
  ('active_subscription', 'Active Subscription', 30),
  ('payment_history', 'Payment History', 40),
  ('quick_links', 'Quick Links', 50),
  ('share_and_invite', 'Share & Invite', 60)
ON CONFLICT (key) DO NOTHING;
