-- Fase 1 (exclusão de automação) — migration 1/2: schema.
-- Rodada 3: SQLSTATEs renomeados de AURxx (classe 'AU', reservada pelo
-- padrão SQL — primeiro caractere da classe deve ser 5-9 ou I-Z) para
-- URxxx (classe 'UR', primeiro caractere 'U' ∈ I-Z — ver item 3.4). O
-- prefixo estável da MENSAGEM continua "AURA_<NOME>:" em todos os casos —
-- é essa string, não o ERRCODE, que o backend usa como chave primária
-- (item 3.4/6.1: ERRCODE pode não sobreviver à serialização do server
-- function; o prefixo da mensagem sempre sobrevive, porque é texto).
-- Adiciona soft delete + proteção de automações de sistema + normalização
-- de deleted_at/active (item 3.2, novo nesta rodada), e separa as policies
-- FOR ALL (owner-only) em SELECT/INSERT/UPDATE explícitas, sem DELETE para
-- authenticated. staff_can() NÃO é tocado aqui — isso é a migration
-- seguinte (20261006124829_automations_staff_permissions.sql).
-- Dados existentes não mudam: as automações atuais continuam
-- is_system = false, deleted_at NULL (DEFAULT cobre isso sem backfill).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ===================== SEÇÃO A — colunas novas =====================
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

ALTER TABLE public.journeys
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- ===================== SEÇÃO B — índices parciais =====================
-- Toda leitura de listagem (marketing.functions.ts) passa a filtrar
-- deleted_at IS NULL; o índice parcial cobre exatamente esse padrão de
-- acesso e é mais barato de manter que o índice antigo (sem filtro).
DROP INDEX IF EXISTS public.automations_owner_idx;
CREATE INDEX IF NOT EXISTS automations_owner_active_idx
  ON public.automations (owner_id) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS public.journeys_owner_idx;
CREATE INDEX IF NOT EXISTS journeys_owner_active_idx
  ON public.journeys (owner_id) WHERE deleted_at IS NULL;

-- ===================== SEÇÃO B.1 — aura_system_bypass() (Rodada 7, A5; movida para aura_private na Rodada 8, A3) =====================
-- Fonte única da condição "este é um caminho de sistema, não um usuário
-- autenticado" — substitui o antigo "auth.uid() IS NULL" solto em 10
-- funções (normalize/protect_immutable/protect_system/protect_system_delete/
-- block_edit_after_delete ×2, require_delete_permission,
-- journey_steps_block_if_parent_deleted). Achado real (Rodada 7, A1): o
-- "auth.uid() IS NULL" sozinho é forjável por QUALQUER authenticated que
-- rode RESET ROLE / SET ROLE NONE / set_config('role','none',true) — os 3
-- fazem current_setting('role') virar 'none', que uma versão anterior
-- deste desenho (Rodada 6) aceitava como bypass. Corrigido: agora exige
-- também `current_setting('role')='service_role'` (cascata física/exclusão
-- de conta via API, sempre nesse role) OU `session_user='postgres'` E
-- `role='none'` (migration/dry-run via ferramenta administrativa, nunca
-- alcançável por uma conexão real do PostgREST, que nunca loga como
-- 'postgres' — confirmado via pg_auth_members/pg_roles, Rodada 7 A2/A3).
-- Residual aceito e documentado (não fechável por trigger): acesso SQL
-- direto com credencial real de 'postgres' — fora do alcance da API.
--
-- Rodada 8 (A3) — achado real: funções novas em `public` criadas por
-- `postgres`/`supabase_admin` recebem EXECUTE automático pra anon/
-- authenticated/service_role via ALTER DEFAULT PRIVILEGES do próprio
-- Supabase (confirmado ao vivo via pg_default_acl) — REVOKE de PUBLIC não
-- bastava, e o GRANT explícito que a Rodada 7 precisou adicionar pra
-- authenticated/anon (pros triggers SECURITY INVOKER) tinha o efeito
-- colateral de deixar `aura_system_bypass()` chamável direto como RPC
-- (`/rest/v1/rpc/aura_system_bypass`) por qualquer cliente com anon key —
-- mesmo que a lógica interna já fosse segura (sempre devolve false pra uma
-- sessão authenticated/anon real), é superfície desnecessária. Corrigido
-- movendo a função pro schema `aura_private`, que nunca entra na lista de
-- schemas expostos pelo PostgREST (schema algum é exposto por GRANT —
-- só os schemas explicitamente listados em "Exposed schemas" no painel
-- Supabase/na config do PostgREST; `aura_private` nunca é adicionado lá).
-- USAGE no schema + EXECUTE na função continuam liberados pra authenticated/
-- anon/service_role/postgres pelo MESMO motivo da Rodada 7 (triggers
-- SECURITY INVOKER precisam conseguir perguntar, mesmo sem poder influenciar
-- a resposta) — isso não é RPC-alcançável enquanto `aura_private` não
-- estiver na lista de schemas expostos (ver A3 passo NÃO VERIFICADO: só o
-- painel/REST real confirma isso, SQL puro não vê essa configuração).
CREATE SCHEMA IF NOT EXISTS aura_private;
REVOKE ALL ON SCHEMA aura_private FROM PUBLIC;
GRANT USAGE ON SCHEMA aura_private TO service_role, postgres, authenticated, anon;

