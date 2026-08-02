-- Priority 8.3: Rewards & Loyalty.
--
-- Reward processing is entirely action-driven and configuration-resolved --
-- applications (and CORE itself, for its own automatic grants) report a
-- named action; reward_action_rules is the ONLY place a point value for
-- that action is ever decided. No code anywhere may hardcode a point
-- value or switch on an action name. See PROJECT_KNOWLEDGE.md -> Rewards
-- & Loyalty.
--
-- Config tables follow the same soft-lifecycle shape as Capabilities
-- (8.1) / Dashboard Widgets (8.2): enabled/archived/display_order, a
-- stable text `key` for API/consumer stability, never a hard DELETE.
-- Ledger/transactional tables (reward_ledger, user_achievements,
-- premium_referrals, reward_redemptions) are append-only history, not
-- configuration -- they deliberately do NOT get enabled/archived columns.

CREATE TABLE IF NOT EXISTS public.reward_action_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text UNIQUE NOT NULL,
  label text NOT NULL,
  points integer NOT NULL DEFAULT 0,
  cooldown_seconds integer NOT NULL DEFAULT 0,
  max_per_user integer,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reward_action_rules TO anon, authenticated;
GRANT ALL ON public.reward_action_rules TO service_role;
ALTER TABLE public.reward_action_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reward action rules are publicly readable" ON public.reward_action_rules;
CREATE POLICY "Reward action rules are publicly readable"
  ON public.reward_action_rules FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.reward_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  min_lifetime_points integer NOT NULL DEFAULT 0,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reward_levels TO anon, authenticated;
GRANT ALL ON public.reward_levels TO service_role;
ALTER TABLE public.reward_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reward levels are publicly readable" ON public.reward_levels;
CREATE POLICY "Reward levels are publicly readable"
  ON public.reward_levels FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.reward_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  -- Nullable: an achievement with a trigger_action is auto-awarded the
  -- moment the user's lifetime count of that action reaches
  -- trigger_count. An achievement with no trigger_action (a compound
  -- condition not expressible this simply) is admin-awarded only -- not
  -- every achievement needs to be automatic to avoid hardcoded per-
  -- achievement logic; leaving trigger_action null is the honest way to
  -- say "not automatic yet" rather than faking a condition in code.
  trigger_action text REFERENCES public.reward_action_rules(action) ON DELETE SET NULL,
  trigger_count integer NOT NULL DEFAULT 1,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reward_achievements TO anon, authenticated;
GRANT ALL ON public.reward_achievements TO service_role;
ALTER TABLE public.reward_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reward achievements are publicly readable" ON public.reward_achievements;
CREATE POLICY "Reward achievements are publicly readable"
  ON public.reward_achievements FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.reward_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  points_cost integer NOT NULL,
  -- Verified referrals are a qualifying THRESHOLD, not a spent currency --
  -- redeeming a reward never reduces a user's verified-referral count
  -- (only points_cost is actually deducted). See reward_redemptions below.
  verified_referrals_required integer NOT NULL DEFAULT 0,
  grant_type text NOT NULL, -- 'premium_duration' | 'advertising_credit' | 'featured_slot'
  grant_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reward_catalog TO anon, authenticated;
GRANT ALL ON public.reward_catalog TO service_role;
ALTER TABLE public.reward_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reward catalog is publicly readable" ON public.reward_catalog;
CREATE POLICY "Reward catalog is publicly readable"
  ON public.reward_catalog FOR SELECT TO anon, authenticated USING (true);

-- Small key/value config table -- the configured verification period lives
-- here rather than as a magic number, per Configuration-First.
CREATE TABLE IF NOT EXISTS public.reward_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reward_config TO anon, authenticated;
GRANT ALL ON public.reward_config TO service_role;
ALTER TABLE public.reward_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reward config is publicly readable" ON public.reward_config;
CREATE POLICY "Reward config is publicly readable"
  ON public.reward_config FOR SELECT TO anon, authenticated USING (true);

-- Append-only ledger. Reward Points balance = SUM(points) minus
-- SUM(reward_redemptions.points_spent); Lifetime Points = SUM(points)
-- where points > 0, and this table is never updated/deleted, so lifetime
-- points structurally cannot decrease. `action` is deliberately not a
-- foreign key to reward_action_rules.action -- an unrecognized/disabled
-- action is still recorded here (points = 0) for complete auditability
-- (an application's own action-name typo is still visible, not silently
-- dropped), it just grants nothing.
CREATE TABLE IF NOT EXISTS public.reward_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  action text NOT NULL,
  points integer NOT NULL,
  resource_type text,
  resource_id text,
  source_app_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_ledger_user ON public.reward_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_user_action ON public.reward_ledger(user_id, action);

GRANT SELECT ON public.reward_ledger TO authenticated;
GRANT ALL ON public.reward_ledger TO service_role;
ALTER TABLE public.reward_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own reward ledger" ON public.reward_ledger;
CREATE POLICY "Users can view their own reward ledger"
  ON public.reward_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  achievement_key text REFERENCES public.reward_achievements(key) ON DELETE CASCADE NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, achievement_key)
);

GRANT SELECT ON public.user_achievements TO authenticated;
GRANT ALL ON public.user_achievements TO service_role;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own achievements" ON public.user_achievements;
CREATE POLICY "Users can view their own achievements"
  ON public.user_achievements FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- A Premium Referral: created once the referred user's Premium first
