-- Fixes a genuine bug found while live-verifying this same day's
-- 20260819100000 migration: notifications_user_dedupe_key_idx was created
-- as a PARTIAL unique index (`WHERE dedupe_key IS NOT NULL`). Postgres's
-- `ON CONFLICT (user_id, dedupe_key)` inference cannot match a partial
-- index unless the exact same WHERE predicate is repeated in the ON
-- CONFLICT clause itself -- confirmed live: a plain
-- `INSERT ... ON CONFLICT (user_id, dedupe_key) DO NOTHING` against this
-- index fails with `42P10: there is no unique or exclusion constraint
-- matching the ON CONFLICT specification`. PostgREST's upsert
-- (`.upsert(row, { onConflict: "user_id,dedupe_key" })`, used throughout
-- notify.server.ts) has no way to express that predicate, so every
-- dedup-requesting call site would have silently failed in production.
--
-- Fix: a plain (non-partial) unique index. This is semantically identical
-- for our purposes -- Postgres never considers two NULLs equal in a
-- unique index (no NULLS NOT DISTINCT here), so rows with dedupe_key IS
-- NULL (the majority of notifications, which never request dedup) still
-- never conflict with each other or with anything else. Only rows that
-- share both user_id and a non-null dedupe_key are deduplicated, exactly
-- the original intent, now actually achievable via ON CONFLICT inference.
DROP INDEX IF EXISTS public.notifications_user_dedupe_key_idx;
CREATE UNIQUE INDEX notifications_user_dedupe_key_idx
  ON public.notifications(user_id, dedupe_key);
