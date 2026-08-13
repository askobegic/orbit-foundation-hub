-- Registers "Special Offers" in the existing Dashboard Widget Modularity
-- registry (Priority 8.2) -- same mechanism every other Dashboard section
-- already uses to be globally/per-application toggleable, not a new
-- visibility mechanism. No requires_capability: this is core Dashboard
-- functionality, same as my_applications/quick_links, not an optional
-- module gated behind a capability.

INSERT INTO public.dashboard_widgets (key, label, display_order) VALUES
  ('special_offers', 'Special Offers', 22)
ON CONFLICT (key) DO NOTHING;
