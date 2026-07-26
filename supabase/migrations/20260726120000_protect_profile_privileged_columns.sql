
-- Restrict which profiles columns `authenticated` may UPDATE.
--
-- The RLS "Users can update own profile" policy only ever restricted
-- *which row* could be updated (auth.uid() = id); the table-level
-- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated`
-- (see the initial schema migration) covered every column, including
-- user_type, is_verified, and is_active. Combined with the app forwarding
-- client-supplied update payloads largely unfiltered, this allowed any
-- authenticated user to grant themselves premium/admin status or a fake
-- verified badge. See PROJECT_AUDIT.md -> AU-1 / DB-1.
--
-- Fixed with column-level privileges rather than a trigger or a split
-- table: Postgres checks column grants before RLS and before any trigger
-- runs, so this is enforced natively, rejects the whole statement with a
-- standard permission-denied error (no custom "reject vs revert" logic
-- to write or get wrong), and -- critically -- is fail-closed for any
-- column added to this table in the future: a new column is NOT
-- writable by `authenticated` until someone explicitly grants it here,
-- the opposite failure mode of a trigger that has to remember to
-- protect new sensitive columns as they're added.
--
-- service_role is unaffected: it already holds a separate, table-level
-- `GRANT ALL ON public.profiles TO service_role` (unchanged by this
-- migration), which a column-level grant to a different role does not
-- narrow. All existing service-role write paths (admin.functions.ts,
-- the Stripe/PayPal webhooks) continue to work exactly as before.
--
-- id, user_type, is_verified, and is_active are intentionally left out
-- of the column list below -- only service_role may write them. The
-- columns granted below are exactly the set every current client write
-- path already uses (verified against AuthContext.tsx's updateProfile,
-- its loadOrCreateProfile OAuth-metadata patch, and
-- LanguageContext.tsx's language update).

REVOKE UPDATE ON public.profiles FROM authenticated;

GRANT UPDATE (
  first_name,
  last_name,
  avatar_url,
  city,
  country,
  username,
  bio,
  language,
  email,
  profile_complete
) ON public.profiles TO authenticated;

-- Make the row-level check explicit. Behaviorally unchanged (USING was
-- already implicitly reused as the check clause), but every UPDATE
-- policy should state its WITH CHECK explicitly rather than rely on
-- the implicit default.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
