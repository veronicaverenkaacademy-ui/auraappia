-- Corrige "new row violates row-level security policy" no upload de logo/capa.
--
-- Causa raiz, confirmada por simulação direta no banco (SET ROLE authenticated +
-- request.jwt.claims, dentro de transações revertidas, sem afetar dado real): a
-- migração anterior (20260808020000_company_assets_bucket.sql) só criou policies de
-- INSERT/UPDATE/DELETE, propositalmente sem SELECT — o raciocínio era que a leitura
-- pública já vem do bucket ser public=true, então uma policy de SELECT pareceria
-- redundante. Isso está certo para leitura pública (arquivo servido direto pela URL,
-- sem passar por RLS), mas é insuficiente: a própria API de Storage do Supabase faz um
-- INSERT ... RETURNING internamente para devolver os metadados do objeto recém-enviado
-- ao cliente — e RETURNING exige policy de SELECT válida sobre a linha, mesmo sendo a
-- dona inserindo a própria linha. Sem essa policy, o INSERT falhava com o mesmo erro
-- genérico de violação de RLS, mesmo com owner_id e bucket_id corretos.
--
-- Confirmado com simulação real: sem esta policy, INSERT ... RETURNING falha; com ela,
-- o mesmo INSERT (incluindo upsert via ON CONFLICT) funciona e a dona consegue ver o
-- próprio objeto.

CREATE POLICY "company_assets_own_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
