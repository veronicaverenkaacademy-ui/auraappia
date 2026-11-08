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
-- Lembretes (Etapa D0e, achado crítico — CORRIGIDO na Etapa D-TER, 08/11):
-- se o job de lembrete de um agendamento já foi marcado 'cancelled'
-- (terminal) em notification_jobs enquanto ele estava cancelado, reativar
-- não fazia esse lembrete voltar — o scheduler
-- (central-reminder-scheduler.server.ts) só recalcula job 'pending', nunca
-- 'cancelled'/'sent'/'failed'/'processing'. Resolvido pela OPÇÃO A (das 3
-- avaliadas na Fase D-BIS, somente leitura): reactivate_cancelled_appointment
-- agora reabre, na MESMA transação, só os jobs 'cancelled' deste
-- agendamento que seguem TODAS as condições abaixo — nunca toca
-- scheduler/cron/trigger (travas da fase respeitadas):
--   1. appointment_id + owner_id do PRÓPRIO agendamento reativado (nunca de
--      outro agendamento/estabelecimento);
--   2. type IN ('appointment_reminder_24h', 'appointment_reminder_2h) —
--      nunca 'appointment_confirmation'/'appointment_created'/'test';
--   3. status='cancelled' E last_error IS NULL — critério objetivo (Etapa
--      D-TER 0b): o ÚNICO escritor que cancela um job de lembrete SEM
--      gravar last_error é o trigger enqueue_appointment_whatsapp_jobs()
--      (20260817200000...sql:49-55), disparado só pelo cancelamento do
--      PRÓPRIO agendamento. Todo outro cancelamento (telefone inválido,
--      atraso, agendamento não mais ativo, automação não aprovada, sem
--      agendamento/cliente — todos em central-reminder-scheduler.server.ts)
--      sempre grava um motivo em last_error. Limitação honesta, aceita
--      como segura: um job que passou por "hold_pending" (fica 'pending',
--      mas com last_error preenchido) e só depois foi cancelado pelo
--      mesmo trigger manteria esse last_error antigo e NÃO seria reaberto
--      — erra pro lado seguro (deixa de reabrir em vez de reabrir por
--      engano), nunca o contrário;
--   4. ainda dentro da janela de política (central-reminder-policy.ts:
--      51-58,195-222) checada com now() DO BANCO: 24h precisa de pelo
--      menos 12h (MAX_LATE_24H_BEFORE_START_MS) até starts_at; 2h precisa
--      de pelo menos 105min=1h45 (MAX_LATE_2H_BEFORE_START_MS). O envio
--      real reverifica essa mesma janela no momento de processar
--      (decideReminderJobAction, chamada em todo claim) — defesa em
--      profundidade, a checagem aqui só evita reabrir o que já nasceria
--      descartado de novo.
-- Nunca toca jobs 'sent'/'processing'/'failed', nunca insere nem apaga
-- linha (preserva o índice único appointment_id+type), só UPDATE. Qualquer
-- exceção inesperada nesse UPDATE propaga e desfaz a transação inteira
-- (nada parcial) — a profissional vê a mensagem genérica já tratada no
-- app, nunca um erro bruto.
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
  v_reminders_reopened int;
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

  -- Reabre os lembretes cancelados SÓ por causa do cancelamento deste
  -- agendamento (ver comentário no topo do arquivo) que ainda cabem na
  -- janela da política — nunca 'sent'/'processing'/'failed', nunca de
  -- outro agendamento/estabelecimento, nunca insere/apaga linha. Fora de
  -- um bloco BEGIN/EXCEPTION de propósito: uma exceção inesperada aqui
  -- deve desfazer a reativação inteira (nada parcial), nunca só pular o
  -- reabrimento — a função então propaga o erro, e o app já trata isso
  -- com a mensagem genérica.
  UPDATE public.notification_jobs
  SET status = 'pending', attempts = 0, next_attempt_at = now()
  WHERE appointment_id = p_appointment_id
    AND owner_id = v_appt.owner_id
    AND status = 'cancelled'
    AND last_error IS NULL
    AND (
      (type = 'appointment_reminder_24h' AND EXTRACT(EPOCH FROM (v_appt.starts_at - now())) >= 43200) -- 12h = MAX_LATE_24H_BEFORE_START_MS
      OR
      (type = 'appointment_reminder_2h' AND EXTRACT(EPOCH FROM (v_appt.starts_at - now())) >= 6300) -- 105min = MAX_LATE_2H_BEFORE_START_MS
    );
  GET DIAGNOSTICS v_reminders_reopened = ROW_COUNT;

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (
    v_appt.owner_id,
    auth.uid(),
    NULL,
    'reactivated',
    'appointments',
    p_appointment_id::text,
    jsonb_build_object('reminders_reopened', v_reminders_reopened)
  );

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_cancelled_appointment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_cancelled_appointment(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
