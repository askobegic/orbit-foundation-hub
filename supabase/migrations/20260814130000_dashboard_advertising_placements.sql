-- Dashboard Advertising -- new PLACEMENTS inside the existing Advertising
-- system (Priority 8.4/13), not a new advertising architecture. Per spec:
-- "Dashboard Cards" and "Dashboard Featured Banner".
--
-- Existing Advertising pricing is duration-based (ad_placement_prices.
-- duration_days) -- there was no impression-quantity purchasing or
-- impression-delivery tracking anywhere in this codebase before this
-- migration (confirmed by inspection, not assumed). "Equal impression
-- delivery" (spec) genuinely requires that tracking to exist, so this
-- adds it additively, alongside the existing duration model, which is
-- completely untouched and remains the default for every other placement.

-- ============================================================
-- 1. Seed the two new placements -- same registry every other placement
--    (banner, sidebar, etc.) already lives in, no new table.
-- ============================================================

INSERT INTO public.ad_placements (key, label, description, display_order) VALUES
  ('dashboard_cards', 'Dashboard Cards', 'Rotating small ad cards low on the user Dashboard.', 100),
  ('dashboard_featured_banner', 'Dashboard Featured Banner', 'Large horizontal banner at the bottom of the user Dashboard.', 110)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 2. Impression-quantity pricing -- an alternative unit alongside the
--    existing duration_days, not a replacement. NULL (every pre-existing
--    row) means "duration-based, unchanged". Admin fills in real
--    prices/payment links later via the existing /admin/advertising UI --
--    nothing here is hardcoded.
-- ============================================================

ALTER TABLE public.ad_placement_prices
  ADD COLUMN IF NOT EXISTS impressions_included integer CHECK (impressions_included IS NULL OR impressions_included > 0);

-- ============================================================
-- 3. Impression tracking on campaigns -- impressions_purchased is a
--    snapshot taken from the chosen price row at campaign creation
--    (NULL for every existing/duration-based campaign); impressions_
--    delivered is the one genuine stored counter, written only via the
--    atomic function below -- never trusted from the client (spec: "the
--    server determines valid impression events").
-- ============================================================

ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS impressions_purchased integer CHECK (impressions_purchased IS NULL OR impressions_purchased > 0),
  ADD COLUMN IF NOT EXISTS impressions_delivered integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_impression_delivery
  ON public.ad_campaigns(placement_key, status, impressions_purchased)
  WHERE impressions_purchased IS NOT NULL;

-- ============================================================
-- 4. Atomic impression recorder -- the one and only writer of
--    impressions_delivered, matching the advance_user_streak()/
--    redeem_reward_atomic() "PostgREST can't express this atomically"
--    precedent. Server-side deduplication (rapid refresh, retries) is
--    handled by the caller via the existing in-memory rate limiter
--    (src/lib/rate-limit.server.ts) before this is ever called.
--
-- Pre-production audit correction: the original version incremented
-- unconditionally, so a campaign could exceed impressions_purchased
-- indefinitely (getDashboardCardCampaigns' own eligibility filter
-- reduces how often this is reached, but the recorder itself must be
-- the actual enforcement point, not just a filter upstream of it). The
-- WHERE clause's impressions_delivered < impressions_purchased condition
-- is evaluated atomically against the row under Postgres's own row lock
-- -- a plain "SELECT current value, then UPDATE" from application code
-- would race (two readers could both see 19,999 and both decide to
-- increment); a single conditional UPDATE cannot, because the second of
-- two concurrent UPDATEs on the same row always waits for the first's
-- lock and then re-evaluates WHERE against the already-incremented
-- value. impressions_purchased IS NULL (every duration-based campaign,
-- unchanged default) means uncapped, exactly as before this correction.
-- Returns whether the impression was actually recorded, so the caller
-- can distinguish "counted" from "campaign already exhausted."
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_ad_impression(p_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE public.ad_campaigns
    SET impressions_delivered = impressions_delivered + 1
    WHERE id = p_campaign_id
      AND (impressions_purchased IS NULL OR impressions_delivered < impressions_purchased)
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$$;

REVOKE ALL ON FUNCTION public.record_ad_impression(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ad_impression(uuid) TO service_role;