CREATE OR REPLACE FUNCTION aura_private.aura_system_bypass()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT auth.uid() IS NULL AND (
    current_setting('role', true) = 'service_role'
    OR (session_user = 'postgres' AND current_setting('role', true) = 'none')
  );
$$;
REVOKE ALL ON FUNCTION aura_private.aura_system_bypass() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aura_private.aura_system_bypass() TO service_role, postgres, authenticated, anon;
-- Rodada 7 (correção da regressão A5), mantida na Rodada 8: EXECUTE para
-- authenticated/anon é necessário porque os 10 triggers que chamam esta
-- função são SECURITY INVOKER (não DEFINER) — ao disparar numa sessão
-- authenticated (dono/gerente reais via PostgREST), a própria função roda
-- "como" authenticated, e sem este GRANT a chamada falha com 42501 antes
-- mesmo de avaliar a condição. Isto NÃO reabre o furo provado em A1: quem
-- decide o resultado é a lógica interna (auth.uid() IS NULL AND role=
-- service_role, ou session_user=postgres AND role=none) — para uma
-- sessão authenticated/anon genuína essas condições são sempre falsas
-- (role GUC é 'authenticated'/'anon', nunca 'service_role'; session_user
-- é 'authenticator', nunca 'postgres') independente de poder CHAMAR a
-- função ou não. Ampliar o GRANT só permite PERGUNTAR; não muda a
-- RESPOSTA. Mover pra aura_private (Rodada 8) fecha a superfície de RPC
-- direto sem precisar restringir esse GRANT.

-- ===================== SEÇÃO C — normalização (item 3.2, nova) =====================
-- Roda ANTES de qualquer trigger de proteção (nome trg_05, alfabeticamente
-- antes de trg_10) — garante que, quando o próprio cliente manda
-- deleted_at/active no payload, o servidor nunca confia nesses valores:
-- no INSERT, deleted_at vira NULL sempre; na transição NULL -> não-NULL
-- (soft delete de verdade), o carimbo é sempre now() (nunca o que o
-- cliente mandou) e active vira false junto. Fora dessa transição (ex.:
-- UPDATE de nome, ou NEW.deleted_at já não-NULL de antes), não interfere.
-- aura_system_bypass() (service-role/cron/migration) nunca é normalizado —
-- mesma razão de sempre: não interferir na exclusão de conta nem em jobs
-- internos. (Rodada 7, A5: trocado de "auth.uid() IS NULL" solto.)
CREATE OR REPLACE FUNCTION public.automations_normalize_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF aura_private.aura_system_bypass() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.deleted_at := NULL;
    RETURN NEW;
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_at := now();
    NEW.active := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.automations_normalize_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_05_automations_normalize_delete ON public.automations;
