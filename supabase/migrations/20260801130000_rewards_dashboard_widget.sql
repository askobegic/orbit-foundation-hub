-- Priority 8.3: Rewards & Loyalty -- dashboard widget registration.
--
-- Separate migration from 20260801120000_rewards_and_loyalty.sql (already
-- applied) rather than editing it, matching this repo's "never edit an
-- applied migration" rule. Registers the Rewards Dashboard as a widget
-- gated on the 'rewards' capability (seeded in 20260801100000), so
-- disabling that capability for an application hides the widget with no
-- separate check needed anywhere else.

INSERT INTO public.dashboard_widgets (key, label, requires_capability, display_order) VALUES
  ('rewards', 'Rewards & Loyalty', 'rewards', 25)
ON CONFLICT (key) DO NOTHING;
