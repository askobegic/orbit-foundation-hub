-- Priority 15 Phase B: Missions, Challenges & Streaks.
--
-- Extends the existing Universal Event & Rewards Engine (Priority 12) and
-- the Phase A Global/Application scope convention -- does not replace or
-- duplicate either. Missions and Challenges share one underlying engine
-- (engagement_definitions/engagement_conditions/user_engagement_completions,
-- distinguished only by `kind`) per the "no duplicate progress engines"
-- requirement; Streaks are mechanically different (consecutive-day
-- continuity, not count-vs-target) and get their own tables. See
-- PROJECT_KNOWLEDGE.md -> Missions, Challenges & Streaks for the full
-- design.

-- ============================================================
-- 1. Missions & Challenges (shared engine, kind discriminator)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.engagement_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('mission', 'challenge')),
  key text UNIQUE NOT NULL,
  -- Admin-authored, user-facing content -- same trilingual-column shape as
  -- notifications.title_bs/en/de, not a locale-file key (this is per-row
  -- dynamic content, not static UI chrome).
  name_bs text NOT NULL,
  name_en text NOT NULL,
  name_de text NOT NULL,
  description_bs text,
  description_en text,
  description_de text,
  -- Global/Application scope (Phase A convention, reused exactly): NULL =
  -- GLOBAL, a specific application = APPLICATION-scoped. No separate
  -- "scope" enum column -- app_id nullability alone is the signal,
  -- exactly like event_rules.app_id.
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  -- Common case: a direct points reward, mirroring event_rules.points /
  -- lifetime_points exactly.
  reward_points integer NOT NULL DEFAULT 0,
  reward_lifetime_points integer NOT NULL DEFAULT 0,
  -- Forward-compatible, non-points reward (Phase C territory) -- mirrors
  -- reward_catalog.grant_type/grant_value exactly. Phase B never sets
  -- these from its own admin UI, but the column exists so Phase C can
  -- configure and fulfill one without a schema rewrite. Nullable: most
  -- definitions only ever use reward_points above.
  reward_grant_type text REFERENCES public.reward_fulfillment_types(key) ON DELETE SET NULL,
  reward_grant_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  display_order integer NOT NULL DEFAULT 0,
  -- Soft lifecycle: enabled + archived, the same two-boolean shape every
  -- other CORE registry uses -- not a DRAFT/ACTIVE/EXPIRED/DISABLED enum.
  -- Effective status (active / not-yet-started / expired / disabled) is
  -- computed at read time from these plus starts_at/ends_at.
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_definitions_kind ON public.engagement_definitions(kind);
CREATE INDEX IF NOT EXISTS idx_engagement_definitions_app ON public.engagement_definitions(app_id);

GRANT SELECT ON public.engagement_definitions TO anon, authenticated;
GRANT ALL ON public.engagement_definitions TO service_role;
ALTER TABLE public.engagement_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Engagement definitions are publicly readable" ON public.engagement_definitions;
CREATE POLICY "Engagement definitions are publicly readable"
  ON public.engagement_definitions FOR SELECT TO anon, authenticated USING (true);

-- One or more per definition; a definition is complete only when EVERY
-- condition's count reaches its own target (AND across conditions).
-- event_key drives off the existing, unmodified event_definitions
-- vocabulary -- the connected application remains responsible for
-- generating the underlying event, exactly as today.
CREATE TABLE IF NOT EXISTS public.engagement_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid REFERENCES public.engagement_definitions(id) ON DELETE CASCADE NOT NULL,
  event_key text REFERENCES public.event_definitions(event_key) ON DELETE CASCADE NOT NULL,
  target integer NOT NULL CHECK (target > 0),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_conditions_definition ON public.engagement_conditions(definition_id);
-- The lookup processEngagement() runs on every qualifying event: "which
-- definitions care about this event_key" -- must be indexed, not a scan.
CREATE INDEX IF NOT EXISTS idx_engagement_conditions_event_key ON public.engagement_conditions(event_key);

GRANT SELECT ON public.engagement_conditions TO anon, authenticated;
GRANT ALL ON public.engagement_conditions TO service_role;
ALTER TABLE public.engagement_conditions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Engagement conditions are publicly readable" ON public.engagement_conditions;
CREATE POLICY "Engagement conditions are publicly readable"
  ON public.engagement_conditions FOR SELECT TO anon, authenticated USING (true);

