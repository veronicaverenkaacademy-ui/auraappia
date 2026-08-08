-- Bucket público para logo e capa da empresa (Portal Público, /l/:slug). Diferente de
-- client-photos (privado, signed URLs — fotos de cliente são sensíveis), este bucket é
-- criado com public = true porque a landing é lida sem login. Leitura pública vem do
-- flag nativo do bucket, não de uma policy de SELECT em storage.objects — a mesma lição
-- do incidente corrigido em 20260808121500_lock_public_views_readonly.sql: nunca abrir
-- RLS de leitura para anon quando existe o mecanismo nativo certo para isso.
--
-- Caminho dos objetos: {owner_id}/logo e {owner_id}/cover, sem extensão no nome (o tipo
-- real fica no Content-Type do objeto) — upsert:true faz todo reenvio substituir o mesmo
-- objeto, garantindo por construção que nunca sobra arquivo órfão mesmo trocando de
-- formato (ex.: png por webp). Limitação conhecida, aceita: se a profissional enviar uma
-- imagem e sair da tela sem clicar em Salvar, o objeto já foi substituído no Storage
-- mesmo que a URL não tenha sido persistida em company_profiles — baixo risco, só espaço
-- de Storage potencialmente desperdiçado, não um problema de segurança ou consistência.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-assets', 'company-assets', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

CREATE POLICY "company_assets_own_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "company_assets_own_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "company_assets_own_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
