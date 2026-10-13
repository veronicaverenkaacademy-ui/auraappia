-- Rollback de 20261006124828_automations_soft_delete.sql
-- Fora de supabase/migrations/ propositalmente (ver nota no rollback da
-- migration 2). Só reverter esta depois de já ter revertido a migration 2
-- (ela depende das policies/colunas criadas aqui).
--
-- Rodada 3, item 5.2 — CORREÇÃO sobre a versão anterior: marketing_sends
-- tem FK ON DELETE CASCADE tanto para automations.id quanto para
-- journey_steps.id (confirmado via pg_constraint, item 2.4) — a versão
-- anterior deste rollback fazia backup de automations/journeys/
-- journey_steps soft-deleted antes de apagá-las fisicamente, mas NÃO
-- fazia backup de marketing_sends ligados a elas, que seriam apagados em
-- CASCATA sem cópia. Corrigido: agora marketing_sends_of_deleted também é
-- copiado (cobrindo as duas FKs) ANTES de qualquer DELETE físico.
--
-- Rodada 3, item 3.2 — esta migration também criou os triggers de
-- normalização (trg_05_*), removidos aqui junto com os demais.
--
-- Rodar como conexão privilegiada (service/postgres, nunca como
-- authenticated) — é assim que os triggers de proteção (que checam
-- auth.uid() IS NOT NULL) não interferem aqui.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ---- Preservar o que já foi excluído, antes de qualquer DROP COLUMN ----
CREATE SCHEMA IF NOT EXISTS backup_rollback_fase1;
REVOKE ALL ON SCHEMA backup_rollback_fase1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_fase1.automations_soft_deleted AS
  SELECT *, now() AS backed_up_at FROM public.automations WHERE deleted_at IS NOT NULL;
ALTER TABLE backup_rollback_fase1.automations_soft_deleted ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_rollback_fase1.automations_soft_deleted FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_fase1.journeys_soft_deleted AS
  SELECT *, now() AS backed_up_at FROM public.journeys WHERE deleted_at IS NOT NULL;
ALTER TABLE backup_rollback_fase1.journeys_soft_deleted ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_rollback_fase1.journeys_soft_deleted FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_fase1.journey_steps_of_deleted_journeys AS
  SELECT js.*, now() AS backed_up_at
  FROM public.journey_steps js
  JOIN public.journeys j ON j.id = js.journey_id
  WHERE j.deleted_at IS NOT NULL;
ALTER TABLE backup_rollback_fase1.journey_steps_of_deleted_journeys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_rollback_fase1.journey_steps_of_deleted_journeys FROM PUBLIC, anon, authenticated;

-- NOVO (item 5.2/2.4): marketing_sends ligados a automations OU
-- journey_steps que vão ser apagados fisicamente abaixo — sem isso, o
-- CASCADE das duas FKs apagaria esses envios sem cópia nenhuma.
CREATE TABLE IF NOT EXISTS backup_rollback_fase1.marketing_sends_of_deleted AS
  SELECT ms.*, now() AS backed_up_at
  FROM public.marketing_sends ms
  WHERE ms.automation_id IN (SELECT id FROM public.automations WHERE deleted_at IS NOT NULL)
     OR ms.journey_step_id IN (
          SELECT js.id FROM public.journey_steps js
          JOIN public.journeys j ON j.id = js.journey_id
          WHERE j.deleted_at IS NOT NULL
        );
ALTER TABLE backup_rollback_fase1.marketing_sends_of_deleted ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_rollback_fase1.marketing_sends_of_deleted FROM PUBLIC, anon, authenticated;

-- ---- Remover fisicamente o que estava soft-deleted (senão "ressuscita") ----
-- Ordem: journey_steps antes de journeys (senão a FK já teria cascateado
-- e a query de backup acima teria lido 0 linhas) — já estava certo, mantido.
DELETE FROM public.journey_steps js
  USING public.journeys j
  WHERE j.id = js.journey_id AND j.deleted_at IS NOT NULL;
DELETE FROM public.automations WHERE deleted_at IS NOT NULL;
DELETE FROM public.journeys WHERE deleted_at IS NOT NULL;

