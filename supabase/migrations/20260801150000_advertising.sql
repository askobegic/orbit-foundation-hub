-- Priority 8.4: Advertising.
--
-- Gated on the existing 'advertising' capability (seeded in
-- 20260801100000_capabilities_and_audit_reason.sql) -- an application
-- without that capability enabled has no placements to buy, nothing to
-- render, no admin action available.
--
-- Pricing is a replaceable strategy, not a hardcoded model. Only
-- 'fixed_duration' is implemented this phase (approved: do not implement
-- CPM/CPC/credit-ledger/usage-based billing now) -- but the vocabulary
-- lives in a registry (ad_pricing_strategies), and ad_placement_prices
-- doesn't encode any fixed-duration-specific shape beyond duration_days,
-- so a future strategy can be added as data + a new resolver without
-- touching ad_campaigns or the payment webhooks.
--
-- Moderation mode and advertiser eligibility are both configurable
-- (global default in ad_config, optional per-application override in
-- ad_application_settings) rather than hardcoded -- see
-- PROJECT_KNOWLEDGE.md -> Advertising for the resolution order.

-- === Registries (soft lifecycle, admin-extensible, no deployment needed) ===

CREATE TABLE IF NOT EXISTS public.ad_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ad_placements TO anon, authenticated;
GRANT ALL ON public.ad_placements TO service_role;
ALTER TABLE public.ad_placements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ad placements are publicly readable" ON public.ad_placements;
CREATE POLICY "Ad placements are publicly readable"
  ON public.ad_placements FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.ad_placements (key, label, display_order) VALUES
  ('hero_banner', 'Hero Banner', 10),
  ('sidebar_banner', 'Sidebar Banner', 20),
  ('profile_footer', 'Profile Footer', 30)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ad_pricing_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ad_pricing_strategies TO anon, authenticated;
GRANT ALL ON public.ad_pricing_strategies TO service_role;
ALTER TABLE public.ad_pricing_strategies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ad pricing strategies are publicly readable" ON public.ad_pricing_strategies;
CREATE POLICY "Ad pricing strategies are publicly readable"
  ON public.ad_pricing_strategies FOR SELECT TO anon, authenticated USING (true);

-- Only 'fixed_duration' has an actual resolver implemented this phase --
-- see the header comment above.
INSERT INTO public.ad_pricing_strategies (key, label, display_order) VALUES
  ('fixed_duration', 'Fixed Duration', 10)
ON CONFLICT (key) DO NOTHING;

-- === Price list: global (app_id NULL) or per-application override ===

CREATE TABLE IF NOT EXISTS public.ad_placement_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  placement_key text REFERENCES public.ad_placements(key) ON DELETE CASCADE NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_ad_placement_prices_lookup
  ON public.ad_placement_prices(placement_key, app_id);

GRANT SELECT ON public.ad_placement_prices TO anon, authenticated;
GRANT ALL ON public.ad_placement_prices TO service_role;
ALTER TABLE public.ad_placement_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ad placement prices are publicly readable" ON public.ad_placement_prices;
CREATE POLICY "Ad placement prices are publicly readable"
  ON public.ad_placement_prices FOR SELECT TO anon, authenticated USING (true);

-- === Global config + per-application override ===
-- Not publicly readable -- both moderation_mode and eligibility_rule are
-- only ever consulted server-side (checkout/moderation logic), matching
-- audit_logs' service_role-only precedent for admin-facing settings that
-- have no legitimate client read path.

CREATE TABLE IF NOT EXISTS public.ad_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ad_config TO service_role;
ALTER TABLE public.ad_config ENABLE ROW LEVEL SECURITY;

