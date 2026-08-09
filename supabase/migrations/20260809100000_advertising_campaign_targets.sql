-- Priority 13, Phase D: Universal Advertising Distribution Network.
--
-- Purely additive. Nothing existing changes: ad_placements/ad_placement_prices/
-- ad_campaigns keep their exact current shape and behavior -- the single-app
-- banner-placement purchase remains the primary, unaffected product. This
-- phase adds the *pricing* for Phase C's channel registry and the
-- campaign-target model that lets one campaign span multiple additional
-- distribution channels. No checkout/payment wiring yet (Phase F) -- targets
-- are created and removed in 'draft' status only, exactly mirroring how
-- ad_campaigns itself starts as 'draft' before any payment exists.

-- === Channel prices: mirrors ad_placement_prices' shape ===
-- Unlike ad_placement_prices, there is no separate app_id column here --
-- ad_channels rows are already exact destinations (app scoping, where it
-- applies, lives on ad_channel_apps), so channel_id alone is the pricing
-- key. Payment-link columns are deliberately not added yet -- see
-- ad_placement_prices' own history (added in a later, separate migration,
-- 20260801160000_advertising_checkout_fields.sql, once checkout was wired)
-- -- the same sequencing applies here for Phase F.

CREATE TABLE IF NOT EXISTS public.ad_channel_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES public.ad_channels(id) ON DELETE CASCADE NOT NULL,
  pricing_strategy text REFERENCES public.ad_pricing_strategies(key) NOT NULL DEFAULT 'fixed_duration',
  duration_days integer NOT NULL CHECK (duration_days > 0),
  price numeric NOT NULL CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_channel_prices_channel ON public.ad_channel_prices(channel_id);

GRANT SELECT ON public.ad_channel_prices TO anon, authenticated;
GRANT ALL ON public.ad_channel_prices TO service_role;
ALTER TABLE public.ad_channel_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ad channel prices are publicly readable" ON public.ad_channel_prices;
CREATE POLICY "Ad channel prices are publicly readable"
  ON public.ad_channel_prices FOR SELECT TO anon, authenticated USING (true);

-- === Campaign targets: additional distribution channels layered onto an
-- existing campaign ===
-- A campaign's original app_id/placement_key/placement_price_id (the
-- existing banner product) are completely untouched by this table -- a
-- target is purely additive extra distribution, never a replacement. Status
-- is its own, richer per-target lifecycle (independent of ad_campaigns.status,
-- which keeps its existing 6-value vocabulary unchanged) since different
-- channel types naturally progress differently (e.g. a scheduled social post
-- vs. an immediately-active banner).

CREATE TABLE IF NOT EXISTS public.ad_campaign_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES public.ad_campaigns(id) ON DELETE CASCADE NOT NULL,
  channel_id uuid REFERENCES public.ad_channels(id) NOT NULL,
  channel_price_id uuid REFERENCES public.ad_channel_prices(id) NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','pending_payment','paid','pending_approval','approved',
    'scheduled','active','paused','completed','rejected','cancelled'
  )),
  starts_at timestamptz,
  expires_at timestamptz,
  external_reference text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  moderation_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_campaign_targets_campaign ON public.ad_campaign_targets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaign_targets_channel ON public.ad_campaign_targets(channel_id);

-- Prevent selecting the exact same channel+duration twice while still in
-- draft (the user simply already has it selected) -- partial, so it never
-- restricts the same channel being purchased again in a future campaign.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_campaign_targets_draft_unique
  ON public.ad_campaign_targets(campaign_id, channel_price_id)
  WHERE status = 'draft';

GRANT SELECT ON public.ad_campaign_targets TO authenticated;
GRANT ALL ON public.ad_campaign_targets TO service_role;
ALTER TABLE public.ad_campaign_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own campaign targets" ON public.ad_campaign_targets;
CREATE POLICY "Users can view their own campaign targets"
  ON public.ad_campaign_targets FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ad_campaigns c
      WHERE c.id = ad_campaign_targets.campaign_id AND c.user_id = auth.uid()
    )
  );
-- Not client-writable -- every insert/update/delete goes through a
-- server-validated function (service_role), matching ad_campaigns' own
-- access model exactly.
