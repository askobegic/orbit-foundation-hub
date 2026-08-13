-- Migration-integrity repair (Phase 1D, Branch A): recreates the
-- documented admin-role-check architecture that has been missing from
-- production since it was first written, not a new design.
--
-- Root cause (live-verified 2026-08-13 via pg_proc/pg_type, and
-- independently corroborated by 20260729130500's own header comment from
-- 2026-07-29 describing the same discovery): an early bulk
-- `migration repair --status applied` operation incorrectly marked
-- 20260724132534 and 20260725070421 as already applied without actually
-- running them. public.app_role, public.has_role(), and
-- private.has_role() have therefore never existed in production. This is
-- the same root-cause family as SE-16/SE-17/DB-6.
--
-- This migration recreates ONLY what current, documented architecture
-- actually needs going forward:
--   - public.app_role (the enum type -- referenced by every has_role
--     call site, including the ~11 policies 20260725070421 defines but
--     which this migration deliberately does NOT recreate here -- see
--     Phase 4 finding, tracked separately in PROJECT_AUDIT.md, not
--     bundled into this integrity repair).
--   - private.has_role() -- the CURRENT canonical function per
--     PROJECT_KNOWLEDGE.md and every migration after 20260725070421.
--
-- Deliberately NOT recreated: public.has_role(). 20260724132534 created
-- it, but 20260725070421 -- the migration this repair treats as the
-- source of truth for "documented architecture" -- immediately
-- superseded and dropped it in favor of private.has_role(). Recreating a
-- function the architecture itself retired would contradict, not
-- restore, the documented design; no code or migration after
-- 20260725070421 references public.has_role() again (confirmed by
-- repository-wide search).
--
-- CRITICAL COMPATIBILITY NOTE (from the Phase 1D safety check): the
-- original private.has_role() body compares user_roles.role = _role,
-- i.e. an app_role enum value against the role column directly. Live
-- verification during the 2026-07-29 incident (20260729130500's header)
-- found user_roles.role is actually stored as plain text in production,
-- not the app_role enum -- consistent with app_role never having existed
-- at the time user_roles was created. Comparing a text column directly
-- against an app_role-typed parameter would fail at execution time
-- (no implicit cast between an unrelated enum and text). This migration
-- therefore casts both sides to text for the comparison
-- (role::text = _role::text) instead of the original bare `role = _role`.
-- This is a compatibility bridge, not an architecture change: the
-- function's signature, security posture (SECURITY DEFINER, STABLE,
-- SET search_path = public), and grants are all otherwise byte-for-byte
-- identical to 20260725070421's original definition, so every existing
-- call site (`private.has_role(auth.uid(), 'admin'::public.app_role)`)
-- continues to work unchanged. The cast is safe regardless of whether
-- user_roles.role turns out to already be text or the enum -- it works
-- either way. Flagged explicitly rather than silently adjusted, per this
-- repository's rule against unapproved deviations from documented
-- architecture; recommend confirming user_roles.role's live column type
-- as part of Phase 7 verification.
--
-- Exception-safe (CREATE TYPE has no native IF NOT EXISTS): does not
-- fail if public.app_role already exists. Does not drop or alter any
-- existing type, table, or role data. Does not touch user_roles' schema
-- or contents in any way.

DO $$
BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = _role::text
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
