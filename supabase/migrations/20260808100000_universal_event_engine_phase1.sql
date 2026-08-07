-- Priority 12 Phase 1: Universal Event & Rewards Engine -- schema foundation.
--
-- Purely additive. Every new table here is entirely parallel to the
-- existing reward_action_rules-driven flow, which keeps deciding points
-- for CORE's own internal grants (premium_purchase, invite_registration,
-- premium_renewal, premium_referral_verified, advertising_purchase, and
-- the application-reported business_approved/vendor_approved/etc. rows)
-- exactly as today -- nothing here is a fallback or override path for it.
-- reward_ledger gains only new nullable/DEFAULT-backed columns; no
-- existing column is renamed or removed, so every existing INSERT
-- (webhooks, onboarding, admin grants) keeps working completely
-- unchanged. See rewards.server.ts for the accompanying code change that
-- populates the new columns with backward-compatible defaults, and
-- PROJECT_KNOWLEDGE.md -> Rewards & Loyalty / Universal Event Engine for
-- the full design.
--
-- Event key naming note: event_definitions uses its own vocabulary
-- (photo_uploaded, premium_purchased, referral_registered, ...) which is
-- deliberately distinct from reward_action_rules' existing action names
-- (premium_purchase, invite_registration, ...) even where conceptually
-- similar -- these are two separate, parallel systems (CORE-internal
-- hardcoded call sites vs. application-reported rule-engine events), not
-- duplicate/colliding definitions of the same thing.

-- ============================================================
-- 1. Event Registry (Phase 2)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text UNIQUE NOT NULL,
  display_name text NOT NULL,
  description text,
  category text,
  icon text,
  -- true for a small set of CORE-defined events an admin cannot delete
  -- (none seeded as system today -- reserved for future CORE-owned
  -- events that must always exist); every event seeded by this
  -- migration is is_system = false, matching that they are all
  -- application-reported, not CORE-internal.
  is_system boolean NOT NULL DEFAULT false,
  -- Observability only, not a compatibility mechanism -- see the
  -- versioning-strategy comment below. Auto-incremented by
  -- adminUpsertEventDefinition on every update.
  version integer NOT NULL DEFAULT 1,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Versioning strategy (documented here, not just in code, since it's a
-- schema-level guarantee): event_key is permanent and immutable once
-- created, exactly like reward_action_rules.action and
-- capability_definitions.key -- never renamed, never repurposed for a
-- different meaning. reward_ledger.action (and this engine's own
-- ledger rows, keyed by event_key in the same column) already records
-- history permanently and independently of any later edit to the
-- definition row, so a historical event is never affected by a
-- later change. If an event's meaning must change in a breaking way,
-- the correct move is to archive the old event_key and create a new
-- one -- never edit an existing key's meaning in place. `version` is a
-- lightweight edit counter for admin visibility, paired with
-- writeAuditLog's full old/new diff (the real change history);
-- it does not itself gate or branch any evaluation logic.

GRANT SELECT ON public.event_definitions TO anon, authenticated;
GRANT ALL ON public.event_definitions TO service_role;
ALTER TABLE public.event_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Event definitions are publicly readable" ON public.event_definitions;
CREATE POLICY "Event definitions are publicly readable"
  ON public.event_definitions FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- 2. Application Mapping (Phase 3) -- same shape as
--    application_capabilities: per-application on/off, fails closed (no
--    row = disabled).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL,
  event_key text REFERENCES public.event_definitions(event_key) ON DELETE CASCADE NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_application_events_app ON public.application_events(app_id);

GRANT SELECT ON public.application_events TO anon, authenticated;
GRANT ALL ON public.application_events TO service_role;
ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Application events are publicly readable" ON public.application_events;
CREATE POLICY "Application events are publicly readable"
  ON public.application_events FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- 3. Reward Rule Engine (Phase 4) -- per (application, event) reward
