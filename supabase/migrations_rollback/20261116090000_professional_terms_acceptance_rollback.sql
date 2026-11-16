-- Rollback de 20261116090000_professional_terms_acceptance.sql
-- Fora de supabase/migrations/ propositalmente (mesmo padrão dos rollbacks
-- anteriores) — SQL de referência para reverter manualmente via
-- query_database/SQL Editor, como conexão privilegiada (postgres/
-- service_role — nunca como authenticated, pelo mesmo motivo de sempre:
-- os REVOKEs abaixo e o DROP COLUMN exigem privilégio de dono da tabela).
--
-- IMPACTO: terms_accepted_version é apagada — perde-se a informação de
-- QUAL versão do texto cada profissional aceitou por último (só
-- terms_accepted_at, que não é tocado aqui, continua existindo). Por
-- segurança, faz backup de (id, terms_accepted_version, terms_accepted_at)
-- de TODA a tabela profiles antes de dropar a coluna, igual ao padrão já
-- usado em automations_soft_delete/client_consents — mesmo a coluna tendo
-- nascido sempre NULL nesta fase (sem backfill), se este rollback for
-- aplicado depois de a coluna já ter acumulado aceites reais, esse
-- histórico fica preservado em backup_rollback_fase1, não perdido.
--
-- Nenhuma outra tabela/coluna/policy pré-existente é tocada — a migration
-- original só ADICIONOU terms_accepted_version e ajustou GRANTs dela (e
-- de terms_accepted_at, que ela não cria — só restringe); o rollback
-- também restaura o GRANT de UPDATE de terms_accepted_at pra
-- authenticated/anon, do jeito que estava ANTES desta fase (mesmo que o
-- código do app, se ainda estiver na versão pós-CONSENT-1C, não volte a
-- escrever nela direto do navegador — restaurar o grant é sobre o estado
-- do banco, não sobre o código).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ---- Preservar o que existir antes de qualquer DROP COLUMN ----
CREATE SCHEMA IF NOT EXISTS backup_rollback_fase1;
REVOKE ALL ON SCHEMA backup_rollback_fase1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_fase1.profiles_terms_acceptance_20261116 AS
  SELECT id, terms_accepted_version, terms_accepted_at, now() AS backed_up_at
  FROM public.profiles;
ALTER TABLE backup_rollback_fase1.profiles_terms_acceptance_20261116 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_rollback_fase1.profiles_terms_acceptance_20261116 FROM PUBLIC, anon, authenticated;

-- ---- GRANTs: volta pro estado anterior (sem REVOKE de coluna nenhum) ----
GRANT UPDATE (terms_accepted_at) ON public.profiles TO authenticated, anon;

-- ---- Coluna ----
ALTER TABLE public.profiles DROP COLUMN IF EXISTS terms_accepted_version;

NOTIFY pgrst, 'reload schema';

COMMIT;
