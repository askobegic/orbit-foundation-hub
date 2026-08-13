-- Priority 16 Phase B: Premium Milestones -- admin-configurable dual-
-- metric milestones (lifetime points AND successful-invite count) that
-- grant Premium duration via the EXISTING fulfillment mechanism
-- (fulfillGrant() -> grantEntitlement(benefitType='premium_duration'),
-- Priority 15 Phase C). Not a new Premium system: this table only decides
-- WHEN a milestone is reached and records that it was granted; the actual
-- grant reuses the same dispatcher Missions/Challenges/Streaks/reward
-- catalog redemption already share.
--
-- Global only (no app_id column) -- the approved ruleset requires these
-- to be application-independent, unlike every other Priority 15/16
-- registry that supports a global-or-per-app override. Evaluated lazily
-- (src/lib/rewards.server.ts's evaluatePremiumMilestones(), called
-- wherever points are granted -- the same "no cron infrastructure"
-- precedent every other lazy CORE evaluation already follows), never on
-- a schedule.

CREATE TABLE IF NOT EXISTS public.reward_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  min_lifetime_points integer NOT NULL CHECK (min_lifetime_points >= 0),
  min_successful_invites integer NOT NULL DEFAULT 0 CHECK (min_successful_invites >= 0),
  -- Same fulfillment vocabulary as reward_catalog/engagement_definitions/
  -- streak_milestones -- not a second registry.
  grant_type text NOT NULL REFERENCES public.reward_fulfillment_types(key),
  grant_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reward_milestones TO anon, authenticated;
GRANT ALL ON public.reward_milestones TO service_role;
ALTER TABLE public.reward_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reward milestones are publicly readable" ON public.reward_milestones;
CREATE POLICY "Reward milestones are publicly readable"
  ON public.reward_milestones FOR SELECT TO anon, authenticated USING (true);

-- History -- guarantees a milestone is never granted twice for the same
-- user, via UNIQUE(user_id, milestone_id) + upsert-ignoreDuplicates, the
-- exact same pattern user_achievements/user_engagement_completions/
-- user_streak_milestones all already use.
CREATE TABLE IF NOT EXISTS public.user_reward_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  milestone_id uuid REFERENCES public.reward_milestones(id) ON DELETE CASCADE NOT NULL,
  achieved_at timestamptz NOT NULL DEFAULT now(),
  grant_result jsonb,
  UNIQUE (user_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reward_milestones_user ON public.user_reward_milestones(user_id);

GRANT SELECT ON public.user_reward_milestones TO authenticated;
GRANT ALL ON public.user_reward_milestones TO service_role;
ALTER TABLE public.user_reward_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own reward milestones" ON public.user_reward_milestones;
CREATE POLICY "Users can view their own reward milestones"
  ON public.user_reward_milestones FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- New entitlement source -- same admin-extensible registry
-- (entitlement_sources, Priority 15 Phase C) every other entitlement
-- origin already uses, not a new vocabulary.
INSERT INTO public.entitlement_sources (key, label, display_order) VALUES
  ('premium_milestone', 'Premium Milestone', 60)
ON CONFLICT (key) DO NOTHING;

-- Seed the three approved tiers. grant_type = 'premium_duration' already
-- exists (Priority 15 Phase C) and already grants Premium via the shared
-- entitlements mechanism.
INSERT INTO public.reward_milestones (key, label, min_lifetime_points, min_successful_invites, grant_type, grant_value, display_order) VALUES
  ('premium_milestone_1month', '500 points + 3 successful invites -> 1 month Premium', 500, 3, 'premium_duration', '{"durationDays": 30}'::jsonb, 1),
  ('premium_milestone_3month', '1000 points + 5 successful invites -> 3 months Premium', 1000, 5, 'premium_duration', '{"durationDays": 90}'::jsonb, 2),
  ('premium_milestone_6month', '2000 points + 10 successful invites -> 6 months Premium', 2000, 10, 'premium_duration', '{"durationDays": 180}'::jsonb, 3)
ON CONFLICT (key) DO NOTHING;
