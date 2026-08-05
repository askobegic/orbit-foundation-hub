-- Priority 8.7: Final CORE Audit Resolution -- data-only fixes.
--
-- R-9: normalize any already-stored mixed-case application domain to
-- lowercase, matching the Application Resolver's own lowercase exact-match
-- lookup (extractHostname()) and the now-normalizing admin write schema
-- (domainSchema in admin.functions.ts). Purely a data-consistency fix --
-- no application relying on an already-correct lowercase domain is
-- affected.
UPDATE public.applications
SET domain = lower(domain)
WHERE domain IS NOT NULL AND domain <> lower(domain);

-- R-11: 'premium' is a mandatory, always-on CORE feature (every
-- application automatically gets billing/Premium -- see
-- PROJECT_KNOWLEDGE.md -> Core Responsibilities) that was never actually
-- gated by anything (confirmed during the Priority 8.6 audit: no
-- dashboard widget, route, or server function ever calls
-- getApplicationCapabilities() and checks for "premium"). Leaving it in
-- capability_definitions' active vocabulary is misleading -- it looks
-- like a togglable module when disabling it does nothing. Archived, not
-- deleted, matching the soft-lifecycle convention every registry table
-- here follows; an archived definition already always wins over any
-- per-application application_capabilities row (see Capabilities in
-- PROJECT_KNOWLEDGE.md), so this can never silently start being enforced
-- by a stray per-app row either.
UPDATE public.capability_definitions
SET archived = true, updated_at = now()
WHERE key = 'premium';

-- 'messaging', by contrast, becomes a genuinely enforced capability as of
-- this same migration (Priority 8.7, R-2) -- see the new 'messaging'
-- dashboard_widgets row below, which is what DashboardPage.tsx's nav now
-- conditionally renders from, exactly like 'rewards'/'advertising'.
INSERT INTO public.dashboard_widgets (key, label, requires_capability, display_order) VALUES
  ('messaging', 'Messaging', 'messaging', 15)
ON CONFLICT (key) DO NOTHING;
