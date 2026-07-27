
CREATE POLICY "client_photos_own_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "client_photos_own_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "client_photos_own_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
