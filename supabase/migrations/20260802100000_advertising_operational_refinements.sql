-- Priority 8.4 operational refinements (approved alongside committing the
-- phase):
--   1. Draft campaigns need a lazy expiry, not unlimited permanent drafts.
--   2. Trusted Advertiser status must be per-application, not global.
--
-- (The third refinement -- editing an approved campaign returns it to
-- moderation -- is application logic only, no schema change needed.)

-- --- 1. Draft expiry -----------------------------------------------------
-- Configurable, not hardcoded, matching every other Advertising setting.
-- Enforced lazily (expireStaleDraftCampaigns(), called from getMyCampaigns)
-- rather than a scheduled job -- this codebase has no cron infrastructure,
-- same reasoning as Rewards & Loyalty's referral-verification promotion.
INSERT INTO public.ad_config (key, value, description) VALUES
  ('draft_expiry_hours', '48', 'Hours an unpaid draft campaign is kept before being auto-cancelled.')
ON CONFLICT (key) DO NOTHING;

-- --- 2. Trusted Advertisers become per-application -----------------------
-- This table was only just introduced in this same phase and has no real
-- admin-granted rows yet, so it's safe to clear rather than migrate data --
-- there is nothing meaningful to preserve under the old (global) shape.
DELETE FROM public.ad_trusted_advertisers;

ALTER TABLE public.ad_trusted_advertisers DROP CONSTRAINT IF EXISTS ad_trusted_advertisers_pkey;
ALTER TABLE public.ad_trusted_advertisers
  ADD COLUMN app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL;
ALTER TABLE public.ad_trusted_advertisers
  ADD PRIMARY KEY (user_id, app_id);

CREATE INDEX IF NOT EXISTS idx_ad_trusted_advertisers_app ON public.ad_trusted_advertisers(app_id);
