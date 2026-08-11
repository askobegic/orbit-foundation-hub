-- Priority 15 Phase C: generic Entitlements layer, Premium resolver
-- extension, redemption TOCTOU fix, and minimal rate limiting.
--
-- Architectural decision (C2, made from existing precedent, not a guess):
-- promotional_trials is NOT generalized into this new layer -- it stays
-- exactly as-is (its own admin UI, its own registry, its own one-active-
-- per-user constraint, already live and working). This new `entitlements`
-- table is a THIRD, independent source alongside subscriptions and
-- promotional_trials, added to the existing has_any_active_premium()/
-- resolvePremiumStatus() resolvers via OR, the same way promotional_trials
-- itself was added as a second source without ever becoming a
-- subscriptions row. Rewriting/migrating promotional_trials into this
-- table would touch live data and a working admin UI for zero functional
-- gain -- directly against "avoid unnecessary breaking changes."
--
-- entitlements is for DURATION/ACCESS benefits (Premium, VIP, feature
-- access) only -- NOT for monetary credit ledgers, which already have
-- their own correct, working append-only pattern (ad_account_credits).
-- A Mission/Challenge/Streak reward_grant_type of 'advertising_credit'
-- fulfills through ad_account_credits directly, never through this table.

-- ============================================================
-- 1. Entitlement source registry (same admin-extensible shape as
--    trial_sources -- "data, not code").
-- ============================================================

CREATE TABLE IF NOT EXISTS public.entitlement_sources (
  key text PRIMARY KEY,
  label text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.entitlement_sources TO anon, authenticated;
GRANT ALL ON public.entitlement_sources TO service_role;
ALTER TABLE public.entitlement_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Entitlement sources are publicly readable" ON public.entitlement_sources;
CREATE POLICY "Entitlement sources are publicly readable"
  ON public.entitlement_sources FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.entitlement_sources (key, label, display_order) VALUES
  ('admin_grant', 'Admin Grant', 10),
  ('mission_completion', 'Mission Completion', 20),
  ('challenge_completion', 'Challenge Completion', 30),
  ('streak_milestone', 'Streak Milestone', 40),
  ('reward_redemption', 'Reward Redemption', 50)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. reward_fulfillment_types gains grants_premium -- admin-configurable
--    ("Configuration First"), not a hardcoded type-name check anywhere in
--    application code. premium_duration already implies Premium; a new
--    'vip' type is added as a second premium-granting benefit alongside
--    it, matching the master spec's VIP example.
-- ============================================================

ALTER TABLE public.reward_fulfillment_types
  ADD COLUMN IF NOT EXISTS grants_premium boolean NOT NULL DEFAULT false;

UPDATE public.reward_fulfillment_types SET grants_premium = true WHERE key = 'premium_duration';

INSERT INTO public.reward_fulfillment_types (key, label, display_order, grants_premium) VALUES
  ('vip', 'VIP Status', 40, true),
  ('feature_access', 'Feature Access', 50, false)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 3. entitlements -- the generic layer itself.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  -- Reuses the EXISTING reward_fulfillment_types registry as the benefit
  -- vocabulary -- not a second, parallel "benefit type" enum (C5).
  benefit_type text REFERENCES public.reward_fulfillment_types(key) NOT NULL,
  -- Global/Application scope: same Phase A convention as event_rules --
  -- NULL = global (e.g. Premium, VIP), a specific application = scoped
  -- (e.g. a future application-specific feature benefit).
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL DEFAULT now(),
  -- Nullable = never expires. Expiration is deterministic and time-based
  -- only (ends_at > now(), checked live by every resolver) -- exactly
  -- like subscriptions/promotional_trials, no cron job flips status.
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'revoked')),
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text,
  source text REFERENCES public.entitlement_sources(key) NOT NULL,
  -- e.g. { "definitionId": "...", "definitionKey": "..." } for traceability
  -- back to the Mission/Challenge/Streak that granted it, when applicable.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- At most one ACTIVE entitlement per (user, benefit_type, scope) -- same
