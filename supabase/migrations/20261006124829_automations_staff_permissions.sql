-- Fase 1 (exclusão de automação) — migration 2/2: permissões.
-- Rodada 3: SQLSTATEs renomeados pro mesmo motivo da migration 1 (ver seu
-- cabeçalho) — UR005/UR006/UR007 (eram AUR05/06/07) e o novo UR008
-- (trigger 16, item 3.3: bloqueia INSERT/UPDATE/DELETE em journey_steps
-- cuja jornada pai (origem OU destino) está soft-deleted).
-- Define marketing_can() como fonte única da regra "Dono OU staff_can" e
-- liga TODAS as policies/triggers do Sistema A nela — nenhuma policy chama
-- staff_can() direto (grep de prova no final deste arquivo, como comentário).
-- Depende de 20261006124828_automations_soft_delete.sql já aplicada.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ===================== SEÇÃO A — marketing_can() =====================
-- staff_can() só resolve colaboradoras (team_members) — pra ela, o Dono
-- checando a própria automação daria false (não existe linha de
-- team_members onde o Dono é membro de si mesmo). marketing_can() é a
-- fonte única: Dono sempre passa, senão delega pra staff_can(). SECURITY
-- INVOKER porque não precisa de privilégio elevado — só delega pra
-- staff_can(), que já é SECURITY DEFINER internamente.
CREATE OR REPLACE FUNCTION public.marketing_can(_owner_id uuid, _action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT ((SELECT auth.uid()) = _owner_id) OR public.staff_can(_owner_id, 'marketing', _action);
$$;

REVOKE ALL ON FUNCTION public.marketing_can(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_can(uuid, text) TO authenticated, service_role;

-- ===================== SEÇÃO B — policies via marketing_can() =====================
-- Item 3.1: INSERT exige is_system=false E deleted_at IS NULL (mesma regra
-- da migration 1, repetida aqui porque esta policy SUBSTITUI a anterior).
-- Rodada 7 (achado real de idempotência, A5): cada policy "staff_*" agora
-- também tem seu próprio DROP POLICY IF EXISTS antes de ser criada — sem
-- isso, reaplicar as migrations 1+2 em sequência uma segunda vez (migration
-- 1 recria as policies "owner_*"; migration 2 tentaria recriar "staff_*"
-- que já existem da 1a aplicação) falha com 42710 "policy already exists".
-- Confirmado rodando de verdade (ERRCODE 42710), não por suposição.
DROP POLICY IF EXISTS automations_owner_select ON public.automations;
DROP POLICY IF EXISTS automations_staff_select ON public.automations;
CREATE POLICY automations_staff_select ON public.automations FOR SELECT TO authenticated
  USING (marketing_can(owner_id, 'view'));

DROP POLICY IF EXISTS automations_owner_insert ON public.automations;
DROP POLICY IF EXISTS automations_staff_insert ON public.automations;
CREATE POLICY automations_staff_insert ON public.automations FOR INSERT TO authenticated
  WITH CHECK (marketing_can(owner_id, 'create') AND is_system = false AND deleted_at IS NULL);

DROP POLICY IF EXISTS automations_owner_update ON public.automations;
DROP POLICY IF EXISTS automations_staff_update ON public.automations;
CREATE POLICY automations_staff_update ON public.automations FOR UPDATE TO authenticated
  USING (marketing_can(owner_id, 'edit'))
  WITH CHECK (marketing_can(owner_id, 'edit'));

DROP POLICY IF EXISTS journeys_owner_select ON public.journeys;
DROP POLICY IF EXISTS journeys_staff_select ON public.journeys;
CREATE POLICY journeys_staff_select ON public.journeys FOR SELECT TO authenticated
  USING (marketing_can(owner_id, 'view'));

DROP POLICY IF EXISTS journeys_owner_insert ON public.journeys;
DROP POLICY IF EXISTS journeys_staff_insert ON public.journeys;
CREATE POLICY journeys_staff_insert ON public.journeys FOR INSERT TO authenticated
  WITH CHECK (marketing_can(owner_id, 'create') AND deleted_at IS NULL);

DROP POLICY IF EXISTS journeys_owner_update ON public.journeys;
DROP POLICY IF EXISTS journeys_staff_update ON public.journeys;
CREATE POLICY journeys_staff_update ON public.journeys FOR UPDATE TO authenticated
  USING (marketing_can(owner_id, 'edit'))
  WITH CHECK (marketing_can(owner_id, 'edit'));

-- journey_steps: sem conceito de 'delete' próprio — tudo sob 'edit',
-- inclusive a policy de DELETE física (deleteJourneyStep).
DROP POLICY IF EXISTS journey_steps_owner_select ON public.journey_steps;
DROP POLICY IF EXISTS journey_steps_staff_select ON public.journey_steps;
CREATE POLICY journey_steps_staff_select ON public.journey_steps FOR SELECT TO authenticated
  USING (marketing_can(owner_id, 'view'));

DROP POLICY IF EXISTS journey_steps_owner_insert ON public.journey_steps;
DROP POLICY IF EXISTS journey_steps_staff_insert ON public.journey_steps;
CREATE POLICY journey_steps_staff_insert ON public.journey_steps FOR INSERT TO authenticated
  WITH CHECK (marketing_can(owner_id, 'edit'));

DROP POLICY IF EXISTS journey_steps_owner_update ON public.journey_steps;
DROP POLICY IF EXISTS journey_steps_staff_update ON public.journey_steps;
CREATE POLICY journey_steps_staff_update ON public.journey_steps FOR UPDATE TO authenticated
  USING (marketing_can(owner_id, 'edit'))
  WITH CHECK (marketing_can(owner_id, 'edit'));

DROP POLICY IF EXISTS journey_steps_owner_delete ON public.journey_steps;
DROP POLICY IF EXISTS journey_steps_staff_delete ON public.journey_steps;
CREATE POLICY journey_steps_staff_delete ON public.journey_steps FOR DELETE TO authenticated
  USING (marketing_can(owner_id, 'edit'));

-- marketing_sends: só SELECT (nunca INSERT/UPDATE/DELETE para authenticated).
DROP POLICY IF EXISTS marketing_sends_owner_read ON public.marketing_sends;
DROP POLICY IF EXISTS marketing_sends_staff_select ON public.marketing_sends;
CREATE POLICY marketing_sends_staff_select ON public.marketing_sends FOR SELECT TO authenticated
  USING (marketing_can(owner_id, 'view'));

-- ===================== SEÇÃO C — exigir 'delete' explicitamente no soft delete =====================
-- A policy de UPDATE geral usa 'edit'; soft delete (deleted_at NULL -> not
-- null) precisa do nível 'delete' especificamente. NOT aura_system_bypass()
-- de propósito antes de checar permissão — nunca bloqueia service-role
-- (cron/exclusão de conta). (Rodada 7, A5: trocado de "auth.uid() IS NOT NULL".)
CREATE OR REPLACE FUNCTION public.automations_require_delete_permission()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.deleted_at IS NULL
     AND NEW.deleted_at IS NOT NULL
     AND NOT aura_private.aura_system_bypass()
     AND NOT marketing_can(OLD.owner_id, 'delete') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UR005',
      MESSAGE = 'AURA_PERMISSION_DENIED_DELETE: sem permissão para excluir esta automação.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.automations_require_delete_permission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_25_automations_require_delete_permission ON public.automations;
CREATE TRIGGER trg_25_automations_require_delete_permission
  BEFORE UPDATE ON public.automations
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION public.automations_require_delete_permission();

-- ===================== SEÇÃO D — journey_steps.owner_id == journeys.owner_id do pai =====================
-- SECURITY DEFINER pra sempre ler o owner_id real da jornada pai,
-- independente de RLS — é só uma leitura de comparação, nunca um bypass de
-- escrita. Mensagens sem dado de negócio (só o fato "não bate"), sem nome,
-- telefone ou conteúdo.
-- Nota de verificação (item 3.3): testado ao vivo com fixture sintética que
-- a RLS de journeys_staff_select (marketing_can(owner_id,'view'), sem
-- filtro de deleted_at) já deixaria o Gerente VER o pai mesmo soft-deleted
-- mesmo sob SECURITY INVOKER — mas mantemos SECURITY DEFINER por defesa em
-- profundidade: se um dia a policy de SELECT de journeys ganhar um filtro
-- "deleted_at IS NULL" (para não listar jornadas excluídas), um trigger
-- INVOKER pararia de ver o pai e geraria falso UR006 (parent não
-- encontrado). DEFINER desacopla a leitura de comparação da policy atual.
CREATE OR REPLACE FUNCTION public.journey_steps_owner_matches_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parent_owner uuid;
BEGIN
  SELECT owner_id INTO parent_owner FROM public.journeys WHERE id = NEW.journey_id;
  IF parent_owner IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UR006',
      MESSAGE = 'AURA_INVALID_PARENT: jornada pai não encontrada.';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM parent_owner THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UR007',
      MESSAGE = 'AURA_OWNER_MISMATCH: owner_id da etapa deve ser igual ao da jornada pai.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.journey_steps_owner_matches_parent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_15_journey_steps_owner_matches_parent ON public.journey_steps;
CREATE TRIGGER trg_15_journey_steps_owner_matches_parent
  BEFORE INSERT OR UPDATE OF owner_id, journey_id ON public.journey_steps
  FOR EACH ROW EXECUTE FUNCTION public.journey_steps_owner_matches_parent();

-- ===================== SEÇÃO E — bloqueia escrita se a jornada pai está excluída (item 3.3, nova) =====================
-- Mesmo raciocínio de "item já excluído não pode ser editado" aplicado
-- transitivamente: uma vez que a jornada está soft-deleted, NENHUMA etapa
-- dela pode ser inserida, editada ou apagada por um usuário autenticado —
-- só service_role (cron/limpeza/exclusão de conta). Checa o pai de NEW
-- (INSERT/UPDATE) e o pai de OLD (UPDATE/DELETE), cobrindo também o caso de
-- mover uma etapa PARA uma jornada excluída ou tentar editar/apagar uma
-- etapa cuja jornada já estava excluída antes da tentativa — exatamente o
-- caso 33 da rodada anterior, que tinha ficado sem proteção (achado
-- honesto, não escondido). SECURITY DEFINER pelo mesmo motivo do trigger
-- 15: leitura de comparação, nunca bypass de escrita.
CREATE OR REPLACE FUNCTION public.journey_steps_block_if_parent_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_parent_deleted boolean;
  old_parent_deleted boolean;
BEGIN
  IF aura_private.aura_system_bypass() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT deleted_at IS NOT NULL INTO new_parent_deleted
      FROM public.journeys WHERE id = NEW.journey_id;
    IF new_parent_deleted THEN
      RAISE EXCEPTION USING
        ERRCODE = 'UR008',
        MESSAGE = 'AURA_PARENT_JOURNEY_DELETED: não é possível alterar etapas de uma jornada excluída.';
    END IF;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT deleted_at IS NOT NULL INTO old_parent_deleted
      FROM public.journeys WHERE id = OLD.journey_id;
    IF old_parent_deleted THEN
      RAISE EXCEPTION USING
        ERRCODE = 'UR008',
        MESSAGE = 'AURA_PARENT_JOURNEY_DELETED: não é possível alterar etapas de uma jornada excluída.';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.journey_steps_block_if_parent_deleted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_16_journey_steps_block_if_parent_deleted ON public.journey_steps;
CREATE TRIGGER trg_16_journey_steps_block_if_parent_deleted
  BEFORE INSERT OR UPDATE OR DELETE ON public.journey_steps
  FOR EACH ROW EXECUTE FUNCTION public.journey_steps_block_if_parent_deleted();

-- ===================== SEÇÃO F — hardening de GRANTs =====================
-- anon: confirmado por grep (booking.functions.ts, o portal público) que
-- nada no portal lê essas 4 tabelas, e por pg_policies que não existe
-- nenhuma policy "TO anon" nelas hoje — revogar SELECT/INSERT/UPDATE de
-- anon aqui não muda nenhum comportamento real, só fecha a superfície.
-- TRUNCATE ignora RLS inteiramente — por isso sai pra authenticated/anon
-- nas 4. DELETE/REFERENCES/TRIGGER saem só de automations/journeys
-- (journey_steps mantém DELETE pelo motivo já explicado). service_role e
-- postgres nunca são afetados (REVOKE aqui é escopado a authenticated/anon).
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.automations FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.journeys FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.journey_steps FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.marketing_sends FROM anon;

REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.automations FROM authenticated;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.journeys FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.journey_steps FROM authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.marketing_sends FROM authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ===================== PROVA (comentário, não SQL executável) =====================
-- grep -n "staff_can(" supabase/migrations/20261006124829_automations_staff_permissions.sql
-- só deve bater DENTRO da definição de marketing_can() (SEÇÃO A) — em
-- nenhuma policy ou trigger fora dela.
