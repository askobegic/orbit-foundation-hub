
CREATE POLICY "Admins manage app-logos" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'app-logos' AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (bucket_id = 'app-logos' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "App logos readable by authenticated" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'app-logos');
