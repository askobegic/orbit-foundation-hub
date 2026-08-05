-- Priority 8.5: Promotional Trial Policy.
--
-- Replaces the old automatic 7-day trial (a `subscriptions` row keyed by
-- the magic sentinel stripe_payment_id = 'trial_7days', auto-activated on
-- first dashboard load -- trial.functions.ts's activateTrialIfEligible,
-- now removed entirely) with a Promotional Trial: a distinct, explicitly
-- granted entitlement, never activated automatically at registration.
--
-- Deliberately its own table, not another `subscriptions` row: a Trial and
-- a paid subscription must never conflict or be confused with each other
-- (a user can legitimately have both at once -- an admin-granted trial
-- alongside an existing paid Premium plan -- and neither should overwrite
-- or block the other, which sharing one row keyed by
-- UNIQUE(user_id, app_id) could never guarantee). Trial is also
-- ecosystem-wide (matching the Global Premium model), not per-application,
-- so there is no app_id here at all.

-- Trial sources: an admin-extensible vocabulary (same shape as
-- capability_definitions/reward_fulfillment_types) so a future business
-- rule (a promotional invitation campaign, a Rewards catalog redemption)
-- can grant a trial by registering its own source key here -- never by
-- adding a new column, enum value, or code branch to this table.
CREATE TABLE IF NOT EXISTS public.trial_sources (
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

GRANT SELECT ON public.trial_sources TO anon, authenticated;
GRANT ALL ON public.trial_sources TO service_role;
ALTER TABLE public.trial_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Trial sources are publicly readable" ON public.trial_sources;
CREATE POLICY "Trial sources are publicly readable"
  ON public.trial_sources FOR SELECT TO anon, authenticated USING (true);

-- Only 'admin_grant' has a caller today. 'promotional_invitation' and
-- 'reward_redemption' are seeded ahead of the features that will use them
-- (matching reward_action_rules' precedent of seeding
-- business_approved/etc. before Advertising or application features
-- existed to call them) -- seeding a vocabulary key is data, not business
-- logic, so this is not a hardcoded behavior.
INSERT INTO public.trial_sources (key, label, display_order) VALUES
  ('admin_grant', 'Administrator Grant', 10),
  ('promotional_invitation', 'Promotional Invitation', 20),
  ('reward_redemption', 'Reward Redemption', 30)
ON CONFLICT (key) DO NOTHING;

-- Configurable policy -- Configuration-First: the offered quick-select
-- durations and the maximum a single trial may ever run are both
-- admin-editable data, never hardcoded constants.
CREATE TABLE IF NOT EXISTS public.trial_policy (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.trial_policy TO anon, authenticated;
GRANT ALL ON public.trial_policy TO service_role;
ALTER TABLE public.trial_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Trial policy is publicly readable" ON public.trial_policy;
CREATE POLICY "Trial policy is publicly readable"
  ON public.trial_policy FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.trial_policy (key, value, description) VALUES
  ('preset_days', '[1, 3, 7, 14]', 'Quick-select duration options shown in the admin grant form.'),
  ('max_duration_days', '90', 'Upper bound on any single Promotional Trial grant, including custom durations.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.promotional_trials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'revoked')),
  source text REFERENCES public.trial_sources(key) NOT NULL,
  source_reference text,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A user cannot have multiple active Trials -- enforced at the database,
-- not just in application code, via a partial unique index (only one row
-- per user may ever be 'active' at once).
CREATE UNIQUE INDEX IF NOT EXISTS idx_promotional_trials_one_active_per_user
  ON public.promotional_trials(user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_promotional_trials_user ON public.promotional_trials(user_id);

GRANT SELECT ON public.promotional_trials TO authenticated;
GRANT ALL ON public.promotional_trials TO service_role;
ALTER TABLE public.promotional_trials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own promotional trials" ON public.promotional_trials;
CREATE POLICY "Users can view their own promotional trials"
  ON public.promotional_trials FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- has_any_active_premium gains a second, independent source: an active
-- Promotional Trial grants the same ecosystem-wide access a paid
-- subscription does (that is the entire point of trying it), without the
-- two ever being the same row or able to overwrite one another. Time-based
-- expiry only (expires_at > now()), matching subscriptions' own model --
-- neither table has, or needs, a cron job to flip status to an "expired"
-- value.
CREATE OR REPLACE FUNCTION public.has_any_active_premium(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.status = 'active'
      AND s.expires_at > now()
  ) OR EXISTS (
    SELECT 1
    FROM public.promotional_trials t
    WHERE t.user_id = _user_id
      AND t.status = 'active'
      AND t.expires_at > now()
  )
$$;

REVOKE ALL ON FUNCTION public.has_any_active_premium(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_any_active_premium(uuid) TO anon, authenticated;
