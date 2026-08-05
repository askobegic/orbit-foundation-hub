-- Priority 8.9: Application Visibility & Localization.
--
-- Consolidates the two overlapping, independently-drifting flags an
-- application previously had (`status` text enum: active/coming_soon/
-- archived, and a separate `is_enabled` boolean layered on top later) into
-- one single `visibility` state, per the explicit requirement that "every
-- application must have one visibility state." The old combination let a
-- row be simultaneously `status = 'active'` and `is_enabled = false` --
-- two flags answering overlapping questions with no single source of
-- truth for "is this application visible right now."
--
-- New states: draft (hidden from all normal users, admin-only -- did not
-- exist before; the closest prior equivalent, is_enabled = false, still
-- showed as a generic "Coming Soon" tile to every user), coming_soon
-- (unchanged meaning), active (unchanged meaning), archived (unchanged
-- meaning). Soft lifecycle, matching the Priority 8 convention every other
-- registry in this codebase follows -- no application row is ever deleted,
-- only moved between these four states.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'draft'
    CHECK (visibility IN ('draft', 'coming_soon', 'active', 'archived'));

-- Backfill from the two columns being retired: an application that was
-- never enabled becomes draft (closest real equivalent to "hidden, not yet
-- ready"); otherwise the existing status carries over unchanged.
UPDATE public.applications
SET visibility = CASE
  WHEN NOT is_enabled THEN 'draft'
  WHEN status = 'archived' THEN 'archived'
  WHEN status = 'coming_soon' THEN 'coming_soon'
  ELSE 'active'
END;

-- Launch Date (Priority 8.9): informational only, optional, shown next to
-- a Coming Soon application. Never read by any activation logic -- there
-- is no scheduled job anywhere in this codebase (a deliberate, standing
-- convention, see PROJECT_KNOWLEDGE.md -> Advertising/Rewards for the same
-- "no cron infrastructure" precedent) and this column does not become the
-- first one. Moving an application from coming_soon to active is always a
-- separate, explicit administrator action, regardless of whether this date
-- has passed.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS launch_date timestamptz;

-- Localization resolution order, step 3 (Priority 8.9, see API_CONTRACT.md
-- -> Localization): an application's own default language, consulted after
-- the request's Accept-Language header and the signed-in user's own
-- profile.language, before falling back to English. Nullable -- an
-- application with no configured default simply has nothing to contribute
-- at this step, falling through to the next one.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS default_language text
    CHECK (default_language IS NULL OR default_language IN ('bs', 'en', 'de'));

-- Both retired columns are fully superseded by `visibility` above -- kept
-- as two separate, independently-settable flags they would directly
-- contradict "one visibility state." Dropped only after every value has
-- already been folded into `visibility` by the backfill above, so no
-- information is lost.
ALTER TABLE public.applications DROP COLUMN IF EXISTS is_enabled;
ALTER TABLE public.applications DROP COLUMN IF EXISTS status;
