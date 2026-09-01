-- Etapa 5, parte 1: restringe Profissional à própria agenda/materiais/financeiro.
-- Recepcionista e Gerente continuam com acesso amplo, sem nenhuma mudança de
-- comportamento. Opção B (coluna "kind" em access_levels) — ver discussão registrada
-- no histórico do projeto sobre a Opção A (ações granulares) ter sido descartada em
-- favor de uma base mais robusta para crescimento futuro (múltiplos studios).
--
-- appointment_materials e finance_transactions usam EXISTS contra "appointments" para
-- descobrir o professional_id (não têm a coluna própria) — em AMBAS, a validação de
-- owner_id cruzado (a.owner_id = <tabela>.owner_id) é aplicada incondicionalmente,
-- fora do OR de "kind", valendo tanto para o caminho 'global' quanto 'own'. Auditoria
-- confirmou que nenhuma outra política em produção usa esse padrão de EXISTS hoje —
-- essas são as primeiras, por isso nascem já corrigidas.

BEGIN;

-- =====================================================================================
-- 1 — coluna "kind" em access_levels ('global' = acesso amplo, 'own' = só o próprio)
-- =====================================================================================
ALTER TABLE public.access_levels
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'global'
  CHECK (kind IN ('global', 'own'));

-- Backfill: só "Profissional" vira 'own'. Nomes confirmados em produção (Gerente,
-- Profissional, Recepcionista, uma única conta, nenhum nível customizado) — sem
-- necessidade de decisão manual adicional.
UPDATE public.access_levels SET kind = 'own' WHERE name ILIKE 'Profissional';

