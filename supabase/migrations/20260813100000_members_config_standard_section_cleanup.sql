-- Migration-integrity repair (Phase 1D), replacing an in-place edit that
-- was previously made to the already-applied 20260812110000 (never edit
-- an applied migration -- CLAUDE.md Migration Rules). 20260812110000 has
-- been restored to its original committed content (a rename via UPDATE);
-- this migration is the proper, new, standalone corrective step instead.
--
-- Root cause (live-verified, Priority 16 Phase C): production already
-- carried a standard_section_count row alongside verified_section_count
-- before 20260812110000 ran -- drift from outside CLI-tracked migration
-- history -- so that migration's UPDATE-based rename matched nothing
-- (its WHERE key = 'verified_section_count' target no longer existed in
-- the shape it expected) and standard_section_count already existed with
-- its own value. This migration reconciles that: it does not rename or
-- overwrite anything, it only ensures the required key exists (inserting
-- a default only if genuinely absent, e.g. a fresh install) and removes
-- the obsolete keys outright. premium_section_count and
-- directory_page_size are untouched by this migration entirely.
--
-- Idempotent and safe on both current production and a fresh database:
-- INSERT ... ON CONFLICT DO NOTHING never overwrites an existing value,
-- and DELETE ... WHERE key IN (...) is a no-op if those keys are already
-- gone.

INSERT INTO public.members_config (key, value, description) VALUES
  ('standard_section_count', '6'::jsonb, 'How many cards to show in the Standard Members section on the Members landing page.')
ON CONFLICT (key) DO NOTHING;

DELETE FROM public.members_config WHERE key IN ('verified_section_count', 'new_section_count', 'new_member_days');