-- ---- Policies: volta pro FOR ALL original ----
DROP POLICY IF EXISTS automations_owner_select ON public.automations;
DROP POLICY IF EXISTS automations_owner_insert ON public.automations;
DROP POLICY IF EXISTS automations_owner_update ON public.automations;
CREATE POLICY automations_owner_all ON public.automations FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS journeys_owner_select ON public.journeys;
DROP POLICY IF EXISTS journeys_owner_insert ON public.journeys;
DROP POLICY IF EXISTS journeys_owner_update ON public.journeys;
CREATE POLICY journeys_owner_all ON public.journeys FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS journey_steps_owner_select ON public.journey_steps;
DROP POLICY IF EXISTS journey_steps_owner_insert ON public.journey_steps;
DROP POLICY IF EXISTS journey_steps_owner_update ON public.journey_steps;
DROP POLICY IF EXISTS journey_steps_owner_delete ON public.journey_steps;
CREATE POLICY journey_steps_owner_all ON public.journey_steps FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ---- Triggers/funções desta migration ----
DROP TRIGGER IF EXISTS trg_05_automations_normalize_delete ON public.automations;
DROP FUNCTION IF EXISTS public.automations_normalize_delete();
DROP TRIGGER IF EXISTS trg_05_journeys_normalize_delete ON public.journeys;
DROP FUNCTION IF EXISTS public.journeys_normalize_delete();
DROP TRIGGER IF EXISTS trg_10_automations_protect_immutable ON public.automations;
DROP FUNCTION IF EXISTS public.automations_protect_immutable();
DROP TRIGGER IF EXISTS trg_10_journeys_protect_immutable ON public.journeys;
DROP FUNCTION IF EXISTS public.journeys_protect_immutable();
DROP TRIGGER IF EXISTS trg_20_automations_protect_system ON public.automations;
DROP FUNCTION IF EXISTS public.automations_protect_system();
DROP TRIGGER IF EXISTS trg_21_automations_protect_system_delete ON public.automations;
DROP FUNCTION IF EXISTS public.automations_protect_system_delete();
DROP TRIGGER IF EXISTS trg_30_automations_block_edit_after_delete ON public.automations;
DROP FUNCTION IF EXISTS public.automations_block_edit_after_delete();
DROP TRIGGER IF EXISTS trg_30_journeys_block_edit_after_delete ON public.journeys;
DROP FUNCTION IF EXISTS public.journeys_block_edit_after_delete();
-- Rodada 7 (A5): remove a função central do endurecimento de
-- auth.uid() IS NULL — depois dos triggers que a chamam, nunca antes
-- (embora DROP não exija essa ordem no Postgres, mantém a leitura lógica
-- simétrica com a ordem de criação na migration).
-- Rodada 8 (A3): função e schema movidos pra aura_private. Por esse ponto
-- do rollback já rodamos o rollback da migration 2 primeiro (ver nota do
-- cabeçalho deste arquivo) — automations_require_delete_permission e
-- journey_steps_block_if_parent_deleted (os 2 dependentes de lá) já foram
-- dropados; os 8 dependentes desta migration acabaram de ser dropados
-- acima — nenhum objeto deveria sobrar em aura_private neste ponto.
DROP FUNCTION IF EXISTS aura_private.aura_system_bypass();
-- SEM CASCADE de propósito: se este DROP SCHEMA falhar por sobrar algum
-- objeto, é sinal de bug no rollback (um dependente não listado/dropado
-- antes) — melhor falhar alto aqui do que apagar silenciosamente algo
-- inesperado com CASCADE.
DROP SCHEMA IF EXISTS aura_private;

-- ---- Índices: volta pros originais (sem filtro) ----
DROP INDEX IF EXISTS public.automations_owner_active_idx;
CREATE INDEX IF NOT EXISTS automations_owner_idx ON public.automations (owner_id);
DROP INDEX IF EXISTS public.journeys_owner_active_idx;
CREATE INDEX IF NOT EXISTS journeys_owner_idx ON public.journeys (owner_id);

-- ---- Colunas ----
ALTER TABLE public.automations DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE public.automations DROP COLUMN IF EXISTS is_system;
ALTER TABLE public.journeys DROP COLUMN IF EXISTS deleted_at;

NOTIFY pgrst, 'reload schema';

COMMIT;
