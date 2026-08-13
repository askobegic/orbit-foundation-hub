-- Priority 16 Phase B: configures the approved "Comment +2, max 5/day"
-- rule centrally, reusing the EXISTING Universal Event Engine
-- (event_rules.daily_limit, Priority 12) rather than a new rate-limit
-- mechanism. comment_created was already seeded as event vocabulary in
-- 20260808100000_universal_event_engine_phase1.sql but has never had a
-- rule configured for it (confirmed by the Phase A audit) -- this is the
-- first one.
--
-- Global (app_id = NULL): available to every connected application the
-- moment it enables comment_created via its own application_events row --
-- no application currently emits this event yet (Phase A audit), so this
-- rule is inert in practice until that integration exists, exactly like
-- every other not-yet-integrated CORE event rule.

-- Targets idx_event_rules_global_event_key (the partial unique index
-- Phase A's migration created specifically for global rows) -- the plain
-- (app_id, event_key) UNIQUE constraint never matches two NULL app_id
-- rows as conflicting, so ON CONFLICT must name this index's own key
-- expression instead.
INSERT INTO public.event_rules (app_id, event_key, points, lifetime_points, cooldown_seconds, daily_limit, repeatable)
VALUES (NULL, 'comment_created', 2, 2, 0, 5, true)
ON CONFLICT (event_key) WHERE app_id IS NULL DO NOTHING;
