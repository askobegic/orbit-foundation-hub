-- Application-specific Commercial Products (Listing / Sponsored / Featured).
--
-- Confirmed by audit: every subscription_plans purchase, regardless of
-- product_type or display name, only ever grants the one global Premium
-- entitlement (via the subscriptions table) -- there was no way for a
-- plan to grant a distinct, application-specific benefit. See
-- PROJECT_KNOWLEDGE.md's own note that this was a deliberate scope
-- boundary requiring its own approval to cross.
--
-- Minimal, additive extension, reusing existing infrastructure throughout:
-- entitlements/reward_fulfillment_types already implement exactly this
-- "distinct, time-bound, per-application benefit" shape (Priority 15C) --
-- they just had no purchase-driven path writing to them. This migration
-- only adds the reference from a plan to a benefit key; the existing
-- subscriptions/payments/Premium activation flow in both webhooks is
-- completely unchanged -- this is purely additive (a plan can now ALSO
-- grant a scoped entitlements row alongside the unchanged Premium grant).
--
-- Deliberately NOT implemented in this pass: a plan that grants ONLY a
-- benefit and skips Premium/subscriptions entirely. That would require
-- restructuring the Stripe/PayPal webhooks' activation control flow
-- (notification text, reward action selection, referral tracking, and
-- several other steps currently assume every purchase creates a
-- subscriptions row) -- out of scope for this pass, and too invasive to
-- the platform's most financially-sensitive code to bundle in silently.
-- subscription_plans.grants_premium is added below as schema-level
-- infrastructure for that future pass, defaulted true (preserving every
-- existing plan's behavior exactly), but is not yet read by any webhook.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS grants_premium boolean NOT NULL DEFAULT true;

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS grants_benefit_key text
    REFERENCES public.reward_fulfillment_types(key) ON DELETE SET NULL;

INSERT INTO public.entitlement_sources (key, label, display_order) VALUES
  ('product_purchase', 'Product Purchase', 60)
ON CONFLICT (key) DO NOTHING;
