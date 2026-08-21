-- Universal CORE Affiliate System -- new CORE-wide capability.
--
-- CORE owns Affiliate infrastructure (eligibility, tracking, attribution,
-- commission ledger, status) but never becomes owner of an originating
-- application's product/service, order, payment, fulfillment, or refund --
-- the application remains responsible for its own business logic and
-- reports its own confirmed transactions to CORE (POST /v1/affiliate/
-- conversions). CORE-native offers (Premium, Advertising, future CORE
-- products) are recorded the same way, from server-verified payment
-- webhook code calling the same internal function directly -- one
-- conversion-recording path, two callers, never two implementations.
--
-- Reuses rather than duplicates: `capability_definitions`/
-- `application_capabilities` (Priority 8.1) for per-application Affiliate
-- ON/OFF -- no new per-app toggle table; `offer_segments`-style trilingual
-- catalog conventions already established by dashboard_offers/
-- dashboard_actions; `resource_references` (Priority 21) for "has this
-- user become an Affiliate" -- becoming an Affiliate is exposed to the
-- Dashboard as a resource, so the existing "Postani Affiliate" /
-- dashboard_actions.requires_missing_resource_type mechanism works
-- unmodified; `notifications`/`sendNotification` (unchanged) for every
-- Affiliate notification; `writeAuditLog`/`assertAdmin` (unchanged) for
-- every admin mutation.

