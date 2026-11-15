-- Rollback de 20261115140000_client_erasure.sql (FASE LEGAL-1 REDUZIDA).
--
-- Remove as duas funções novas (client_erasure_plan, erase_client_data) e a
-- coluna nova clients.deleted_by_client_at. Diferente do rollback da
-- CONSENT-1A (que dropava uma TABELA inteira recém-criada), aqui o único
-- DROP destrutivo é de uma COLUNA em uma tabela existente (`clients`) — por
-- isso, mesma cautela de 20261006124828_automations_soft_delete_rollback.sql
-- e de 20261115120000_client_consents_rollback.sql: faz backup do valor da
-- coluna antes do DROP, para o caso de este rollback ser aplicado depois de
-- `erase_client_data` já ter marcado linhas reais (nunca perder, sem cópia,
-- a informação de quais linhas foram anonimizadas pela própria cliente).
--
-- Rodar como conexão privilegiada (service_role/postgres).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

CREATE SCHEMA IF NOT EXISTS backup_rollback_fase1;
REVOKE ALL ON SCHEMA backup_rollback_fase1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_fase1.clients_deleted_by_client_at_backup (
  client_id uuid,
  deleted_by_client_at timestamptz,
  backed_up_at timestamptz
);
INSERT INTO backup_rollback_fase1.clients_deleted_by_client_at_backup
  SELECT id, deleted_by_client_at, now()
  FROM public.clients
  WHERE deleted_by_client_at IS NOT NULL;

REVOKE ALL ON FUNCTION public.erase_client_data(uuid) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.erase_client_data(uuid);

REVOKE ALL ON FUNCTION public.client_erasure_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.client_erasure_plan(uuid);

ALTER TABLE public.clients DROP COLUMN IF EXISTS deleted_by_client_at;

NOTIFY pgrst, 'reload schema';

COMMIT;
