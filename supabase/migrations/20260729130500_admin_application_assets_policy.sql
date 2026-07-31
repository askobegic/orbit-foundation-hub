
-- Admin write access to core/applications/<slug>/... (logo/favicon uploads).
--
-- Originally written against private.has_role(auth.uid(), 'admin'::public.app_role),
-- matching the pattern used elsewhere in this repo's migration history --
-- but direct live verification (pg_type, information_schema.routines) confirmed
-- neither public.app_role nor private.has_role()/public.has_role() actually
-- exist in this database. An earlier bulk `migration repair --status applied`
-- pass incorrectly marked the migrations that were supposed to create them
-- (20260724132534, 20260725070421) as already applied, based on partial
-- evidence, without verifying each one individually.
--
-- Corrected to check public.user_roles directly instead -- the same table
-- and pattern src/lib/admin.server.ts's assertAdmin() already uses and is
-- proven to work, with role stored as plain text, not an enum.
DROP POLICY IF EXISTS "Admins insert application assets in core" ON storage.objects;
CREATE POLICY "Admins insert application assets in core" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'core'
    AND (storage.foldername(name))[1] = 'applications'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins update application assets in core" ON storage.objects;
CREATE POLICY "Admins update application assets in core" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'core'
    AND (storage.foldername(name))[1] = 'applications'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins delete application assets in core" ON storage.objects;
CREATE POLICY "Admins delete application assets in core" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'core'
    AND (storage.foldername(name))[1] = 'applications'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