--    configuration. Only ever consulted for an application-reported
--    event going through the new recordEvent() pipeline (Phase 3 of
--    this implementation) -- reward_action_rules remains the sole
--    source of truth for CORE-internal actions.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid REFERENCES public.applications(id) ON DELETE CASCADE NOT NULL,
  event_key text REFERENCES public.event_definitions(event_key) ON DELETE CASCADE NOT NULL,
  points integer NOT NULL DEFAULT 0,
  -- Independent from `points` (Priority 12 decision 1). Application
  -- code keeps these equal by default when an admin doesn't
  -- deliberately diverge them.
  lifetime_points integer NOT NULL DEFAULT 0,
  cooldown_seconds integer NOT NULL DEFAULT 0,
  max_executions integer,
  daily_limit integer,
  weekly_limit integer,
  monthly_limit integer,
  priority integer NOT NULL DEFAULT 0,
  repeatable boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_event_rules_app ON public.event_rules(app_id);

GRANT SELECT ON public.event_rules TO anon, authenticated;
GRANT ALL ON public.event_rules TO service_role;
ALTER TABLE public.event_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Event rules are publicly readable" ON public.event_rules;
CREATE POLICY "Event rules are publicly readable"
  ON public.event_rules FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- 4. Rule Conditions (Phase 8) -- zero or more per rule, all must pass.
--    condition_type is a small, code-implemented, growing set of
--    predicates (see rewards.server.ts) -- which conditions apply and
--    their thresholds are admin-configurable without code; a genuinely
--    new predicate requires a code change, the same tradeoff
--    reward_fulfillment_types already has (a new type needs a module
--    to implement it).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_rule_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.event_rules(id) ON DELETE CASCADE NOT NULL,
  condition_type text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_rule_conditions_rule ON public.event_rule_conditions(rule_id);

GRANT SELECT ON public.event_rule_conditions TO anon, authenticated;
GRANT ALL ON public.event_rule_conditions TO service_role;
ALTER TABLE public.event_rule_conditions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Event rule conditions are publicly readable" ON public.event_rule_conditions;
CREATE POLICY "Event rule conditions are publicly readable"
  ON public.event_rule_conditions FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- 5. Anti-abuse flags (Phase 9) -- an administrator-review queue, never
--    an automatic block. No anon/authenticated policy at all -- admin-
--    only, matching audit_logs' service_role-only precedent (not even
--    the flagged user may read their own flags).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_abuse_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  event_key text,
  app_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_abuse_flags_user ON public.event_abuse_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_event_abuse_flags_reviewed ON public.event_abuse_flags(reviewed);

GRANT ALL ON public.event_abuse_flags TO service_role;
ALTER TABLE public.event_abuse_flags ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. reward_ledger extensions
-- ============================================================

-- Priority 12 decision 1: Lifetime Points independent from Reward
-- Points. Backfilled to equal `points` for every existing row -- every
-- historical grant already set lifetime implicitly equal to points (see
-- PROJECT_KNOWLEDGE.md -> Rewards & Loyalty), so this backfill changes
-- nothing about any existing user's computed Lifetime Points.
ALTER TABLE public.reward_ledger ADD COLUMN IF NOT EXISTS lifetime_points integer;
UPDATE public.reward_ledger SET lifetime_points = points WHERE lifetime_points IS NULL;
ALTER TABLE public.reward_ledger ALTER COLUMN lifetime_points SET NOT NULL;
ALTER TABLE public.reward_ledger ALTER COLUMN lifetime_points SET DEFAULT 0;

-- Event source/origin tracking. Defaults to 'core' -- every ledger row
-- written before this migration came from a CORE-internal call site
-- (webhooks, onboarding, admin grants), so this default is the accurate
-- historical value, not a guess. 'application'/'api' are both reserved
-- for application-reported events (recordEvent(), Phase 3 of this
-- implementation) -- 'api' for the public /v1/events endpoint (the
-- normal path), 'application' reserved for a possible future non-REST
-- integration path. 'n8n' is reserved for a future reverse-direction
-- integration (today n8n only receives events from CORE, never sends
-- any back) -- included now so the CHECK constraint doesn't need a
-- later migration once that direction exists.
ALTER TABLE public.reward_ledger ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'core';
ALTER TABLE public.reward_ledger DROP CONSTRAINT IF EXISTS reward_ledger_origin_check;
ALTER TABLE public.reward_ledger ADD CONSTRAINT reward_ledger_origin_check
  CHECK (origin IN ('core', 'application', 'api', 'n8n', 'manual_admin', 'system'));