-- Completion record. UNIQUE(user_id, definition_id) is the sole
-- concurrency guard -- a race between two qualifying events both crossing
-- the target produces one winning insert and one safely-ignored
-- duplicate, the same pattern user_achievements already uses. Presence of
-- a row IS "100% complete"; progress before completion is computed live
-- from reward_ledger, never stored (no mutable counter to race on).
CREATE TABLE IF NOT EXISTS public.user_engagement_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  definition_id uuid REFERENCES public.engagement_definitions(id) ON DELETE CASCADE NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  reward_ledger_id uuid REFERENCES public.reward_ledger(id) ON DELETE SET NULL,
  -- Mirrors reward_redemptions.grant_result exactly: null when the reward
  -- was pure points (nothing pending), {status:"pending_fulfillment",
  -- grantType, grantValue} when a non-points grant_type is configured --
  -- Phase B never fulfills these, a future module does, exactly like
  -- Advertising Credit was left pending until Phase 8.4 built it.
  grant_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, definition_id)
);

CREATE INDEX IF NOT EXISTS idx_user_engagement_completions_user ON public.user_engagement_completions(user_id);

GRANT SELECT ON public.user_engagement_completions TO authenticated;
GRANT ALL ON public.user_engagement_completions TO service_role;
ALTER TABLE public.user_engagement_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own engagement completions" ON public.user_engagement_completions;
CREATE POLICY "Users can view their own engagement completions"
  ON public.user_engagement_completions FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 2. Streaks
-- ============================================================