INSERT INTO public.ad_config (key, value, description) VALUES
  ('moderation_mode', '"manual"', 'Global default: manual | auto | trusted_only'),
  ('eligibility_rule', '"anyone"', 'Global default: anyone | premium_only | verified_only | trusted_only')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ad_application_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL UNIQUE,
  moderation_mode text CHECK (moderation_mode IN ('manual','auto','trusted_only')),
  eligibility_rule text CHECK (eligibility_rule IN ('anyone','premium_only','verified_only','trusted_only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.ad_application_settings TO service_role;
ALTER TABLE public.ad_application_settings ENABLE ROW LEVEL SECURITY;

-- === Trusted advertisers: plain allow-list, same shape as user_roles ===

CREATE TABLE IF NOT EXISTS public.ad_trusted_advertisers (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ad_trusted_advertisers TO authenticated;
GRANT ALL ON public.ad_trusted_advertisers TO service_role;
ALTER TABLE public.ad_trusted_advertisers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own trusted-advertiser status" ON public.ad_trusted_advertisers;
CREATE POLICY "Users can view their own trusted-advertiser status"
  ON public.ad_trusted_advertisers FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- === Campaigns ===

CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL,
  placement_key text REFERENCES public.ad_placements(key) NOT NULL,
  placement_price_id uuid REFERENCES public.ad_placement_prices(id) ON DELETE SET NULL,
  title text NOT NULL,
  image_url text,
  link_url text,
  starts_at timestamptz,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','ended','cancelled')),
  moderation_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (link_url IS NULL OR link_url ~ '^https?://')
);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_user ON public.ad_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_serving ON public.ad_campaigns(app_id, placement_key, status);

GRANT SELECT ON public.ad_campaigns TO authenticated;
GRANT ALL ON public.ad_campaigns TO service_role;
ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own campaigns" ON public.ad_campaigns;
CREATE POLICY "Users can view their own campaigns"
  ON public.ad_campaigns FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
-- Not publicly readable -- ad serving goes through the getActivePlacementAd
-- server function (service_role), matching the has_any_active_premium
-- precedent of not exposing a trust-sensitive table directly to anon.

-- === Advertising account credits: append-only ledger, signed amounts ===
-- Positive rows are Rewards-redemption fulfillments (see
-- adminFulfillAdvertisingCreditRedemption); negative rows are campaign
-- purchases consuming available credit as a discount. Balance = SUM(amount),
-- must never be allowed to go negative -- enforced by application logic
-- (checkout only ever debits up to the current balance), not a DB
-- constraint, since a single ledger row is not itself required to be
-- non-negative here (unlike reward_ledger).

CREATE TABLE IF NOT EXISTS public.ad_account_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  source text NOT NULL CHECK (source IN ('reward_redemption','campaign_purchase','admin_adjustment')),
  source_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_account_credits_user ON public.ad_account_credits(user_id);

GRANT SELECT ON public.ad_account_credits TO authenticated;
GRANT ALL ON public.ad_account_credits TO service_role;
ALTER TABLE public.ad_account_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own ad account credits" ON public.ad_account_credits;
CREATE POLICY "Users can view their own ad account credits"
  ON public.ad_account_credits FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- === Reuse the existing payments/billing engine for campaign checkout ===
-- One billing engine, not a parallel ad_payments table (Single Source of
-- Truth) -- campaign_id is nullable and mutually exclusive in practice
-- with subscription_id, exactly mirroring how subscription_id already
-- works on this table.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.ad_campaigns(id) ON DELETE SET NULL;

-- === Give the "Advertising Credit" reward catalog item a real value ===
-- Seeded in 20260801120000_rewards_and_loyalty.sql with grant_value '{}'
-- (Advertising didn't exist yet to define what it meant). Admin-editable
-- from here on via adminUpsertRewardCatalogItem, same as any other catalog
-- field.

UPDATE public.reward_catalog
SET grant_value = '{"amount": 20, "currency": "EUR"}'::jsonb
WHERE key = 'advertising_credit' AND grant_value = '{}'::jsonb;

-- === Storage: campaign banner uploads, same core bucket, new folder prefix ===
-- Tier 1 (existing Supabase Storage) for now -- Tier 2 provider not yet
-- chosen (see PROJECT_KNOWLEDGE.md -> Media Strategy). The upload layer
-- (src/lib/media-storage.ts) is written as a provider abstraction so
-- swapping the backing store later doesn't touch campaign/business logic.

DROP POLICY IF EXISTS "Users upload own campaign banners in core" ON storage.objects;
CREATE POLICY "Users upload own campaign banners in core" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'core'
    AND (storage.foldername(name))[1] = 'advertising'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users update own campaign banners in core" ON storage.objects;
CREATE POLICY "Users update own campaign banners in core" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'core'
    AND (storage.foldername(name))[1] = 'advertising'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own campaign banners in core" ON storage.objects;
CREATE POLICY "Users delete own campaign banners in core" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'core'
    AND (storage.foldername(name))[1] = 'advertising'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
-- Public read of core/advertising/... is already covered by the existing
-- "Core bucket is publicly readable" policy (bucket-wide), so no new SELECT
-- policy is needed here.
