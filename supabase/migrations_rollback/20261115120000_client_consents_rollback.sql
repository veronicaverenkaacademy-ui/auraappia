-- Rollback de 20261115120000_client_consents.sql (FASE CONSENT-1A).
--
-- client_consents é NOVA (nenhuma coluna/tabela existente foi alterada) —
-- reverter é só desfazer o que a migration criou. Mesmo assim, faz backup
-- do conteúdo antes do DROP TABLE (mesma cautela de
-- 20261006124828_automations_soft_delete_rollback.sql): se este rollback
-- for aplicado depois de a tabela já ter linhas reais (consentimentos já
-- registrados), elas não desaparecem sem deixar cópia.
--
-- Rodar como conexão privilegiada (service_role/postgres) — o gatilho de
-- imutabilidade não interfere aqui porque este rollback só faz DROP
-- (TABLE/FUNCTION/POLICY), nunca UPDATE/DELETE de linha.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

CREATE SCHEMA IF NOT EXISTS backup_rollback_fase1;
REVOKE ALL ON SCHEMA backup_rollback_fase1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_fase1.client_consents_backup AS
  SELECT *, now() AS backed_up_at FROM public.client_consents WHERE false;
INSERT INTO backup_rollback_fase1.client_consents_backup
  SELECT *, now() FROM public.client_consents;

REVOKE ALL ON FUNCTION public.purge_client_consent_pii(uuid) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.purge_client_consent_pii(uuid);

DROP TRIGGER IF EXISTS trg_10_client_consents_block_mutation ON public.client_consents;
DROP FUNCTION IF EXISTS public.client_consents_block_mutation();

-- As 2 policies de leitura (DROP explícito por completude — o DROP TABLE
-- abaixo já as removeria em cascata mesmo sem isto).
DROP POLICY IF EXISTS client_consents_owner_select ON public.client_consents;
DROP POLICY IF EXISTS client_consents_staff_select ON public.client_consents;

DROP TABLE IF EXISTS public.client_consents;

NOTIFY pgrst, 'reload schema';

COMMIT;