CREATE TRIGGER trg_05_automations_normalize_delete
  BEFORE INSERT OR UPDATE ON public.automations
  FOR EACH ROW
  EXECUTE FUNCTION public.automations_normalize_delete();

CREATE OR REPLACE FUNCTION public.journeys_normalize_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF aura_private.aura_system_bypass() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.deleted_at := NULL;
    RETURN NEW;
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_at := now();
    NEW.active := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.journeys_normalize_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_05_journeys_normalize_delete ON public.journeys;
CREATE TRIGGER trg_05_journeys_normalize_delete
  BEFORE INSERT OR UPDATE ON public.journeys
  FOR EACH ROW
  EXECUTE FUNCTION public.journeys_normalize_delete();

-- ===================== SEÇÃO D — triggers de proteção =====================
-- auth.uid() IS NULL (service-role/cron/migration/exclusão de conta) NUNCA é
-- bloqueado por nenhum destes triggers — todos checam isso primeiro.

CREATE OR REPLACE FUNCTION public.automations_protect_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT aura_private.aura_system_bypass()
     AND (NEW.is_system IS DISTINCT FROM OLD.is_system
          OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UR001',
      MESSAGE = 'AURA_IMMUTABLE_FIELD: is_system e owner_id não podem ser alterados.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.automations_protect_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_10_automations_protect_immutable ON public.automations;
CREATE TRIGGER trg_10_automations_protect_immutable
  BEFORE UPDATE ON public.automations
  FOR EACH ROW
  WHEN (OLD.is_system IS DISTINCT FROM NEW.is_system OR OLD.owner_id IS DISTINCT FROM NEW.owner_id)
  EXECUTE FUNCTION public.automations_protect_immutable();

CREATE OR REPLACE FUNCTION public.journeys_protect_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT aura_private.aura_system_bypass() AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UR001',
      MESSAGE = 'AURA_IMMUTABLE_FIELD: owner_id não pode ser alterado.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.journeys_protect_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_10_journeys_protect_immutable ON public.journeys;
CREATE TRIGGER trg_10_journeys_protect_immutable
  BEFORE UPDATE ON public.journeys
  FOR EACH ROW
  WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id)
  EXECUTE FUNCTION public.journeys_protect_immutable();

CREATE OR REPLACE FUNCTION public.automations_protect_system()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT aura_private.aura_system_bypass() AND OLD.is_system
     AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UR002',
      MESSAGE = 'AURA_SYSTEM_AUTOMATION_PROTECTED: automação de sistema não pode ser excluída.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.automations_protect_system() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_20_automations_protect_system ON public.automations;
CREATE TRIGGER trg_20_automations_protect_system
  BEFORE UPDATE ON public.automations
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION public.automations_protect_system();

-- Defesa em profundidade: hoje inalcançável via `authenticated` (não haverá
-- policy de DELETE pra essa role nesta tabela), só protege se algum dia um
-- GRANT/policy de DELETE for reintroduzido por engano. service-role nunca é
-- bloqueado (é assim que a exclusão de conta continua funcionando).
CREATE OR REPLACE FUNCTION public.automations_protect_system_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT aura_private.aura_system_bypass() AND OLD.is_system THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UR002',
      MESSAGE = 'AURA_SYSTEM_AUTOMATION_PROTECTED: automação de sistema não pode ser excluída.';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.automations_protect_system_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_21_automations_protect_system_delete ON public.automations;
CREATE TRIGGER trg_21_automations_protect_system_delete
  BEFORE DELETE ON public.automations
  FOR EACH ROW
  WHEN (OLD.is_system)
  EXECUTE FUNCTION public.automations_protect_system_delete();

CREATE OR REPLACE FUNCTION public.automations_block_edit_after_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT aura_private.aura_system_bypass() AND OLD.deleted_at IS NOT NULL THEN
    IF NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'UR003',
        MESSAGE = 'AURA_RESTORE_NOT_ALLOWED: item excluído não pode ser restaurado.';
    ELSE
      RAISE EXCEPTION USING
        ERRCODE = 'UR004',
        MESSAGE = 'AURA_ALREADY_DELETED: item já excluído não pode ser editado.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.automations_block_edit_after_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_30_automations_block_edit_after_delete ON public.automations;
