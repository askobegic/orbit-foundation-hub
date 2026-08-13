-- Public Coupons -- new CORE feature, Priority 17. A separate mechanism
-- from Dashboard Offers: publicly discoverable (no CORE account needed to
-- see it), but redemption requires an authenticated CORE account.
--
-- Reuses the same polymorphic product_type/product_id + discount_type
-- shape as dashboard_offers (see 20260814100000) rather than inventing a
-- second discount-representation format.

CREATE TABLE IF NOT EXISTS public.public_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Normalized at write time (upper, trimmed) by adminUpsertCoupon and at
  -- read time by resolvePublicCoupon -- never trust client casing/whitespace.
  code text UNIQUE NOT NULL,
  display_label text,

  title_bs text NOT NULL,
  title_en text NOT NULL,
  title_de text NOT NULL,
  description_bs text,
  description_en text,
  description_de text,

  product_type text NOT NULL CHECK (product_type IN ('subscription_plan', 'ad_placement_price')),
  product_id uuid NOT NULL,

  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'fixed_price')),
  discount_percent numeric CHECK (discount_percent > 0 AND discount_percent <= 100),
  fixed_price numeric CHECK (fixed_price >= 0),
  CHECK (
    (discount_type = 'percent' AND discount_percent IS NOT NULL AND fixed_price IS NULL)
    OR
    (discount_type = 'fixed_price' AND fixed_price IS NOT NULL AND discount_percent IS NULL)
  ),
  min_purchase numeric CHECK (min_purchase >= 0),

  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at),

  max_total_uses integer CHECK (max_total_uses > 0),
  max_uses_per_user integer NOT NULL DEFAULT 1 CHECK (max_uses_per_user > 0),

  is_public boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_public_coupons_window
  ON public.public_coupons(starts_at, ends_at) WHERE enabled = true AND archived = false;

-- Publicly readable: the whole point of a Public Coupon is that a
-- non-member can discover and see it (Facebook post, /offer/:code page)
-- before ever creating a CORE account. Only enabled+public+non-archived
-- rows are exposed; date-window/usage-limit validity is resolved
-- server-side at redemption time, not implied by mere visibility.
GRANT SELECT ON public.public_coupons TO anon, authenticated;
GRANT ALL ON public.public_coupons TO service_role;
ALTER TABLE public.public_coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public coupons are publicly readable" ON public.public_coupons;
CREATE POLICY "Public coupons are publicly readable"
  ON public.public_coupons FOR SELECT TO anon, authenticated
  USING (enabled = true AND archived = false AND is_public = true);

DROP POLICY IF EXISTS "Admins manage public coupons" ON public.public_coupons;
CREATE POLICY "Admins manage public coupons"
  ON public.public_coupons FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- Redemptions -- one row per successful redemption, never a row for a
-- failed/abandoned attempt (a failed payment must not permanently
-- consume a one-use coupon -- see redeem_coupon_atomic() below, which
-- only inserts on confirmed success).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid REFERENCES public.public_coupons(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  final_price numeric NOT NULL,
  currency text NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);

-- A given payment can only ever back one redemption row -- redelivered
-- webhook events must not double-record a redemption (idempotency,
-- matching the payments.stripe_payment_id/paypal_payment_id precedent).
-- NULLs (a redemption not yet linked to a completed payment) are exempt
-- by design, matching every other nullable-unique column in this schema.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_redemptions_payment
  ON public.coupon_redemptions(payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_user
  ON public.coupon_redemptions(coupon_id, user_id);

GRANT SELECT ON public.coupon_redemptions TO authenticated;
GRANT ALL ON public.coupon_redemptions TO service_role;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own coupon redemptions" ON public.coupon_redemptions;
CREATE POLICY "Users view own coupon redemptions"
  ON public.coupon_redemptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins manage coupon redemptions" ON public.coupon_redemptions;
CREATE POLICY "Admins manage coupon redemptions"
  ON public.coupon_redemptions FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- Atomic redemption -- validates usage limits and inserts the redemption
-- row in one statement, the same "PostgREST can't express this atomically
-- -> service_role Postgres function" precedent already established by
-- redeem_reward_atomic()/advance_user_streak().
--
-- Pre-production audit correction: the original lock was always keyed on
-- (coupon_id, user_id) -- correct for serializing the SAME user's own
-- concurrent/retried redemptions, but two DIFFERENT users redeeming the
-- same max_total_uses-limited coupon at the same time used different
-- lock keys and never serialized against each other, so both could read
-- the same pre-increment count and both pass the global-limit check.
-- Fix: when max_total_uses is configured, lock on coupon_id ALONE so
-- every redemption attempt for that coupon -- from any user -- queues
-- behind the same lock before checking/inserting, making the global
-- count check-then-insert genuinely atomic. When max_total_uses is NULL
-- (no global cap to protect), the lock stays scoped to (coupon_id,
-- user_id) exactly as before -- no unnecessary cross-user serialization
-- for an uncapped coupon. Either way, the per-user max_uses_per_user
-- check is unaffected and still correct: the coupon_id-only lock is a
-- superset of the per-user protection, not a replacement for it.
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_coupon_atomic(
  p_coupon_id uuid,
  p_user_id uuid,
  p_max_total_uses integer,
  p_max_uses_per_user integer,
  p_final_price numeric,
  p_currency text,
  p_payment_id uuid
) RETURNS TABLE(redemption_id uuid, ok boolean, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_uses integer;
  v_user_uses integer;
  v_new_id uuid;
BEGIN
  IF p_max_total_uses IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_coupon_id::text));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(p_coupon_id::text || ':' || p_user_id::text));
  END IF;

  IF p_max_total_uses IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total_uses FROM public.coupon_redemptions WHERE coupon_id = p_coupon_id;
    IF v_total_uses >= p_max_total_uses THEN
      RETURN QUERY SELECT NULL::uuid, false, 'max_total_uses_reached';
      RETURN;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_user_uses
    FROM public.coupon_redemptions WHERE coupon_id = p_coupon_id AND user_id = p_user_id;
  IF v_user_uses >= p_max_uses_per_user THEN
    RETURN QUERY SELECT NULL::uuid, false, 'max_uses_per_user_reached';
    RETURN;
  END IF;

  INSERT INTO public.coupon_redemptions (coupon_id, user_id, payment_id, final_price, currency)
  VALUES (p_coupon_id, p_user_id, p_payment_id, p_final_price, p_currency)
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_coupon_atomic(uuid, uuid, integer, integer, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_atomic(uuid, uuid, integer, integer, numeric, text, uuid) TO service_role;
