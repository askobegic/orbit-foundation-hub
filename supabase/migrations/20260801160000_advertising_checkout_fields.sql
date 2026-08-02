-- Priority 8.4 follow-up: campaign checkout uses the same static
-- Stripe/PayPal Payment Link model as subscription_plans (this codebase
-- has no dynamic Checkout Session creation anywhere -- see pricing.tsx /
-- payments.functions.ts), which has no room to carry campaign creative
-- data (title/image/link) through the payment provider. So a campaign is
-- created as a 'draft' row (creative content already stored) *before*
-- checkout, and the signed reference carries the campaign id itself; the
-- webhook activates that same row on payment success rather than creating
-- it from scratch. Additive: widens the existing status vocabulary, adds
-- two nullable link columns -- no data is dropped or narrowed.

ALTER TABLE public.ad_campaigns DROP CONSTRAINT IF EXISTS ad_campaigns_status_check;
ALTER TABLE public.ad_campaigns
  ADD CONSTRAINT ad_campaigns_status_check
  CHECK (status IN ('draft','pending','active','rejected','ended','cancelled'));

ALTER TABLE public.ad_placement_prices
  ADD COLUMN IF NOT EXISTS stripe_payment_link text,
  ADD COLUMN IF NOT EXISTS paypal_payment_link text;
