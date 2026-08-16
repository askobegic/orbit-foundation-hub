-- Sponsored Product Dependency: a commercial product (e.g. "Sponsored
-- Musician") can require the purchaser already hold a specific active,
-- application-scoped entitlement (e.g. "Musician Listing") before its own
-- benefit is granted. Additive-only, reuses the exact same
-- reward_fulfillment_types vocabulary and FK shape already used by
-- grants_benefit_key (20260815100000_commercial_product_benefits.sql) --
-- not a new dependency engine, the same "requires_capability" pattern
-- dashboard_widgets/reward_catalog already use, applied here to products.
--
-- NULL = no dependency (every existing plan, unaffected).
-- Set = the purchaser must hold an active entitlement of this benefit_type,
-- for the SAME app_id as the purchased plan, checked server-side by the
-- webhook immediately before granting this plan's own grants_benefit_key.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS requires_benefit_key text
    REFERENCES public.reward_fulfillment_types(key) ON DELETE SET NULL;