-- Actor vs. recipient (Phase 7/8): who performed the action vs. who is
-- rewarded -- needed for conditions like "not self-like". Backfilled to
-- user_id (the recipient) for every existing row, matching every
-- existing call site's implicit "the actor and the recipient are the
-- same person" behavior.
ALTER TABLE public.reward_ledger ADD COLUMN IF NOT EXISTS actor_user_id uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL;
UPDATE public.reward_ledger SET actor_user_id = user_id WHERE actor_user_id IS NULL;

-- Extensible metadata (Phase 7). Additive alongside the existing
-- resource_type/resource_id/source_app_id columns, which are kept
-- exactly as they are -- never renamed or removed.
ALTER TABLE public.reward_ledger ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Idempotency (Phase 9 anti-abuse): an application-supplied key, unique
-- per (app, action) when provided, so a retried/duplicated event
-- submission can't grant points twice. NULL (every existing/CORE-
-- internal row) is never considered a duplicate of another NULL --
-- Postgres treats NULLs as distinct values in a unique index.
ALTER TABLE public.reward_ledger ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_ledger_dedupe
  ON public.reward_ledger(source_app_id, action, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Manual admin adjustments (Phase 4 of this implementation) are the one
-- documented, deliberate exception to "every row's points is non-
-- negative" -- an admin correcting a fraud/error case needs to be able
-- to subtract. Every other origin keeps the existing non-negative
-- guarantee, enforced at the database level.
ALTER TABLE public.reward_ledger DROP CONSTRAINT IF EXISTS reward_ledger_points_nonneg_check;
ALTER TABLE public.reward_ledger ADD CONSTRAINT reward_ledger_points_nonneg_check
  CHECK (origin = 'manual_admin' OR (points >= 0 AND lifetime_points >= 0));

-- Seed the event vocabulary named in Priority 12's brief. All
-- is_system = false (application-reported, not CORE-internal).
-- Inactive in effect (not behaviorally live) until an admin creates an
-- application_events row enabling one for a specific application and
-- an event_rules row configuring its reward -- inserting these rows
-- changes no runtime behavior by itself.
INSERT INTO public.event_definitions (event_key, display_name, category, display_order) VALUES
  ('photo_uploaded', 'Photo Uploaded', 'Content', 10),
  ('photo_deleted', 'Photo Deleted', 'Content', 20),
  ('photo_liked', 'Photo Liked', 'Engagement', 30),
  ('photo_unliked', 'Photo Unliked', 'Engagement', 40),
  ('photo_shared', 'Photo Shared', 'Social', 50),
  ('video_uploaded', 'Video Uploaded', 'Content', 60),
  ('video_liked', 'Video Liked', 'Engagement', 70),
  ('post_created', 'Post Created', 'Content', 80),
  ('post_updated', 'Post Updated', 'Content', 90),
  ('post_deleted', 'Post Deleted', 'Content', 100),
  ('post_liked', 'Post Liked', 'Engagement', 110),
  ('post_shared', 'Post Shared', 'Social', 120),
  ('comment_created', 'Comment Created', 'Community', 130),
  ('comment_deleted', 'Comment Deleted', 'Community', 140),
  ('comment_received', 'Comment Received', 'Community', 150),
  ('comment_liked', 'Comment Liked', 'Engagement', 160),
  ('profile_completed', 'Profile Completed', 'Verification', 170),
  ('profile_verified', 'Profile Verified', 'Verification', 180),
  ('referral_registered', 'Referral Registered', 'Referral', 190),
  ('verified_referral', 'Verified Referral', 'Referral', 200),
  ('premium_purchased', 'Premium Purchased', 'Premium', 210),
  ('premium_renewed', 'Premium Renewed', 'Premium', 220),
  ('vendor_booked', 'Vendor Booked', 'Commerce', 230),
  ('ticket_purchased', 'Ticket Purchased', 'Commerce', 240)
ON CONFLICT (event_key) DO NOTHING;
