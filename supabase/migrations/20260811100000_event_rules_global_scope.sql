-- Priority 15 Phase A: Global vs Application Engagement Scope.
--
-- Extends the existing Universal Event & Rewards Engine (Priority 12) --
-- does not replace or duplicate any part of it. Only event_rules changes;
-- event_definitions, application_events, event_rule_conditions,
-- event_abuse_flags, and reward_ledger are untouched.
--
-- Convention: app_id NULL = GLOBAL (applies to every application that has
-- the event enabled via its own application_events row), app_id = a
-- specific application = APPLICATION-scoped, which always overrides the
-- global rule for the same event_key when both exist. This is the same
-- "global row (app_id NULL) or per-application override" shape already
-- established by ad_placement_prices (20260801150000_advertising.sql) --
-- not a new pattern invented for this migration.
--
-- application_events (the per-app "is this event live here at all" gate)
-- is deliberately NOT changed -- an application must still explicitly opt
-- into an event before any rule (global or app-specific) is ever
-- evaluated for it. Global scope affects reward configuration only, never
-- event authorization.

ALTER TABLE public.event_rules ALTER COLUMN app_id DROP NOT NULL;

-- The existing UNIQUE(app_id, event_key) constraint never treats two NULL
-- app_id rows as colliding (standard Postgres unique-constraint
-- semantics), so it alone would allow multiple global rules for the same
-- event_key. This partial index closes that gap, guaranteeing at most one
-- global rule per event_key, the same way idx_reward_ledger_dedupe uses a
-- partial index for its own NULL-excluding uniqueness requirement.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_rules_global_event_key
  ON public.event_rules(event_key)
  WHERE app_id IS NULL;
