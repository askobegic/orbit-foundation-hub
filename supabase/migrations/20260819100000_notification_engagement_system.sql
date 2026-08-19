-- CORE Notification & User Engagement System.
--
-- Extends the existing notifications/profiles/event_rules infrastructure
-- rather than creating parallel tables (Reuse Before Create). See
-- PROJECT_KNOWLEDGE.md -> Notifications & User Engagement.

-- === notifications: dedup, delivery tracking, read timestamp, two new
-- categories ===
-- dedupe_key + the partial unique index below give every notification
-- call site atomic, DB-enforced duplicate protection via
-- upsert(...,{onConflict:'user_id,dedupe_key', ignoreDuplicates:true}) --
-- the same idempotency pattern user_achievements/reward_milestones already
-- use (checkAchievements/evaluatePremiumMilestones), applied here for the
-- first time to notifications themselves. NULL dedupe_key (most existing
-- call sites, unchanged) means "no dedup requested", never blocked.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (email_status IN ('not_applicable', 'pending', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS email_error text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_key_idx
  ON public.notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 'message' and 'inactivity' join the existing Priority 15 Phase D
-- vocabulary (information/reward/premium/offer/warning/system).
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IS NULL OR category IN
    ('information', 'reward', 'premium', 'offer', 'warning', 'system', 'message', 'inactivity'));

-- === profiles: activity tracking + per-category email opt-out ===
-- last_active_at is updated from the client's existing loadOrCreateProfile
-- (AuthContext.tsx), which already runs exactly once per session/
-- auth-state-change and already performs a profile UPDATE in the same
-- pass (identity re-sync) -- no new round trip. Low-stakes, self-scoped
-- field (unlike user_type/is_verified/roles): a user manipulating their
-- own last_active_at can only affect whether *they themselves* receive an
-- inactivity reminder, never another user's data or an authorization
-- decision, so no WITH CHECK narrower than the existing "own row" UPDATE
-- policy is required.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_disabled_categories text[] NOT NULL DEFAULT '{}';

-- profiles.authenticated UPDATE is a fail-closed column allowlist
-- (20260726120000_protect_profile_privileged_columns.sql, closing AU-1/
-- DB-1): a new column is NOT writable by a regular user until explicitly
-- granted here, the same additive pattern
-- 20260729130100_restore_missing_notification_prefs.sql already used for
-- notify_email/notify_in_app/notify_marketing. Without this, both new
-- columns' only client-side write paths (AuthContext.tsx's
-- loadOrCreateProfile, dashboard.settings.tsx via updateUserSettings)
-- would fail with a permission-denied error in production.
GRANT UPDATE (last_active_at, email_disabled_categories) ON public.profiles TO authenticated;

-- Backfill: every existing user is treated as active as of this migration
-- rather than NULL (which the inactivity sweep would otherwise have to
-- special-case as "never seen"), so shipping this doesn't instantly flood
-- the whole existing user base with inactivity reminders.
UPDATE public.profiles SET last_active_at = now() WHERE last_active_at IS NULL;

-- === event_rules: optional application-specific notification hook ===
-- When notify_category is set, recordEvent() (events.server.ts) sends a
-- notification alongside the existing points/achievement handling --
-- admin-configured content, no CORE-hardcoded per-application text.
-- Nullable throughout: an event_rule that never sets these behaves exactly
-- as before (points/achievements only, no notification).
ALTER TABLE public.event_rules
  ADD COLUMN IF NOT EXISTS notify_category text
    CHECK (notify_category IS NULL OR notify_category IN
      ('information', 'reward', 'premium', 'offer', 'warning', 'system', 'message', 'inactivity')),
  ADD COLUMN IF NOT EXISTS notify_title_bs text,
  ADD COLUMN IF NOT EXISTS notify_title_en text,
  ADD COLUMN IF NOT EXISTS notify_title_de text,
  ADD COLUMN IF NOT EXISTS notify_message_bs text,
  ADD COLUMN IF NOT EXISTS notify_message_en text,
  ADD COLUMN IF NOT EXISTS notify_message_de text,
  ADD COLUMN IF NOT EXISTS notify_target_path text
    CHECK (notify_target_path IS NULL OR notify_target_path ~ '^/dashboard/[a-zA-Z0-9/_-]*$');