-- ============================================================
-- 0. resource_references.app_id -> nullable.
--    A prerequisite, not a separate feature: "became an Affiliate" is a
--    CORE-wide resource (Affiliate is not scoped to one application), but
--    the table this codebase already has for "a resource a user owns"
--    (Priority 21) required app_id NOT NULL. That table has no real
--    production rows yet (created in the immediately preceding task), so
--    loosening this single constraint is safe -- purely additive, not a
--    narrowing, and every existing reader (getMyResourceReferences,
--    resolveMyDashboardActions' requires_missing_resource_type match,
--    DashboardActions.tsx's MyResources rendering) already treats a
--    missing/null `applications` join as a normal case via optional
--    chaining, so nothing existing breaks.
-- ============================================================

ALTER TABLE public.resource_references ALTER COLUMN app_id DROP NOT NULL;

-- ============================================================
-- 1. affiliate_config -- global switches, same key/value shape as
--    reward_config/ad_config/trial_policy/engagement_config/members_config.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.affiliate_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.affiliate_config TO authenticated;
GRANT ALL ON public.affiliate_config TO service_role;
ALTER TABLE public.affiliate_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Affiliate config is publicly readable" ON public.affiliate_config;
CREATE POLICY "Affiliate config is publicly readable"
  ON public.affiliate_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage affiliate config" ON public.affiliate_config;
CREATE POLICY "Admins manage affiliate config"
  ON public.affiliate_config FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.affiliate_config (key, value, description) VALUES
  ('enabled', 'false', 'Global Affiliate Program switch. OFF: no new registrations, no new promotion links, active catalog unavailable for new promotion. Historical data is never affected.'),
  ('default_attribution_window_days', '30', 'Default days a click remains valid for attribution when an offer does not override it.'),
  ('default_return_period_days', '14', 'Default days after a conversion before its commission is treated as approved (refund/return window), when an offer does not override it.'),
  ('payout_threshold_eur', '50', 'Minimum approved balance (EUR) required before a payout batch is created for an Affiliate.'),
  ('payout_cycle_day_of_month', '1', 'Day of month the automatic monthly payout sweep is intended to run (informational -- the actual trigger is an external scheduler, see PROJECT_KNOWLEDGE.md -> Affiliate System).')
ON CONFLICT (key) DO NOTHING;

-- Per-application Affiliate ON/OFF reuses Capabilities (Priority 8.1)
-- exactly -- no new per-app toggle table. Enabling this capability for an
-- application makes that application's own products eligible to appear
-- in Affiliate offers; it does not by itself create any offer.
INSERT INTO public.capability_definitions (key, label, display_order) VALUES
  ('affiliate', 'Affiliate Program', 100)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. affiliates -- one row per user who has ever become an Affiliate.
--    Absence of a row IS the NOT_AFFILIATE state -- not a stored value,
--    the same "absence means doesn't have it" convention entitlements/
--    promotional_trials already use.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.affiliates (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
  -- Free-text payout destination (e.g. "PayPal: name@example.com" or an
  -- IBAN) -- deliberately not a structured payment-method system: no real
  -- automated payout provider is integrated in this codebase (see
  -- affiliate_payouts below), so a rigid schema for it would be
  -- speculative. Visible to the Affiliate (own row) and Admin only.
  payout_notes text,
  suspended_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.affiliates TO authenticated;
GRANT ALL ON public.affiliates TO service_role;
ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own affiliate status" ON public.affiliates;
CREATE POLICY "Users can view their own affiliate status"
  ON public.affiliates FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins manage affiliates" ON public.affiliates;
CREATE POLICY "Admins manage affiliates"
  ON public.affiliates FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 3. affiliate_offers -- the Admin-approved catalog. Every offer must be
--    explicitly activated; OFF by default (enabled defaults false, unlike
--    every other CORE catalog in this codebase, per the explicit "Affiliate
--    is OFF by default unless the Admin enables it" requirement).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.affiliate_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  source_type text NOT NULL CHECK (source_type IN ('core', 'application')),
  source_app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  CHECK (
    (source_type = 'core') OR (source_type = 'application' AND source_app_id IS NOT NULL)
  ),
  -- Generic product reference -- 'subscription_plan'/'ad_placement_price'
  -- for source_type='core' (resolved server-side via the existing
  -- polymorphic resolveProduct(), reused from offers.functions.ts, never a
  -- second price-lookup implementation); an application-defined string for
  -- source_type='application' (CORE never resolves or stores that
  -- product's price -- the application reports its own eligible amount at
  -- conversion time, per PROJECT_KNOWLEDGE.md -> Affiliate System).
  source_product_type text NOT NULL,
  source_product_id text NOT NULL,

  title_bs text NOT NULL,
  title_en text NOT NULL,
  title_de text NOT NULL,
  description_bs text,
  description_en text,
  description_de text,
  -- Where "Promoviraj" sends a non-affiliate visitor when no click/offer
  -- context applies (informational only -- the real promotion links are
  -- per-affiliate, see affiliate_links).
  destination_url text NOT NULL,

  commission_type text NOT NULL CHECK (commission_type IN ('percent', 'fixed')),
  commission_rate numeric CHECK (commission_rate > 0 AND commission_rate <= 100),
  commission_fixed_amount numeric CHECK (commission_fixed_amount >= 0),
  CHECK (
    (commission_type = 'percent' AND commission_rate IS NOT NULL AND commission_fixed_amount IS NULL)
    OR
    (commission_type = 'fixed' AND commission_fixed_amount IS NOT NULL AND commission_rate IS NULL)
  ),
  currency text NOT NULL DEFAULT 'EUR',

  -- Null = use affiliate_config's default_* value at evaluation time, so a
  -- later platform-wide default change also applies to offers that never
  -- set their own override -- the same "global row / per-offer override"
  -- convention used throughout this codebase.
  attribution_window_days integer CHECK (attribution_window_days > 0),
  return_period_days integer CHECK (return_period_days >= 0),

  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_offers_live
  ON public.affiliate_offers(enabled, archived) WHERE enabled = true AND archived = false;
CREATE INDEX IF NOT EXISTS idx_affiliate_offers_source
  ON public.affiliate_offers(source_type, source_app_id, source_product_type, source_product_id);

GRANT SELECT ON public.affiliate_offers TO authenticated;
GRANT ALL ON public.affiliate_offers TO service_role;
ALTER TABLE public.affiliate_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Active affiliate offers are publicly readable" ON public.affiliate_offers;
CREATE POLICY "Active affiliate offers are publicly readable"
  ON public.affiliate_offers FOR SELECT TO authenticated
  USING (enabled = true AND archived = false);
DROP POLICY IF EXISTS "Admins manage affiliate offers" ON public.affiliate_offers;
CREATE POLICY "Admins manage affiliate offers"
  ON public.affiliate_offers FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 4. affiliate_links -- one per (affiliate, offer), created lazily on
--    first "Promoviraj". `code` is the non-guessable referral identifier
--    exposed in the share link; no internal id is ever exposed.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.affiliate_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES public.affiliate_offers(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_user_id, offer_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_links_code ON public.affiliate_links(code);

GRANT SELECT ON public.affiliate_links TO authenticated;
GRANT ALL ON public.affiliate_links TO service_role;
ALTER TABLE public.affiliate_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Affiliates can view their own links" ON public.affiliate_links;
CREATE POLICY "Affiliates can view their own links"
  ON public.affiliate_links FOR SELECT TO authenticated USING (affiliate_user_id = auth.uid());
DROP POLICY IF EXISTS "Admins manage affiliate links" ON public.affiliate_links;
CREATE POLICY "Admins manage affiliate links"
  ON public.affiliate_links FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 5. affiliate_clicks -- minimal, non-surveillance click log: which link,
--    when. No IP, no user-agent, no unrelated behavior.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.affiliate_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.affiliate_links(id) ON DELETE CASCADE,
  clicked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_link ON public.affiliate_clicks(link_id, clicked_at DESC);

GRANT ALL ON public.affiliate_clicks TO service_role;
ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;
-- No authenticated SELECT/INSERT policy: clicks are written by the public
-- redirect route (service_role, since the visitor is often anonymous) and
-- read only through getMyAffiliateDashboard()'s aggregate count (also
-- service_role) or by Admin -- never raw per-click rows to a non-admin
-- user, matching "keep analytics focused" (spec section 27).
DROP POLICY IF EXISTS "Admins view affiliate clicks" ON public.affiliate_clicks;
CREATE POLICY "Admins view affiliate clicks"
  ON public.affiliate_clicks FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 6. affiliate_pending_attributions -- bridges "which affiliate code was
--    active when this user started a CORE-native checkout" to "the later,
--    separate webhook confirmation" for CORE-owned offers (Premium,
--    purchasable Points). This codebase has no dynamic Checkout Session
--    creation (static, admin-configured Stripe/PayPal Payment Links only
--    -- see payment-reference.server.ts), so there is no channel to carry
--    an affiliate code through the payment provider itself; this table is
--    that channel instead. Application-reported conversions (POST /v1/
--    affiliate/conversions) don't need this at all -- the application
--    reports its own referral code directly in that same call.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.affiliate_pending_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_product_type text NOT NULL,
  source_product_id text NOT NULL,
  affiliate_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_pending_lookup
  ON public.affiliate_pending_attributions(user_id, source_product_type, source_product_id, created_at DESC);

GRANT ALL ON public.affiliate_pending_attributions TO service_role;
ALTER TABLE public.affiliate_pending_attributions ENABLE ROW LEVEL SECURITY;
-- service_role only -- written by the authenticated user's own server
-- function call (service_role-backed) at checkout start, consumed by the
-- webhook. Never directly readable/writable by a client role.

-- ============================================================
-- 7. affiliate_payouts -- created first so affiliate_conversions.payout_id
--    can reference it. Automatic *batching* (see runAffiliatePayoutSweep,
--    src/lib/affiliate.server.ts); actually marking a batch 'paid' requires
--    a human/admin step today, since no automated external payout
--    provider is integrated in this codebase (spec section 23) -- this is
--    documented, not silently implied as fully automated.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.affiliate_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  payout_reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_affiliate_payouts_affiliate ON public.affiliate_payouts(affiliate_user_id, created_at DESC);

GRANT SELECT ON public.affiliate_payouts TO authenticated;
GRANT ALL ON public.affiliate_payouts TO service_role;
ALTER TABLE public.affiliate_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Affiliates can view their own payouts" ON public.affiliate_payouts;
CREATE POLICY "Affiliates can view their own payouts"
  ON public.affiliate_payouts FOR SELECT TO authenticated USING (affiliate_user_id = auth.uid());
DROP POLICY IF EXISTS "Admins manage affiliate payouts" ON public.affiliate_payouts;
CREATE POLICY "Admins manage affiliate payouts"
  ON public.affiliate_payouts FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 8. affiliate_conversions -- the commission ledger. A conversion is only
--    ever created once a real transaction is confirmed (server-verified
--    payment webhook, or an application's own confirmed-transaction
--    report) -- a click alone never creates a row here. `transaction_ref`
--    is UNIQUE, the idempotency guarantee: the same originating
--    transaction can produce at most one conversion, ever (spec section
--    26). Every commission-affecting value is a SNAPSHOT, taken once at
--    conversion time -- a later Admin change to the offer's commission
--    rate never retroactively changes an existing conversion (spec
--    section 13). Append-only in spirit: a reversal of an
--    already-paid conversion creates a NEW negative row
--    (reversed_conversion_id) rather than mutating the original; a
--    not-yet-paid conversion is reversed in place (status='reversed'),
--    since nothing was ever paid out for it to misstate.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.affiliate_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES public.affiliate_offers(id) ON DELETE RESTRICT,
  link_id uuid REFERENCES public.affiliate_links(id) ON DELETE SET NULL,
  click_id uuid REFERENCES public.affiliate_clicks(id) ON DELETE SET NULL,
  -- The customer/buyer -- needed for self-referral protection (must differ
  -- from affiliate_user_id) and duplicate-transaction detection.
  converted_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source_app_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,

  transaction_ref text NOT NULL UNIQUE,

  eligible_amount numeric NOT NULL CHECK (eligible_amount >= 0),
  currency text NOT NULL,
  commission_type text NOT NULL CHECK (commission_type IN ('percent', 'fixed')),
  commission_rate numeric,
  commission_fixed_amount numeric,
  commission_amount numeric NOT NULL CHECK (commission_amount >= 0),
  return_period_days integer NOT NULL,

  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'reversed')),
  payout_id uuid REFERENCES public.affiliate_payouts(id) ON DELETE SET NULL,

  reversed_at timestamptz,
  reversed_reason text,
  reversed_conversion_id uuid REFERENCES public.affiliate_conversions(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_affiliate
  ON public.affiliate_conversions(affiliate_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affiliate_conversions_payout
  ON public.affiliate_conversions(payout_id) WHERE payout_id IS NOT NULL;

GRANT SELECT ON public.affiliate_conversions TO authenticated;
GRANT ALL ON public.affiliate_conversions TO service_role;
ALTER TABLE public.affiliate_conversions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Affiliates can view their own conversions" ON public.affiliate_conversions;
CREATE POLICY "Affiliates can view their own conversions"
  ON public.affiliate_conversions FOR SELECT TO authenticated USING (affiliate_user_id = auth.uid());
DROP POLICY IF EXISTS "Admins manage affiliate conversions" ON public.affiliate_conversions;
CREATE POLICY "Admins manage affiliate conversions"
  ON public.affiliate_conversions FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 9. notifications.category gains 'affiliate' -- purely additive,
--    alongside the existing information/reward/premium/offer/warning/
--    system/message/inactivity vocabulary (Priority 15D/19).
-- ============================================================

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IS NULL OR category IN
    ('information', 'reward', 'premium', 'offer', 'warning', 'system', 'message', 'inactivity', 'affiliate'));

-- ============================================================
-- 10. Seed: the "Postani Affiliate" Dashboard Action (Priority 21's
--     existing dashboard_actions system, reused unmodified) -- shown only
--     to a user with no 'affiliate_account' resource_references row (see
--     src/lib/affiliate.server.ts's becomeAffiliate(), which creates that
--     resource the moment someone becomes an Affiliate; once created, the
--     existing "My Resources" section already shows it -- no second,
--     "Moj Affiliate" dashboard_actions row is needed).
-- ============================================================

INSERT INTO public.dashboard_actions (
  action_type, target_type, target_segment, requires_missing_resource_type,
  title_bs, title_en, title_de, description_bs, description_en, description_de,
  cta_bs, cta_en, cta_de, icon, destination, display_order, enabled
) VALUES (
  'discovery', 'segment', 'all', 'affiliate_account',
  'Postani Affiliate', 'Become an Affiliate', 'Werde Affiliate',
  'Preporuči odabrane proizvode i usluge i ostvari proviziju.',
  'Recommend selected products and services and earn commission.',
  'Empfiehl ausgewählte Produkte und Dienstleistungen und verdiene Provision.',
  'Postani Affiliate', 'Become an Affiliate', 'Werde Affiliate',
  '🤝', '/dashboard/affiliate', 15, false
);