CREATE TRIGGER trg_30_automations_block_edit_after_delete
  BEFORE UPDATE ON public.automations
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.automations_block_edit_after_delete();

-- Mesma proteção em journeys (sem is_system — jornada não tem esse conceito).
CREATE OR REPLACE FUNCTION public.journeys_block_edit_after_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT aura_private.aura_system_bypass() AND OLD.deleted_at IS NOT NULL THEN
    IF NEW.deleted_at IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'UR003',
        MESSAGE = 'AURA_RESTORE_NOT_ALLOWED: item excluído não pode ser restaurado.';
    ELSE
      RAISE EXCEPTION USING
        ERRCODE = 'UR004',
        MESSAGE = 'AURA_ALREADY_DELETED: item já excluído não pode ser editado.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.journeys_block_edit_after_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_30_journeys_block_edit_after_delete ON public.journeys;
CREATE TRIGGER trg_30_journeys_block_edit_after_delete
  BEFORE UPDATE ON public.journeys
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.journeys_block_edit_after_delete();

-- ===================== SEÇÃO E — policies separadas (ainda owner-only) =====================
-- Item 3.1: INSERT exige is_system=false E deleted_at IS NULL — sem isso,
-- qualquer authenticated poderia criar uma automação "de sistema"
-- (impossível de excluir) ou já "excluída" direto no INSERT. Só
-- service_role (sem policy, bypassa RLS) cria is_system=true.
-- Rodada 7 (achado real de idempotência, A5): cada policy "owner_*" ganhou
-- seu próprio DROP POLICY IF EXISTS antes de ser criada — sem isso, reaplicar
-- só esta migration uma segunda vez (ex.: retry depois de falha parcial, sem
-- a migration 2 ainda ter rodado) colidiria com a própria policy que a
-- primeira aplicação já criou (42710 "policy already exists"). Mesmo achado
-- e mesma correção da migration 2 (ver seu cabeçalho da Seção B).
DROP POLICY IF EXISTS automations_owner_all ON public.automations;
DROP POLICY IF EXISTS automations_owner_select ON public.automations;
CREATE POLICY automations_owner_select ON public.automations FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS automations_owner_insert ON public.automations;
CREATE POLICY automations_owner_insert ON public.automations FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND is_system = false AND deleted_at IS NULL);
DROP POLICY IF EXISTS automations_owner_update ON public.automations;
CREATE POLICY automations_owner_update ON public.automations FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
-- Sem policy de DELETE para authenticated (proposital).

DROP POLICY IF EXISTS journeys_owner_all ON public.journeys;
DROP POLICY IF EXISTS journeys_owner_select ON public.journeys;
CREATE POLICY journeys_owner_select ON public.journeys FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS journeys_owner_insert ON public.journeys;
CREATE POLICY journeys_owner_insert ON public.journeys FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND deleted_at IS NULL);
DROP POLICY IF EXISTS journeys_owner_update ON public.journeys;
CREATE POLICY journeys_owner_update ON public.journeys FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
-- Sem policy de DELETE para authenticated (proposital).

-- journey_steps MANTÉM DELETE (deleteJourneyStep físico, fora de escopo desta
-- fase, continua precisando dela) — por isso as 4 policies, não só 3.
DROP POLICY IF EXISTS journey_steps_owner_all ON public.journey_steps;
DROP POLICY IF EXISTS journey_steps_owner_select ON public.journey_steps;
CREATE POLICY journey_steps_owner_select ON public.journey_steps FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS journey_steps_owner_insert ON public.journey_steps;
CREATE POLICY journey_steps_owner_insert ON public.journey_steps FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS journey_steps_owner_update ON public.journey_steps;
CREATE POLICY journey_steps_owner_update ON public.journey_steps FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS journey_steps_owner_delete ON public.journey_steps;
CREATE POLICY journey_steps_owner_delete ON public.journey_steps FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';

COMMIT;