CREATE TABLE IF NOT EXISTS public.streak_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name_bs text NOT NULL,
  name_en text NOT NULL,
  name_de text NOT NULL,
  description_bs text,
  description_en text,
  description_de text,
  -- Same Phase A scope convention: NULL = GLOBAL (any connected
  -- application's qualifying activity counts), a specific application =
  -- that application only.
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  -- What counts as "qualifying activity" for this streak -- a single
  -- event_key, matching every example in the spec (any activity, or one
  -- specific application's activity).
  event_key text REFERENCES public.event_definitions(event_key) ON DELETE CASCADE NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_streak_definitions_event_key ON public.streak_definitions(event_key);

GRANT SELECT ON public.streak_definitions TO anon, authenticated;
GRANT ALL ON public.streak_definitions TO service_role;
ALTER TABLE public.streak_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Streak definitions are publicly readable" ON public.streak_definitions;
CREATE POLICY "Streak definitions are publicly readable"
  ON public.streak_definitions FOR SELECT TO anon, authenticated USING (true);

-- Reward ladder. A milestone is granted at most once per user (see
-- user_streak_milestones) even though the user may pass threshold_days
-- again on a later, separate streak.
CREATE TABLE IF NOT EXISTS public.streak_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  streak_definition_id uuid REFERENCES public.streak_definitions(id) ON DELETE CASCADE NOT NULL,
  threshold_days integer NOT NULL CHECK (threshold_days > 0),
  reward_points integer NOT NULL DEFAULT 0,
  reward_lifetime_points integer NOT NULL DEFAULT 0,
  reward_grant_type text REFERENCES public.reward_fulfillment_types(key) ON DELETE SET NULL,
  reward_grant_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (streak_definition_id, threshold_days)
);

GRANT SELECT ON public.streak_milestones TO anon, authenticated;
GRANT ALL ON public.streak_milestones TO service_role;
ALTER TABLE public.streak_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Streak milestones are publicly readable" ON public.streak_milestones;
CREATE POLICY "Streak milestones are publicly readable"
  ON public.streak_milestones FOR SELECT TO anon, authenticated USING (true);

-- Mutable state -- the one genuine exception to "no stored counters" in
-- this migration, because current/longest streak cannot be cheaply
-- recomputed from full reward_ledger history on every event (unlike
-- Mission/Challenge progress, which is bounded by a definition's own
-- start/end window). Concurrency-safe only via advance_user_streak()
-- below -- never written directly from application code.
CREATE TABLE IF NOT EXISTS public.user_streaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  streak_definition_id uuid REFERENCES public.streak_definitions(id) ON DELETE CASCADE NOT NULL,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_qualifying_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, streak_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_user_streaks_user ON public.user_streaks(user_id);

GRANT SELECT ON public.user_streaks TO authenticated;
GRANT ALL ON public.user_streaks TO service_role;
ALTER TABLE public.user_streaks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own streak state" ON public.user_streaks;
CREATE POLICY "Users can view their own streak state"
  ON public.user_streaks FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- History -- guarantees a milestone is never granted twice for the same
-- user, via UNIQUE(user_id, milestone_id) + upsert-ignoreDuplicates, the
-- same pattern user_achievements/user_engagement_completions both use.
CREATE TABLE IF NOT EXISTS public.user_streak_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  milestone_id uuid REFERENCES public.streak_milestones(id) ON DELETE CASCADE NOT NULL,
  achieved_at timestamptz NOT NULL DEFAULT now(),
  reward_ledger_id uuid REFERENCES public.reward_ledger(id) ON DELETE SET NULL,
  grant_result jsonb,
  UNIQUE (user_id, milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_user_streak_milestones_user ON public.user_streak_milestones(user_id);

GRANT SELECT ON public.user_streak_milestones TO authenticated;
GRANT ALL ON public.user_streak_milestones TO service_role;
ALTER TABLE public.user_streak_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own streak milestones" ON public.user_streak_milestones;
CREATE POLICY "Users can view their own streak milestones"
  ON public.user_streak_milestones FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 3. Configuration (Configuration First -- same key/value shape as
--    reward_config/trial_policy/ad_config, kept as its own table rather
--    than folded into reward_config, matching how ad_config is its own
--    table despite also being "just config").
-- ============================================================

CREATE TABLE IF NOT EXISTS public.engagement_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.engagement_config TO anon, authenticated;
GRANT ALL ON public.engagement_config TO service_role;
ALTER TABLE public.engagement_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Engagement config is publicly readable" ON public.engagement_config;
CREATE POLICY "Engagement config is publicly readable"
  ON public.engagement_config FOR SELECT TO anon, authenticated USING (true);

-- IANA timezone used to bucket streak "days" -- an explicit, approved
-- architectural decision (Priority 15 Phase B), not a guess: this
-- platform has no per-user timezone concept anywhere, so one platform-wide
-- configured timezone is used for every user's streak day-boundary until
-- (if ever) a genuine per-user timezone is introduced. Admin-editable
-- without a deployment, exactly like every other config table here.
INSERT INTO public.engagement_config (key, value, description) VALUES
  ('streak_timezone', '"Europe/Sarajevo"'::jsonb, 'IANA timezone used to compute streak day-boundaries for every user.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. advance_user_streak() -- atomic streak-state advancement.
--
-- PostgREST cannot express "read current state, decide same-day /
-- consecutive-day / gap, write new state" as a single atomic operation --
-- the same limitation Priority 12 Phase 5's event_analytics_* functions
-- already worked around with a service_role-only Postgres function. This
-- follows that exact precedent, not a new mechanism. SELECT ... FOR
-- UPDATE inside a single function call means concurrent calls for the
-- same (user, streak) serialize on the row lock rather than racing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.advance_user_streak(
  p_user_id uuid,
  p_streak_definition_id uuid,
  p_activity_date date
) RETURNS TABLE(current_streak integer, longest_streak integer, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_date date;
  v_prev_current integer;
  v_new_current integer;
  v_new_longest integer;
  v_changed boolean;
BEGIN
  INSERT INTO public.user_streaks (user_id, streak_definition_id, current_streak, longest_streak, last_qualifying_date, updated_at)
  VALUES (p_user_id, p_streak_definition_id, 0, 0, NULL, now())
  ON CONFLICT (user_id, streak_definition_id) DO NOTHING;

  SELECT us.last_qualifying_date, us.current_streak
    INTO v_prev_date, v_prev_current
    FROM public.user_streaks us
    WHERE us.user_id = p_user_id AND us.streak_definition_id = p_streak_definition_id
    FOR UPDATE;

  IF v_prev_date IS NOT NULL AND v_prev_date = p_activity_date THEN
    v_new_current := v_prev_current;
    v_changed := false;
  ELSIF v_prev_date IS NOT NULL AND v_prev_date = p_activity_date - 1 THEN
    v_new_current := v_prev_current + 1;
    v_changed := true;
  ELSE
    v_new_current := 1;
    v_changed := true;
  END IF;

  UPDATE public.user_streaks
    SET current_streak = v_new_current,
        longest_streak = GREATEST(longest_streak, v_new_current),
        last_qualifying_date = p_activity_date,
        updated_at = now()
    WHERE user_id = p_user_id AND streak_definition_id = p_streak_definition_id
    RETURNING longest_streak INTO v_new_longest;

  RETURN QUERY SELECT v_new_current, v_new_longest, v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_user_streak(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_user_streak(uuid, uuid, date) TO service_role;
