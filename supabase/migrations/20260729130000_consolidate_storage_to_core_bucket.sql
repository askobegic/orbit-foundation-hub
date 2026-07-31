
-- Consolidate all uploads onto the single "core" storage bucket.
--
-- The `avatars` and `app-logos` buckets were only ever referenced in RLS
-- policies and application code -- neither was ever actually created as a
-- bucket (confirmed by direct inspection of storage.buckets against the
-- live project), so every avatar/logo/favicon upload has been failing with
-- "Bucket not found" since those features were built. `core` already
-- exists (public) but was never tracked in a migration and had no RLS.
--
-- Fix: track `core` here so its existence/public flag is no longer
-- untracked drift, drop the dead policies referencing bucket ids that will
-- never exist, and add policies scoped to `core` by folder prefix instead
-- of by bucket id (`avatars/<user_id>/...`, `applications/<slug>/...`).

INSERT INTO storage.buckets (id, name, public)
VALUES ('core', 'core', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop dead policies referencing bucket ids that were never real.
DROP POLICY IF EXISTS "Avatars are readable" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Admins manage app-logos" ON storage.objects;
DROP POLICY IF EXISTS "App logos readable by authenticated" ON storage.objects;

-- Public read for everything in `core` -- both avatars and application
-- logos/favicons are rendered on fully public pages (public profile,
-- login), matching how `avatars` was already public and correcting
-- `app-logos`, which was previously (incorrectly) authenticated-only.
DROP POLICY IF EXISTS "Core bucket is publicly readable" ON storage.objects;
CREATE POLICY "Core bucket is publicly readable" ON storage.objects
  FOR SELECT USING (bucket_id = 'core');

-- Users manage only their own avatar folder: core/avatars/<user_id>/...
DROP POLICY IF EXISTS "Users upload own avatar in core" ON storage.objects;
CREATE POLICY "Users upload own avatar in core" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'core'
    AND (storage.foldername(name))[1] = 'avatars'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users update own avatar in core" ON storage.objects;
CREATE POLICY "Users update own avatar in core" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'core'
    AND (storage.foldername(name))[1] = 'avatars'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own avatar in core" ON storage.objects;
CREATE POLICY "Users delete own avatar in core" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'core'
    AND (storage.foldername(name))[1] = 'avatars'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Admin policy for core/applications/<slug>/... is in a separate migration
-- (20260729130500_admin_application_assets_policy.sql) -- isolated there
-- during troubleshooting of a db-push-specific failure referencing
-- private.has_role(); see that file's header for details.
