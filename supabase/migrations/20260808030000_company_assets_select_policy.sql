-- Arquivo RECONSTRUÍDO em 30/09/2026, a partir da definição real da policy em produção
-- (pg_policies) — o original nunca foi commitado no repositório, só aplicado
-- diretamente em produção; descoberto por auditoria comparando
-- supabase/migrations/ contra supabase_migrations.schema_migrations (que já tinha
-- esta versão registrada, created_by "claude-code-manual-apply (correção de bug —
-- INSERT...RETURNING exigia SELECT policy ausente na migração anterior, confirmado
-- por simulação real de RLS)").
--
-- Correção de bug: 20260808020000_company_assets_bucket.sql criou o bucket
-- "company-assets" com INSERT/UPDATE/DELETE policies em storage.objects, mas sem
-- SELECT — um upload com .select() logo em seguida (padrão do Supabase Storage
-- client) falhava porque o INSERT bem-sucedido não conseguia ler de volta a linha
-- criada. Esta policy fecha essa lacuna, mesmo padrão own-folder das outras três
-- (bucket_id + primeiro segmento do path = auth.uid()).
--
-- Não precisa ser reaplicado — já está ativo em produção desde a aplicação manual
-- original; este arquivo só recupera o histórico que faltava no repositório.

DROP POLICY IF EXISTS "company_assets_own_select" ON storage.objects;

CREATE POLICY "company_assets_own_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
