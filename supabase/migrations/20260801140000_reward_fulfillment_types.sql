-- Priority 8.3 adjustment (approved before starting Priority 8.4): Rewards
-- fulfillment-type decoupling + catalog capability gating.
--
-- reward_catalog.grant_type was validated in application code as a fixed
-- literal union ('premium_duration' | 'advertising_credit' | 'featured_slot')
-- -- exactly the kind of hardcoded coupling this architecture avoids
-- everywhere else (capability_definitions, reward_action_rules, ...). This
-- registry replaces that enum so a future module (Advertising, or anything
-- after it) can register its own fulfillment type without a CORE
-- deployment, and Rewards never needs to know what that type means --
-- only that some other, later-built module is responsible for acting on
-- it. Rewards continues to only ever record a redemption and the
-- fulfillment type/value (see reward_redemptions.grant_result); actual
-- fulfillment logic still does not exist anywhere yet.

CREATE TABLE IF NOT EXISTS public.reward_fulfillment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reward_fulfillment_types TO anon, authenticated;
GRANT ALL ON public.reward_fulfillment_types TO service_role;

ALTER TABLE public.reward_fulfillment_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reward fulfillment types are publicly readable" ON public.reward_fulfillment_types;
CREATE POLICY "Reward fulfillment types are publicly readable"
  ON public.reward_fulfillment_types FOR SELECT
  TO anon, authenticated
  USING (true);

INSERT INTO public.reward_fulfillment_types (key, label, display_order) VALUES
  ('premium_duration', 'Premium Duration', 10),
  ('advertising_credit', 'Advertising Credit', 20),
  ('featured_slot', 'Featured Slot', 30)
ON CONFLICT (key) DO NOTHING;

-- Existing reward_catalog.grant_type values already match these keys
-- (seeded in 20260801120000_rewards_and_loyalty.sql), so this FK is safe
-- to add now that the registry is seeded -- from here on, a new
-- fulfillment type must be registered above before a catalog item can use
-- it, the same "data, not code" guarantee capability_definitions gives
-- Capabilities.
ALTER TABLE public.reward_catalog
  DROP CONSTRAINT IF EXISTS reward_catalog_grant_type_fkey;
ALTER TABLE public.reward_catalog
  ADD CONSTRAINT reward_catalog_grant_type_fkey
  FOREIGN KEY (grant_type) REFERENCES public.reward_fulfillment_types(key);

-- Dependency validation (same mechanism as dashboard_widgets.requires_capability,
-- Priority 8.2): a catalog reward can require a capability be enabled for
-- the application it's being viewed from before it's shown as available
-- -- e.g. a future "Featured Business" reward once a business_directory
-- capability exists. Nullable: most rewards (Premium durations) have no
-- such dependency.
ALTER TABLE public.reward_catalog
  ADD COLUMN IF NOT EXISTS requires_capability text REFERENCES public.capability_definitions(key) ON DELETE SET NULL;
