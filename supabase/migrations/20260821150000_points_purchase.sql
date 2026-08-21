-- CORE Rewards / Points Purchase -- extends the EXISTING Rewards & Loyalty
-- system (Priority 8.3/12/16) so a user can optionally buy Points with
-- real money. There is still exactly one Points balance/ledger
-- (reward_ledger, unchanged schema) -- this migration adds only what's
-- genuinely missing: a purchasable-package catalog and a FK letting a
-- `payments` row identify which package (if any) it paid for, mirroring
-- `payments.subscription_id`/`campaign_id` exactly. Purchased Points are
-- just another reward_ledger row (a new `origin` value, 'points_purchase'),
-- so every existing balance computation, spend/redemption rule, and
-- Points->Premium conversion path already works for them with zero code
-- changes -- see PROJECT_KNOWLEDGE.md -> Points Purchase.

-- ============================================================
-- 1. points_packages -- the purchasable catalog, same shape/conventions as
--    subscription_plans/ad_placement_prices (app_id nullable + static
--    Stripe/PayPal Payment Links -- this codebase has no dynamic Checkout
--    Session creation anywhere).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.points_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: a package is a CORE-native product, not owned by any one
  -- application, but may be branded/sold through a specific application's
  -- checkout context -- same nullable app_id subscription_plans already
  -- has, same reasoning.
  app_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,

  name text NOT NULL,
  description text,
  price numeric NOT NULL CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  points_amount integer NOT NULL CHECK (points_amount > 0),
  bonus_points integer NOT NULL DEFAULT 0 CHECK (bonus_points >= 0),

  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  valid_from timestamptz,
  valid_until timestamptz,
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
  -- Null = unlimited. Enforced server-side at purchase-reference creation
  -- (createPointsPurchaseReference), counting prior successful payments
  -- for this package -- no new counter column, matching the existing
  -- "count from payments/reward_ledger, don't maintain a duplicate
  -- counter" convention this codebase already uses throughout.
  purchase_limit_per_user integer CHECK (purchase_limit_per_user > 0),

  stripe_payment_link text,
  paypal_payment_link text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_points_packages_active
  ON public.points_packages(is_active) WHERE is_active = true;

GRANT SELECT ON public.points_packages TO authenticated, anon;
GRANT ALL ON public.points_packages TO service_role;
ALTER TABLE public.points_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Active points packages are publicly readable" ON public.points_packages;
CREATE POLICY "Active points packages are publicly readable"
  ON public.points_packages FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "Admins manage points packages" ON public.points_packages;
CREATE POLICY "Admins manage points packages"
  ON public.points_packages FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 2. payments gains points_package_id, mirroring subscription_id/
--    campaign_id exactly -- which package (if any) this payment was for.
-- ============================================================

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS points_package_id uuid
  REFERENCES public.points_packages(id) ON DELETE SET NULL;

-- ============================================================
-- 3. reward_ledger.origin gains 'points_purchase' -- the ledger already
--    distinguishes source via `origin` (spec section 33's "the ledger must
--    preserve the source" requirement is already met by this existing
--    column); refund reversal reuses the existing 'refund_reversal' origin
--    and reversePaymentPoints() unchanged (see src/lib/rewards.server.ts)
--    -- it already reverses proportionally to any payment's reward_ledger
--    grant via resource_type='payment'/resource_id=payments.id, with zero
--    new code required for this to also cover a Points purchase refund.
-- ============================================================

ALTER TABLE public.reward_ledger DROP CONSTRAINT IF EXISTS reward_ledger_origin_check;
ALTER TABLE public.reward_ledger ADD CONSTRAINT reward_ledger_origin_check
  CHECK (origin IN ('core', 'application', 'api', 'n8n', 'manual_admin', 'system', 'refund_reversal', 'points_purchase'));

-- ============================================================
-- 4. reward_config gains buy_points_enabled -- the CORE-level "Buy Points:
--    ON/OFF" switch, same key/value table every other Rewards config
--    value already lives in.
-- ============================================================

INSERT INTO public.reward_config (key, value, description) VALUES
  ('buy_points_enabled', 'false', 'Global switch for purchasing Points packages with real money. OFF: no new purchases; existing purchased/earned Points and history are unaffected.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 5. Seed: the "Need more Points?" Dashboard Action (existing
--    dashboard_actions system, reused unmodified, same as Affiliate's
--    seeded row above). Admin keeps this in sync with buy_points_enabled
--    manually (enabled/disabled), the same way every other
--    dashboard_actions row is admin-toggled -- no new automatic
--    config-to-visibility coupling was introduced for this.
-- ============================================================

INSERT INTO public.dashboard_actions (
  action_type, target_type, target_segment,
  title_bs, title_en, title_de, description_bs, description_en, description_de,
  cta_bs, cta_en, cta_de, icon, destination, display_order, enabled
) VALUES (
  'offer', 'segment', 'all',
  'Treba ti više Points-a?', 'Need more Points?', 'Brauchst du mehr Points?',
  'Ubrzaj svoj napredak -- kupi Points paket odmah.',
  'Speed up your progress -- buy a Points package now.',
  'Beschleunige deinen Fortschritt -- kaufe jetzt ein Points-Paket.',
  'Kupi Points', 'Buy Points', 'Points kaufen',
  '⚡', '/dashboard/rewards', 16, false
);
