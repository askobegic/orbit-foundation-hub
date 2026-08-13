-- Priority 16 Phase B: extends the EXISTING reward_action_rules /
-- grantRewardAction() engine (Priority 8.3) with the columns needed for
-- the approved Master Ruleset -- not a parallel points system.
--
-- daily_limit/weekly_limit/monthly_limit mirror event_rules' exact
-- existing shape (Priority 12), so CORE-internal actions gain the same
-- "N per day/week/month" capability application-reported events already
-- have -- the same concept, applied to the other of CORE's two parallel
-- reward engines, not a second rate-limit mechanism.
--
-- points_per_euro makes an action's reward proportional to a
-- server-verified paid amount instead of a flat constant. NULL (the
-- default, and every pre-existing row's value) means "flat rate,
-- unchanged" -- grantRewardAction() only switches to proportional
-- calculation when a rule explicitly sets this. This lets an admin
-- change the EUR-to-points rate without a deployment, per the approved
-- ruleset's "must ultimately be configurable through CORE Admin"
-- requirement.

ALTER TABLE public.reward_action_rules
  ADD COLUMN IF NOT EXISTS daily_limit integer,
  ADD COLUMN IF NOT EXISTS weekly_limit integer,
  ADD COLUMN IF NOT EXISTS monthly_limit integer,
  ADD COLUMN IF NOT EXISTS points_per_euro numeric;

-- ============================================================
-- Corrections to existing, already-live rules (Phase A audit conflicts
-- C-1/C-2): edit the data, not a duplicate row layered on top.
-- ============================================================

UPDATE public.reward_action_rules SET points = 10 WHERE action = 'invite_registration';
UPDATE public.reward_action_rules SET points = 50 WHERE action = 'premium_referral_verified';

-- Financial actions become proportional (EUR paid x 10) instead of flat.
-- points is zeroed since it is no longer read once points_per_euro is
-- set (grantRewardAction() ignores `points` for a proportional rule) --
-- left at 0 rather than removed, so the column's meaning stays legible
-- if points_per_euro is ever cleared again.
UPDATE public.reward_action_rules SET points = 0, points_per_euro = 10 WHERE action = 'premium_purchase';
UPDATE public.reward_action_rules SET points = 0, points_per_euro = 10 WHERE action = 'premium_renewal';
UPDATE public.reward_action_rules SET points = 0, points_per_euro = 10 WHERE action = 'advertising_purchase';

-- ============================================================
-- New CORE-internal actions for the approved ruleset.
-- ============================================================

INSERT INTO public.reward_action_rules (action, label, points, cooldown_seconds, max_per_user, daily_limit, points_per_euro, display_order) VALUES
  ('registration', 'Registration', 10, 0, 1, NULL, NULL, 5),
  ('profile_completed', 'Profile completed', 10, 0, 1, NULL, NULL, 6),
  ('verification', 'Verification approved', 10, 0, 1, NULL, NULL, 7),
  -- Referrer reward for sharing/submitting a referral -- see
  -- src/lib/rewards.functions.ts's recordReferralSubmission(). Cooldown
  -- guards against a single rapid-fire button mash within the same
  -- submission attempt; daily_limit is the approved "max 3/day" cap.
  ('referral_submission', 'Referral submission', 10, 30, NULL, 3, NULL, 8),
  -- Referrer reward for their DIRECTLY invited user completing their
  -- profile -- distinct from invite_registration (the invited user
  -- registering) and from the invited user's own `profile_completed`
  -- reward. Once per invited user by construction (called at most once
  -- per invited user, from their own one-time onboarding completion),
  -- not by max_per_user (which would wrongly cap the referrer at one
  -- grant total across every invitee they have).
  ('referral_profile_completed', 'Referred user completed profile', 10, 0, NULL, NULL, NULL, 9),
  -- Generic qualifying-purchase action for future CORE-routed paid
  -- product/service/ticket/booking flows -- proportional like the other
  -- financial actions. No current CORE webhook calls this yet (CORE only
  -- has Premium subscription and Advertising campaign checkout today);
  -- seeded so it is ready and admin-configurable the moment such a flow
  -- is added, per Phase A audit's "application integration still
  -- required" framing.
  ('qualifying_purchase', 'Qualifying purchase', 0, 0, NULL, NULL, 10, 11)
ON CONFLICT (action) DO NOTHING;
