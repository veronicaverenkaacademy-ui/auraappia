-- Rollback de 20261117140000_owner_erasure.sql (FASE LEGAL-2).
--
-- Remove as duas funções novas (owner_erasure_plan, erase_owner_data) — nem
-- tabela nem coluna nova nesta migração, então não há DROP destrutivo de
-- dados aqui (diferente do rollback de 20261115140000_client_erasure, que
-- precisou de backup por tocar uma coluna existente). Nenhum dado é
-- apagado por este rollback em si.
--
-- IMPACTO de aplicar: account-deletion.functions.ts (se já estiver
-- chamando src/lib/owner-erasure.server.ts, que por sua vez chama
-- owner_erasure_plan/erase_owner_data) passa a falhar com "function does
-- not exist" em qualquer tentativa de excluir conta da dona — modo seguro
-- (nenhuma exclusão parcial), igual ao comportamento já documentado em
-- client-erasure.server.ts pra client_erasure_plan ausente.
--
-- erase_client_data, client_erasure_plan e purge_client_consent_pii NÃO são
-- tocadas por este rollback nem pela migração que ele desfaz.
--
-- Rodar como conexão privilegiada (service_role/postgres).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

REVOKE ALL ON FUNCTION public.erase_owner_data(uuid) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.erase_owner_data(uuid);

REVOKE ALL ON FUNCTION public.owner_erasure_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.owner_erasure_plan(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
