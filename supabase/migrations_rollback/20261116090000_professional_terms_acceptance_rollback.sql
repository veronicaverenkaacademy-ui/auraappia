-- Rollback de 20261116090000_professional_terms_acceptance.sql
-- Fora de supabase/migrations/ propositalmente (mesmo padrão dos rollbacks
-- anteriores) — SQL de referência para reverter manualmente via
-- query_database/SQL Editor, como conexão privilegiada (postgres/
-- service_role — nunca como authenticated: o DROP TRIGGER/FUNCTION/COLUMN
-- abaixo exige privilégio de dono da tabela/função).
--
-- REVISÃO CONSENT-1C-FIX: a migração original protegia as duas colunas
-- via REVOKE/GRANT de coluna; a versão corrigida usa um trigger
-- (public.profiles_protect_terms_acceptance / trg_10_...). Este rollback
-- foi reescrito para desfazer a versão corrigida — derruba o TRIGGER e a
-- FUNÇÃO, não mexe em nenhum GRANT/REVOKE (não existe mais nenhum pra
-- desfazer: a correção nunca tocou em GRANTs de profiles).
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
-- Nenhuma outra tabela/coluna/policy/grant pré-existente é tocada — a
-- migration original só ADICIONOU terms_accepted_version e o trigger de
-- proteção; o GRANT UPDATE de tabela padrão do Supabase em
-- authenticated/anon nunca foi alterado por ela, então não há nada a
-- restaurar nesse ponto.
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

-- ---- Trigger e função de proteção ----
DROP TRIGGER IF EXISTS trg_10_profiles_protect_terms_acceptance ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_protect_terms_acceptance();

-- ---- Coluna ----
ALTER TABLE public.profiles DROP COLUMN IF EXISTS terms_accepted_version;

NOTIFY pgrst, 'reload schema';

COMMIT;