-- becomes active, verified only if that Premium is still active once
-- verification_due_at (created_at + the configured verification period)
-- is reached. UNIQUE(referred_user_id): a user can only ever be counted
-- as one person's referral.
CREATE TABLE IF NOT EXISTS public.premium_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  referred_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  verification_due_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_premium_referrals_referrer ON public.premium_referrals(referrer_id);

GRANT SELECT ON public.premium_referrals TO authenticated;
GRANT ALL ON public.premium_referrals TO service_role;
ALTER TABLE public.premium_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own referrals" ON public.premium_referrals;
CREATE POLICY "Users can view their own referrals"
  ON public.premium_referrals FOR SELECT TO authenticated USING (auth.uid() = referrer_id);

CREATE TABLE IF NOT EXISTS public.reward_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  catalog_key text REFERENCES public.reward_catalog(key) ON DELETE RESTRICT NOT NULL,
  points_spent integer NOT NULL,
  verified_referrals_at_redemption integer NOT NULL,
  grant_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_user ON public.reward_redemptions(user_id);

GRANT SELECT ON public.reward_redemptions TO authenticated;
GRANT ALL ON public.reward_redemptions TO service_role;
ALTER TABLE public.reward_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own redemptions" ON public.reward_redemptions;
CREATE POLICY "Users can view their own redemptions"
  ON public.reward_redemptions FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Raw referral relationship, captured once at onboarding completion (set-
-- once, like the Identity Lock fields -- see PROJECT_KNOWLEDGE.md ->
-- Identity Lock) from the existing ?ref=<username> invite link
-- (ShareAndInvite.tsx) that had no backend handling until this migration.
-- Kept on profiles rather than a separate table since it's a single,
-- permanent fact about the user, not a growing history.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by_user_id uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Seed data: the Rewards config, catalog, and level defaults named in the
-- approved Priority 8 brief. All admin-editable afterward -- this is
-- initial data, not a hardcoded rule.
INSERT INTO public.reward_config (key, value, description) VALUES
  ('referral_verification_days', '30', 'Days a referred user''s Premium must remain active before the referral counts as verified.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.reward_levels (key, label, min_lifetime_points, display_order) VALUES
  ('member', 'Member', 0, 10),
  ('bronze', 'Bronze', 500, 20),
  ('silver', 'Silver', 1500, 30),
  ('gold', 'Gold', 4000, 40),
  ('platinum', 'Platinum', 10000, 50),
  ('ambassador', 'Ambassador', 25000, 60),
  ('legend', 'Legend', 60000, 70)
ON CONFLICT (key) DO NOTHING;

-- The first five are granted by CORE itself, internally, at the exact
-- points named in the brief ("CORE grants points automatically for...").
-- The remaining five are examples of application-reported actions
-- (Part 4's own examples) -- seeded with a reasonable default so a future
-- application integrating against this table already resolves to a
-- sensible point value, not an unconfigured zero, on day one.
INSERT INTO public.reward_action_rules (action, label, points, cooldown_seconds, max_per_user, display_order) VALUES
  ('invite_registration', 'Invite Registration', 50, 0, NULL, 10),
  ('premium_purchase', 'Premium Purchase', 100, 0, NULL, 20),
  ('premium_renewal', 'Premium Renewal', 50, 0, NULL, 30),
  ('premium_referral_verified', 'Verified Premium Referral', 150, 0, NULL, 40),
  ('advertising_purchase', 'Advertising Purchase', 100, 0, NULL, 50),
  ('business_approved', 'Business Approved', 100, 0, NULL, 60),
  ('vendor_approved', 'Vendor Approved', 100, 0, NULL, 70),
  ('event_created', 'Event Created', 50, 0, NULL, 80),
  ('place_approved', 'Place Approved', 50, 0, NULL, 90),
  ('review_approved', 'Review Approved', 25, 0, NULL, 100)
ON CONFLICT (action) DO NOTHING;

INSERT INTO public.reward_achievements (key, label, description, trigger_action, trigger_count, display_order) VALUES
  ('first_invite', 'First Invite', 'Invited your first member to the platform.', 'invite_registration', 1, 10),
  ('first_premium_referral', 'First Premium Referral', 'Had your first invite become a verified Premium referral.', 'premium_referral_verified', 1, 20),
  ('premium_supporter', 'Premium Supporter', 'Purchased Premium for the first time.', 'premium_purchase', 1, 30),
  ('explorer', 'Explorer', NULL, NULL, 1, 40),
  ('community_builder', 'Community Builder', NULL, NULL, 1, 50),
  ('first_business', 'First Business', 'Had a business approved for the first time.', 'business_approved', 1, 60),
  ('first_event', 'First Event', 'Created your first event.', 'event_created', 1, 70)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.reward_catalog (key, label, points_cost, verified_referrals_required, grant_type, grant_value, display_order) VALUES
  ('premium_1_month', '1 Month Premium', 500, 3, 'premium_duration', '{"months": 1}', 10),
  ('premium_3_months', '3 Months Premium', 1500, 10, 'premium_duration', '{"months": 3}', 20),
  ('premium_6_months', '6 Months Premium', 4000, 25, 'premium_duration', '{"months": 6}', 30),
  ('premium_12_months', '12 Months Premium', 10000, 60, 'premium_duration', '{"months": 12}', 40),
  ('advertising_credit', 'Advertising Credit', 1000, 5, 'advertising_credit', '{}', 50),
  ('featured_business', 'Featured Business', 2000, 10, 'featured_slot', '{"type": "business"}', 60),
  ('featured_event', 'Featured Event', 2000, 10, 'featured_slot', '{"type": "event"}', 70)
ON CONFLICT (key) DO NOTHING;