-- =====================================================================================
-- 2 — UNIQUE(owner_id, user_id) em team_members — confirmado sem duplicidade
-- =====================================================================================
DO $$
BEGIN
  ALTER TABLE public.team_members
    ADD CONSTRAINT team_members_owner_user_unique UNIQUE (owner_id, user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================================
-- 3 — funções auxiliares (CREATE OR REPLACE, idempotentes por natureza)
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.current_team_member_id(_owner_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tm.id
  FROM public.team_members tm
  WHERE tm.owner_id = _owner_id
    AND tm.user_id = auth.uid()
    AND tm.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.staff_access_kind(_owner_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT al.kind
  FROM public.team_members tm
  JOIN public.access_levels al ON al.id = tm.access_level_id
  WHERE tm.owner_id = _owner_id
    AND tm.user_id = auth.uid()
    AND tm.status = 'active'
  LIMIT 1;
$$;

-- =====================================================================================
-- 4 — appointments (resource "agenda")
-- =====================================================================================
DROP POLICY IF EXISTS appointments_staff_select ON public.appointments;
CREATE POLICY appointments_staff_select ON public.appointments FOR SELECT TO authenticated
  USING (
    staff_can(owner_id, 'agenda', 'view')
    AND (
      staff_access_kind(owner_id) <> 'own'
      OR professional_id = current_team_member_id(owner_id)
    )
  );

DROP POLICY IF EXISTS appointments_staff_insert ON public.appointments;
CREATE POLICY appointments_staff_insert ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (
    staff_can(owner_id, 'agenda', 'create')
    AND (
      staff_access_kind(owner_id) <> 'own'
      OR professional_id = current_team_member_id(owner_id)
    )
  );

DROP POLICY IF EXISTS appointments_staff_update ON public.appointments;
CREATE POLICY appointments_staff_update ON public.appointments FOR UPDATE TO authenticated
  USING (
    staff_can(owner_id, 'agenda', 'edit')
    AND (
      staff_access_kind(owner_id) <> 'own'
      OR professional_id = current_team_member_id(owner_id)
    )
  )
  WITH CHECK (
    staff_can(owner_id, 'agenda', 'edit')
    AND (
      staff_access_kind(owner_id) <> 'own'
      OR professional_id = current_team_member_id(owner_id)
    )
  );

-- =====================================================================================
-- 5 — agenda_blocks (mesmo resource "agenda", mesma coluna professional_id)
-- =====================================================================================
DROP POLICY IF EXISTS agenda_blocks_staff_select ON public.agenda_blocks;
CREATE POLICY agenda_blocks_staff_select ON public.agenda_blocks FOR SELECT TO authenticated
  USING (
    staff_can(owner_id, 'agenda', 'view')
    AND (
      staff_access_kind(owner_id) <> 'own'
      OR professional_id = current_team_member_id(owner_id)
    )
  );

DROP POLICY IF EXISTS agenda_blocks_staff_insert ON public.agenda_blocks;
CREATE POLICY agenda_blocks_staff_insert ON public.agenda_blocks FOR INSERT TO authenticated
  WITH CHECK (
    staff_can(owner_id, 'agenda', 'create')
    AND (
      staff_access_kind(owner_id) <> 'own'
      OR professional_id = current_team_member_id(owner_id)
    )
  );

DROP POLICY IF EXISTS agenda_blocks_staff_update ON public.agenda_blocks;
CREATE POLICY agenda_blocks_staff_update ON public.agenda_blocks FOR UPDATE TO authenticated
  USING (
    staff_can(owner_id, 'agenda', 'edit')
    AND (
      staff_access_kind(owner_id) <> 'own'
      OR professional_id = current_team_member_id(owner_id)
    )
  )
  WITH CHECK (
    staff_can(owner_id, 'agenda', 'edit')
    AND (
      staff_access_kind(owner_id) <> 'own'
      OR professional_id = current_team_member_id(owner_id)
    )
  );

-- =====================================================================================
-- 6 — appointment_materials: sem professional_id próprio, via EXISTS com appointments.
-- A validação "a.owner_id = appointment_materials.owner_id" é INCONDICIONAL, fora do
-- OR de kind — vale tanto para 'global' (Recepcionista/Gerente) quanto para 'own'
-- (Profissional). Sem isso, nada garantiria que o appointment_id referenciado
-- pertence à mesma conta da linha de appointment_materials.
-- =====================================================================================
DROP POLICY IF EXISTS appointment_materials_staff_select ON public.appointment_materials;
CREATE POLICY appointment_materials_staff_select ON public.appointment_materials FOR SELECT TO authenticated
  USING (
    staff_can(owner_id, 'agenda', 'view')
    AND EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_materials.appointment_id
        AND a.owner_id = appointment_materials.owner_id
        AND (
          staff_access_kind(owner_id) <> 'own'
          OR a.professional_id = current_team_member_id(owner_id)
        )
    )
  );

DROP POLICY IF EXISTS appointment_materials_staff_insert ON public.appointment_materials;
CREATE POLICY appointment_materials_staff_insert ON public.appointment_materials FOR INSERT TO authenticated
  WITH CHECK (
    staff_can(owner_id, 'agenda', 'edit')
    AND EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_materials.appointment_id
        AND a.owner_id = appointment_materials.owner_id
        AND (
          staff_access_kind(owner_id) <> 'own'
          OR a.professional_id = current_team_member_id(owner_id)
        )
    )
  );

DROP POLICY IF EXISTS appointment_materials_staff_update ON public.appointment_materials;
CREATE POLICY appointment_materials_staff_update ON public.appointment_materials FOR UPDATE TO authenticated
  USING (
    staff_can(owner_id, 'agenda', 'edit')
    AND EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_materials.appointment_id
        AND a.owner_id = appointment_materials.owner_id
        AND (
          staff_access_kind(owner_id) <> 'own'
          OR a.professional_id = current_team_member_id(owner_id)
        )
    )
  )
  WITH CHECK (
    staff_can(owner_id, 'agenda', 'edit')
    AND EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_materials.appointment_id
        AND a.owner_id = appointment_materials.owner_id
        AND (
          staff_access_kind(owner_id) <> 'own'
          OR a.professional_id = current_team_member_id(owner_id)
        )
    )
  );

-- =====================================================================================
-- 7 — finance_transactions: só SELECT. Mesma validação incondicional de owner_id
-- cruzado desde o início (nunca existiu versão sem ela para esta tabela).
-- =====================================================================================
DROP POLICY IF EXISTS finance_transactions_staff_select ON public.finance_transactions;
CREATE POLICY finance_transactions_staff_select ON public.finance_transactions FOR SELECT TO authenticated
  USING (
    staff_can(owner_id, 'finance', 'view')
    AND EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = finance_transactions.appointment_id
        AND a.owner_id = finance_transactions.owner_id
        AND (
          staff_access_kind(owner_id) <> 'own'
          OR a.professional_id = current_team_member_id(owner_id)
        )
    )
  );

COMMIT;
