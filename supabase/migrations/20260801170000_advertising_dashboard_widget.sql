-- Priority 8.4: Advertising -- dashboard widget registration.
--
-- Separate migration from the Advertising schema migrations (already
-- applied) rather than editing them, matching this repo's "never edit an
-- applied migration" rule. Gated on the 'advertising' capability (seeded
-- in 20260801100000) -- same dependency-validation mechanism as the
-- 'rewards' widget added in Priority 8.3.

INSERT INTO public.dashboard_widgets (key, label, requires_capability, display_order) VALUES
  ('advertising', 'Advertising', 'advertising', 35)
ON CONFLICT (key) DO NOTHING;
