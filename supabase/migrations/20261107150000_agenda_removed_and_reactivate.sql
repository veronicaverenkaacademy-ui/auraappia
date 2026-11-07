-- FASE D (ações em agendamento cancelado): "Remover da agenda" (soft,
-- reversível com "Desfazer") e "Reativar agendamento". ESTE ARQUIVO AINDA
-- NÃO FOI APLICADO EM PRODUÇÃO — só roda quando a dona enviar a mensagem
-- "AUTORIZO APLICAR MIGRATION DA FASE D:". Criado e revisado nesta branch
-- (claude/agenda-cancelados-acoes) como parte da Etapa D1.
--
-- Aditiva e retrocompatível: 2 colunas novas em appointments, sem FK, sem
-- DEFAULT, sem NOT NULL (nenhum dado antigo é preenchido) e 2 funções novas
-- (CREATE OR REPLACE — nada existente é substituído, pois os nomes são
-- novos). Nenhuma coluna/constraint/índice/política/função existente é
-- alterada, nem removida. Idempotente: ADD COLUMN IF NOT EXISTS + CREATE OR
-- REPLACE FUNCTION — seguro rodar de novo se a plataforma tentar reaplicar
-- o arquivo após o merge (confirmado nas Etapas D1.4/D1.5).
--
-- Permissão: reaproveita EXATAMENTE a mesma regra de "editar agendamento"
-- já usada pelo RLS (appointments_own_all + appointments_staff_update, ver
-- staff_can()/staff_access_kind()/current_team_member_id() em
-- 20260825140000_staff_access.sql e 20260901120000_agenda_own_scope.sql) —
-- nenhuma permissão nova é inventada (Etapa D0a). As duas funções abaixo
-- são SECURITY DEFINER, então NÃO herdam RLS automaticamente — por isso
-- cada uma repete a mesma checagem manualmente, travando a linha com
-- SELECT ... FOR UPDATE antes de decidir (mesmo padrão de
-- apply_whatsapp_central_reply).
--
-- Reativar (Etapa D0c): limpa client_confirmation_status ('pending') e
-- client_confirmed_at (NULL) — as únicas duas colunas de
-- cancelamento/confirmação que já existiam antes desta migration — além de
-- agenda_removed_at/by. Nunca apaga a linha, nunca altera price/notes/
-- client_id/service_id/professional_id/starts_at/ends_at.
--
-- Lembretes (Etapa D0e, achado crítico, NÃO corrigido aqui): se o job de
-- lembrete de um agendamento já foi marcado 'cancelled' (terminal) em
-- notification_jobs enquanto ele estava cancelado, reativar NÃO faz esse
-- lembrete voltar — o scheduler (central-reminder-scheduler.server.ts) só
-- recalcula job 'pending', nunca 'cancelled'/'sent'/'failed'/'processing'.
-- Falha silenciosa conhecida, relatada à dona, fora do escopo desta fase
-- (não altera o scheduler).
--
-- GRANT só para authenticated: nenhum job/scheduler/webhook do servidor
-- chama estas funções (diferente de apply_whatsapp_central_reply, chamada
-- pelo webhook via service_role) — só a profissional logada, pelo app.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- =====================================================================================
-- 1 — colunas novas em appointments
-- =====================================================================================
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS agenda_removed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS agenda_removed_by uuid NULL;

COMMENT ON COLUMN public.appointments.agenda_removed_at IS
  'Preenchida quando a profissional usa "Remover da agenda" num agendamento cancelado (FASE D, 11/2026). O agendamento some só das 4 visões da Agenda (Dia/Semana/Lista/Timeline) — nunca do banco, nunca do histórico da cliente, financeiro ou relatórios. NULL = aparece normalmente. Só tem efeito combinada com status=''cancelled''; reactivate_cancelled_appointment() limpa esta coluna.';
COMMENT ON COLUMN public.appointments.agenda_removed_by IS
  'auth.uid() de quem removeu da agenda (FASE D, 11/2026). Sem FK de propósito — evita cascade/bloqueio se a conta do team_member for removida depois; não é garantido continuar apontando pra alguém ativo.';

-- =====================================================================================
-- 2 — set_agenda_removed: liga/desliga agenda_removed_at (idempotente nos dois sentidos)
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.set_agenda_removed(p_appointment_id uuid, p_removed boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appt public.appointments;
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;

  v_allowed := (v_appt.owner_id = auth.uid())
    OR (
      public.staff_can(v_appt.owner_id, 'agenda', 'edit')
      AND (
        public.staff_access_kind(v_appt.owner_id) <> 'own'
        OR v_appt.professional_id = public.current_team_member_id(v_appt.owner_id)
      )
    );
  IF NOT v_allowed THEN
    RETURN 'sem_permissao';
  END IF;

  IF v_appt.status <> 'cancelled' THEN
    RETURN 'nao_cancelado';
  END IF;

  UPDATE public.appointments
  SET
    agenda_removed_at = CASE WHEN p_removed THEN now() ELSE NULL END,
    agenda_removed_by = CASE WHEN p_removed THEN auth.uid() ELSE NULL END
  WHERE id = p_appointment_id;

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (
    v_appt.owner_id,
    auth.uid(),
    NULL,
    CASE WHEN p_removed THEN 'agenda_removed' ELSE 'agenda_restored' END,
    'appointments',
    p_appointment_id::text,
    NULL
  );

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.set_agenda_removed(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agenda_removed(uuid, boolean) TO authenticated;

-- =====================================================================================
-- 3 — reactivate_cancelled_appointment: cancelado -> pending (nunca reenvia nada)
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.reactivate_cancelled_appointment(p_appointment_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_appt public.appointments;
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;

  v_allowed := (v_appt.owner_id = auth.uid())
    OR (
      public.staff_can(v_appt.owner_id, 'agenda', 'edit')
      AND (
        public.staff_access_kind(v_appt.owner_id) <> 'own'
        OR v_appt.professional_id = public.current_team_member_id(v_appt.owner_id)
      )
    );
  IF NOT v_allowed THEN
    RETURN 'sem_permissao';
  END IF;

  IF v_appt.status <> 'cancelled' THEN
    RETURN 'nao_cancelado';
  END IF;

  -- "Passado" decidido pelo relógio DO BANCO, nunca pelo cliente.
  IF v_appt.starts_at <= now() THEN
    RETURN 'horario_passado';
  END IF;

  BEGIN
    UPDATE public.appointments
    SET
      status = 'pending',
      client_confirmation_status = 'pending',
      client_confirmed_at = NULL,
      agenda_removed_at = NULL,
      agenda_removed_by = NULL
    WHERE id = p_appointment_id;
  EXCEPTION WHEN exclusion_violation THEN
    -- appointments_no_overlap: alguém ocupou esse horário nesse meio-tempo.
    -- Bloco interno = savepoint implícito do plpgsql — a transação externa
    -- (a chamada RPC em si) continua íntegra, sem efeito parcial.
    RETURN 'horario_ocupado';
  END;

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (v_appt.owner_id, auth.uid(), NULL, 'reactivated', 'appointments', p_appointment_id::text, NULL);

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_cancelled_appointment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_cancelled_appointment(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
