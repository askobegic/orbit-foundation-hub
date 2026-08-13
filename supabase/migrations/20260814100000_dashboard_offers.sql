-- Dashboard Offers (Global + Individual) -- new CORE feature, Priority 17.
--
-- Global and Individual offers are conceptually distinct (per spec) but
-- share ~95% of their fields, so they're one table with an offer_type
-- discriminator rather than two near-duplicate tables -- the admin UI
-- still presents them as two separate sections, matching the "don't merge
-- conceptually" instruction without duplicating schema/CRUD scaffolding.
--
-- "product" is polymorphic (a subscription_plans row OR an
-- ad_placement_prices row) since both are real, existing purchasable
-- CORE products -- validated server-side at write time (no DB-level FK
-- possible across two tables), never trusted from the client at read
-- time either: resolveMyOffers() always re-derives the real product
-- price server-side, the discount is never computed client-side.

-- ============================================================
-- 1. Extensible target-segment registry (Global Offers only) --
--    same admin-extensible shape as capability_definitions/
--    entitlement_sources/trial_sources, so adding a future segment
--    (e.g. "new_users") never needs a deployment.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.offer_segments (
  key text PRIMARY KEY,
  label text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.offer_segments TO anon, authenticated;
GRANT ALL ON public.offer_segments TO service_role;
ALTER TABLE public.offer_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Offer segments are publicly readable" ON public.offer_segments;
CREATE POLICY "Offer segments are publicly readable"
  ON public.offer_segments FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.offer_segments (key, label, display_order) VALUES
  ('all', 'All Users', 10),
  ('standard', 'Standard Users', 20),
  ('premium', 'Premium Users', 30)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. dashboard_offers
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dashboard_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_type text NOT NULL CHECK (offer_type IN ('global', 'individual')),

  -- Global-only targeting (extensible registry above).
  target_segment text REFERENCES public.offer_segments(key),
  -- Individual-only targeting.
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,

  CHECK (
    (offer_type = 'global' AND target_segment IS NOT NULL AND target_user_id IS NULL)
    OR
    (offer_type = 'individual' AND target_user_id IS NOT NULL AND target_segment IS NULL)
  ),

  -- Polymorphic product reference -- validated server-side (see
  -- offers.functions.ts), not a real FK across two possible tables.
  product_type text NOT NULL CHECK (product_type IN ('subscription_plan', 'ad_placement_price')),
  product_id uuid NOT NULL,

  title_bs text NOT NULL,
  title_en text NOT NULL,
  title_de text NOT NULL,
  description_bs text,
  description_en text,
  description_de text,
  cta_bs text,
  cta_en text,
  cta_de text,
  badge_icon text,

  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'fixed_price')),
  discount_percent numeric CHECK (discount_percent > 0 AND discount_percent <= 100),
  fixed_price numeric CHECK (fixed_price >= 0),
  CHECK (
    (discount_type = 'percent' AND discount_percent IS NOT NULL AND fixed_price IS NULL)
    OR
    (discount_type = 'fixed_price' AND fixed_price IS NOT NULL AND discount_percent IS NULL)
  ),

  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at),

  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_offers_individual
  ON public.dashboard_offers(target_user_id) WHERE offer_type = 'individual';
CREATE INDEX IF NOT EXISTS idx_dashboard_offers_global
  ON public.dashboard_offers(target_segment) WHERE offer_type = 'global';
CREATE INDEX IF NOT EXISTS idx_dashboard_offers_window
  ON public.dashboard_offers(starts_at, ends_at) WHERE enabled = true AND archived = false;

GRANT SELECT ON public.dashboard_offers TO authenticated;
GRANT ALL ON public.dashboard_offers TO service_role;
ALTER TABLE public.dashboard_offers ENABLE ROW LEVEL SECURITY;

-- Broad, safe SELECT boundary: an authenticated user may see any
-- non-archived, enabled global offer (segment matching, date-window
-- eligibility, and price/discount resolution all happen server-side in
-- resolveMyOffers() -- seeing that e.g. a Premium-segment offer exists is
-- no more sensitive than seeing any other public catalog row, like
-- reward_catalog already is) or their own individual offer. This is the
-- same "RLS is the safe boundary, business filtering is a server
-- function" split already used for event_rules/ad_placement_prices.
DROP POLICY IF EXISTS "Users can view eligible offers" ON public.dashboard_offers;
CREATE POLICY "Users can view eligible offers"
  ON public.dashboard_offers FOR SELECT TO authenticated
  USING (
    enabled = true AND archived = false
    AND (offer_type = 'global' OR target_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins manage dashboard offers" ON public.dashboard_offers;
CREATE POLICY "Admins manage dashboard offers"
  ON public.dashboard_offers FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
