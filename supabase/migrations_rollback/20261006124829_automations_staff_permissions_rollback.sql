-- Rollback de 20261006124829_automations_staff_permissions.sql
-- Fora de supabase/migrations/ propositalmente — NÃO é lido pelo runner de
-- migrations do Supabase; é SQL de referência pra reverter manualmente via
-- query_database/SQL Editor se a migration 2 precisar ser desfeita.
-- Devolve exatamente o estado deixado pela migration 1 (owner-only,
-- sem marketing_can/staff_can, sem os triggers 15/16 de journey_steps,
-- GRANTs de volta). Testado isoladamente (item 5.4): dono continua
-- operando sem a migration 1 ser revertida.
-- Rodada 3, item 3.1: a policy automations_owner_insert/journeys_owner_insert
-- restaurada aqui precisa bater com o que a migration 1 (ainda aplicada)
-- realmente tem hoje — que já inclui is_system=false/deleted_at IS NULL —
-- senão este rollback deixaria o app num estado que a migration 1 nunca
-- produziu por si só.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DROP POLICY IF EXISTS automations_staff_select ON public.automations;
CREATE POLICY automations_owner_select ON public.automations FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS automations_staff_insert ON public.automations;
CREATE POLICY automations_owner_insert ON public.automations FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND is_system = false AND deleted_at IS NULL);

DROP POLICY IF EXISTS automations_staff_update ON public.automations;
CREATE POLICY automations_owner_update ON public.automations FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS journeys_staff_select ON public.journeys;
CREATE POLICY journeys_owner_select ON public.journeys FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS journeys_staff_insert ON public.journeys;
CREATE POLICY journeys_owner_insert ON public.journeys FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL);

DROP POLICY IF EXISTS journeys_staff_update ON public.journeys;
CREATE POLICY journeys_owner_update ON public.journeys FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS journey_steps_staff_select ON public.journey_steps;
CREATE POLICY journey_steps_owner_select ON public.journey_steps FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS journey_steps_staff_insert ON public.journey_steps;
CREATE POLICY journey_steps_owner_insert ON public.journey_steps FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS journey_steps_staff_update ON public.journey_steps;
CREATE POLICY journey_steps_owner_update ON public.journey_steps FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS journey_steps_staff_delete ON public.journey_steps;
CREATE POLICY journey_steps_owner_delete ON public.journey_steps FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS marketing_sends_staff_select ON public.marketing_sends;
CREATE POLICY marketing_sends_owner_read ON public.marketing_sends FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_25_automations_require_delete_permission ON public.automations;
DROP FUNCTION IF EXISTS public.automations_require_delete_permission();

DROP TRIGGER IF EXISTS trg_15_journey_steps_owner_matches_parent ON public.journey_steps;
DROP FUNCTION IF EXISTS public.journey_steps_owner_matches_parent();

DROP TRIGGER IF EXISTS trg_16_journey_steps_block_if_parent_deleted ON public.journey_steps;
DROP FUNCTION IF EXISTS public.journey_steps_block_if_parent_deleted();

DROP FUNCTION IF EXISTS public.marketing_can(uuid, text);

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.automations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.journeys TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.journey_steps TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.marketing_sends TO anon;

GRANT DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.automations TO authenticated;
GRANT DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.journeys TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.journey_steps TO authenticated;
GRANT TRUNCATE, REFERENCES, TRIGGER ON public.marketing_sends TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