-- "no multiple active grants of the same thing" policy promotional_trials
-- already enforces at the database level. Granting again while one is
-- active is rejected outright by grantEntitlement() (see
-- entitlements.server.ts); the correct move is Extend, mirroring
-- promotional_trials' exact "never auto-extends" rule.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_one_active
  ON public.entitlements(user_id, benefit_type, COALESCE(app_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_entitlements_user ON public.entitlements(user_id);
-- The premium resolver's hot-path lookup: active, premium-granting
-- entitlements for a set of users.
CREATE INDEX IF NOT EXISTS idx_entitlements_active_lookup
  ON public.entitlements(user_id, benefit_type) WHERE status = 'active';

GRANT SELECT ON public.entitlements TO authenticated;
GRANT ALL ON public.entitlements TO service_role;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own entitlements" ON public.entitlements;
CREATE POLICY "Users can view their own entitlements"
  ON public.entitlements FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins manage entitlements" ON public.entitlements;
CREATE POLICY "Admins manage entitlements"
  ON public.entitlements FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 4. has_any_active_premium() gains a THIRD, independent source -- an
--    active, premium-granting entitlement. Never a competing resolver:
--    this is the same one function every surface already calls, extended
--    exactly the way promotional_trials was added as a second source in
--    20260802120000_promotional_trials.sql. Subscriptions and
--    promotional_trials' own logic is untouched, byte-for-byte identical
--    to before.
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_any_active_premium(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.status = 'active'
      AND s.expires_at > now()
  ) OR EXISTS (
    SELECT 1
    FROM public.promotional_trials t
    WHERE t.user_id = _user_id
      AND t.status = 'active'
      AND t.expires_at > now()
  ) OR EXISTS (
    SELECT 1
    FROM public.entitlements e
    JOIN public.reward_fulfillment_types ft ON ft.key = e.benefit_type
    WHERE e.user_id = _user_id
      AND e.status = 'active'
      AND ft.grants_premium = true
      AND (e.ends_at IS NULL OR e.ends_at > now())
  )
$$;

REVOKE ALL ON FUNCTION public.has_any_active_premium(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_any_active_premium(uuid) TO anon, authenticated;

-- ============================================================
-- 5. Redemption TOCTOU fix (C9 / PR11-13). The existing redeemReward()
--    (rewards.functions.ts) does a balance-check read, then a separate
--    insert -- not atomic, so two concurrent redemptions can both pass
--    the check before either writes. reward_ledger/reward_redemptions
--    have no per-user summary row to lock, so this uses a transaction-
--    scoped advisory lock keyed on the user (pg_advisory_xact_lock),
--    serializing concurrent redemption attempts for the SAME user only --
--    never a global lock, never blocking other users. Same
--    "PostgREST can't express this atomically -> service_role Postgres
--    function" precedent as advance_user_streak() (Phase B) and the
--    Priority 12 Phase 5 analytics functions.
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_reward_atomic(
  p_user_id uuid,
  p_catalog_key text,
  p_points_cost integer,
  p_verified_referrals_required integer,
  p_verified_referrals integer,
  p_grant_type text,
  p_grant_value jsonb
) RETURNS TABLE(redemption_id uuid, ok boolean, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
  v_new_id uuid;
BEGIN
  -- Serialize concurrent redemption attempts for this user only.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  SELECT COALESCE(SUM(points), 0) INTO v_balance
    FROM public.reward_ledger WHERE user_id = p_user_id;
  v_balance := v_balance - COALESCE((
    SELECT SUM(points_spent) FROM public.reward_redemptions WHERE user_id = p_user_id
  ), 0);

  IF v_balance < p_points_cost THEN
    RETURN QUERY SELECT NULL::uuid, false, 'insufficient_points';
    RETURN;
  END IF;
  IF p_verified_referrals < p_verified_referrals_required THEN
    RETURN QUERY SELECT NULL::uuid, false, 'insufficient_referrals';
    RETURN;
  END IF;

  INSERT INTO public.reward_redemptions (
    user_id, catalog_key, points_spent, verified_referrals_at_redemption, grant_result
  ) VALUES (
    p_user_id, p_catalog_key, p_points_cost, p_verified_referrals,
    jsonb_build_object('status', 'pending_fulfillment', 'grantType', p_grant_type, 'grantValue', p_grant_value)
  ) RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_reward_atomic(uuid, text, integer, integer, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_reward_atomic(uuid, text, integer, integer, integer, text, jsonb) TO service_role;

-- Rate limiting (C8 / PR11-20) deliberately has NO new schema here.
-- src/lib/rate-limit.server.ts already exists (Priority 11 security
-- audit) -- a minimal, fixed-window, in-memory limiter, the deliberate,
-- documented architectural choice for this single-Node-process deployment
-- (see DEPLOYMENT.md). Priority 15 Phase C reuses its exact
-- enforceRateLimit()/isRateLimited() interface for POST /v1/events and
-- reward redemption rather than introducing a second, Postgres-backed
-- mechanism.
