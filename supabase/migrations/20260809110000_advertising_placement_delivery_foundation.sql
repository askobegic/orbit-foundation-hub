-- Priority 13, Phase D1: Universal Advertising Placement & Delivery Foundation.
--
-- Purely additive, per the approved D1 design proposal. Nothing existing is
-- renamed, dropped, or narrowed: ad_placements/ad_placement_prices/
-- ad_campaigns keep their exact current shape and behavior. This migration
-- gives Placement (WHERE on a page) and Channel/Target (WHICH destination)
-- a way to compose, without merging either concept or forking delivery.

-- === 1. ad_channels gains an optional pointer to the CORE application it
-- represents (only meaningful when channel_type_key = 'application') ===

ALTER TABLE public.ad_channels
  ADD COLUMN IF NOT EXISTS represents_app_id uuid REFERENCES public.applications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ad_channels_represents_app ON public.ad_channels(represents_app_id);

-- === 2. ad_application_placements: per-application placement configuration ===
-- Same division of responsibility as ad_channels/ad_channel_apps: ad_placements
-- stays the global "does this position concept exist" registry; this table is
-- "is it live, purchasable, and how, for THIS application." purchasable and
-- enabled are deliberately independent (see resolveApplicationPlacement in
-- advertising.server.ts) -- purchasable governs new sales only, enabled
-- governs delivery of everything, including already-active campaigns.

CREATE TABLE IF NOT EXISTS public.ad_application_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL,
  placement_key text REFERENCES public.ad_placements(key) ON DELETE CASCADE NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  purchasable boolean NOT NULL DEFAULT true,
  allowed_format_keys text[] NOT NULL DEFAULT '{}',
  supported_devices text[] NOT NULL DEFAULT '{desktop,mobile}',
  last_delivery_at timestamptz,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, placement_key)
);

CREATE INDEX IF NOT EXISTS idx_ad_application_placements_app ON public.ad_application_placements(app_id);
CREATE INDEX IF NOT EXISTS idx_ad_application_placements_placement ON public.ad_application_placements(placement_key);

GRANT SELECT ON public.ad_application_placements TO anon, authenticated;
GRANT ALL ON public.ad_application_placements TO service_role;
ALTER TABLE public.ad_application_placements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ad application placements are publicly readable" ON public.ad_application_placements;
CREATE POLICY "Ad application placements are publicly readable"
  ON public.ad_application_placements FOR SELECT TO anon, authenticated USING (true);
-- last_delivery_at is not sensitive (a bare timestamp) -- same public-catalog
-- read model already used by every sibling table in this module.

-- === 3. ad_campaign_targets gains an optional placement reference ===
-- Nullable: a social_media-channel target has no page position (n8n
-- publishes it as a post, never pulled through the delivery endpoint), so it
-- must remain valid with no placement at all.

ALTER TABLE public.ad_campaign_targets
  ADD COLUMN IF NOT EXISTS placement_key text REFERENCES public.ad_placements(key);

CREATE INDEX IF NOT EXISTS idx_ad_campaign_targets_delivery
  ON public.ad_campaign_targets(channel_id, placement_key, status);

-- === 4. Integration freshness window: admin-editable, not hardcoded ===
-- Same ad_config convention already used for draft_expiry_hours.

INSERT INTO public.ad_config (key, value, description) VALUES
  ('integration_freshness_hours', '24', 'Hours since last_delivery_at before a placement integration is considered stale rather than connected.')
ON CONFLICT (key) DO NOTHING;

-- === 5. Mandatory backfill ===
-- Without this, the new placement gate in getActivePlacementCreative would
-- silently zero out every currently-delivering legacy campaign the moment
-- this ships. For every real application, for every placement_key that
-- currently has at least one enabled, non-archived price applicable to that
-- application (either an app-specific ad_placement_prices row, or a global
-- one with app_id IS NULL -- exactly mirroring resolvePlacementPrices'
-- existing merge rule), insert an enabled+purchasable mapping row.

INSERT INTO public.ad_application_placements (app_id, placement_key, enabled, purchasable, allowed_format_keys, supported_devices)
SELECT DISTINCT a.id, p.placement_key, true, true, '{}'::text[], '{desktop,mobile}'::text[]
FROM public.applications a
CROSS JOIN (
  SELECT DISTINCT placement_key
  FROM public.ad_placement_prices
  WHERE enabled = true AND archived = false
) p
WHERE EXISTS (
  SELECT 1 FROM public.ad_placement_prices pp
  WHERE pp.placement_key = p.placement_key
    AND pp.enabled = true
    AND pp.archived = false
    AND (pp.app_id = a.id OR pp.app_id IS NULL)
)
ON CONFLICT (app_id, placement_key) DO NOTHING;
