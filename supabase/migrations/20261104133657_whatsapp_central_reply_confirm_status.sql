-- Corrige apply_whatsapp_central_reply: CONFIRMAR num agendamento pending (ou
-- reschedule_requested) nunca mudava appointments.status pra 'confirmed' —
-- só client_confirmation_status. A Agenda pinta de verde pelo `status`
-- (src/routes/_authenticated/agenda.tsx:92), então a cliente tocar
-- "Confirmar" nunca refletia lá (diagnóstico 04/11/2026).
--
-- Mesma assinatura, mesmos nomes de parâmetro, mesmo RETURNS text (nenhum
-- valor de retorno novo — todos os 13 literais já existentes continuam
-- exaustivos no TypeScript, ApplyReplyOutcome não muda). Mesmas permissões
-- (REVOKE/GRANT idênticos ao estado atual, incluindo sandbox_exec — ver
-- diário da sessão para o ACL capturado antes desta migration).
--
-- ESPELHA EXATAMENTE src/lib/whatsapp/central-reply-decision.ts
-- (decideThreadReply) — qualquer mudança de regra precisa ser feita NOS
-- DOIS lugares (a função TS é a especificação testada; esta função SQL é
-- quem de fato aplica, porque supabase-js não tem transação/lock de linha
-- pelo cliente).
--
-- Mudanças nesta versão (04/11/2026), todas espelhadas no TS:
--   1. CONFIRMAR agora também grava status='confirmed' (o defeito em si).
--   2. 'no_show' passa a ser excluído de "salvageable", igual 'completed'
--      (antes só 'completed' — um no_show com starts_at ainda no futuro,
--      edição manual incomum, podia ser confirmado/cancelado como se nada
--      tivesse acontecido).
--   3. A checagem de lembrete desatualizado (appointment_starts_at_snapshot
--      da thread vs starts_at atual do agendamento) agora vale pra QUALQUER
--      ação, em qualquer client_confirmation_status — antes só valia no
--      ramo 'pending'. Promovida pra logo depois do SELECT...FOR UPDATE,
--      antes de qualquer decisão por estado.
--   4. Toda mudança real em `appointments` (apply_confirm/apply_cancel/
--      apply_cancel_late/apply_reschedule_request) grava uma linha em
--      audit_log (tabela já existente, actor_id/actor_name nullable —
--      nenhuma coluna nova) com actor_name='Cliente via WhatsApp',
--      actor_id=NULL (não há usuário autenticado nesta chamada).
--      apply_reschedule_request_repeat não grava (nada muda no agendamento
--      nesse caso, igual antes).
--
-- Trava só a linha de `appointments` (FOR UPDATE) — nunca a thread — mesma
-- ordem de antes; um único recurso travado nunca compete em ordem oposta
-- com nenhum outro caminho de escrita (Agenda só edita/cancela o mesmo
-- agendamento, nunca thread).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

CREATE OR REPLACE FUNCTION public.apply_whatsapp_central_reply(
  p_thread_id uuid,
  p_action text,
  p_resolved_by_message_id uuid,
  p_late_cancel_hours numeric DEFAULT 4
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread public.whatsapp_central_threads;
  v_appt public.appointments;
  v_now timestamptz := now();
  v_decision text;
  v_still_salvageable boolean;
  v_late_cancel boolean;
BEGIN
  IF p_action NOT IN ('confirm', 'cancel', 'reschedule') THEN
    RETURN 'invalid_action';
  END IF;

  SELECT * INTO v_thread FROM public.whatsapp_central_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN
    RETURN 'thread_not_found';
  END IF;

  -- Trava a linha do AGENDAMENTO (pedido explícito) — qualquer outra
  -- resposta concorrente para o MESMO agendamento espera aqui.
  SELECT * INTO v_appt FROM public.appointments WHERE id = v_thread.appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'appointment_not_found';
  END IF;

  -- 'no_show' agora exclui "salvageable" igual 'completed' (defeito 2).
  v_still_salvageable := v_appt.status NOT IN ('completed', 'no_show') AND v_appt.starts_at > v_now;
  v_late_cancel := (EXTRACT(EPOCH FROM (v_appt.starts_at - v_now)) / 3600.0) < p_late_cancel_hours;

  -- Lembrete desatualizado (defeito 3): vale pra QUALQUER ação, em QUALQUER
  -- client_confirmation_status — promovido pra antes da decisão por estado.
  IF v_thread.appointment_starts_at_snapshot <> v_appt.starts_at THEN
    UPDATE public.whatsapp_central_threads
    SET status = 'stale', resolved_at = v_now, resolved_by_message_id = p_resolved_by_message_id
    WHERE id = p_thread_id;
    RETURN 'stale_reminder';
  END IF;

  IF v_appt.client_confirmation_status = 'declined' THEN
    IF NOT v_still_salvageable THEN
      RETURN 'late_response';
    ELSIF p_action = 'confirm' THEN
      RETURN 'confirm_after_cancel';
    ELSIF p_action = 'cancel' THEN
      RETURN 'no_op_already_cancelled';
    ELSE
      RETURN 'late_response'; -- reagendar depois de cancelar: sem regra específica
    END IF;

  ELSIF v_appt.client_confirmation_status = 'confirmed' THEN
    IF NOT v_still_salvageable THEN
      RETURN 'late_response';
    ELSIF p_action = 'confirm' THEN
      RETURN 'no_op_already_confirmed';
    ELSIF p_action = 'cancel' THEN
      UPDATE public.appointments SET client_confirmation_status = 'declined', status = 'cancelled' WHERE id = v_appt.id;
      v_decision := CASE WHEN v_late_cancel THEN 'apply_cancel_late' ELSE 'apply_cancel' END;
    ELSE
      UPDATE public.appointments SET client_confirmation_status = 'reschedule_requested' WHERE id = v_appt.id;
      v_decision := 'apply_reschedule_request';
    END IF;

  ELSIF v_appt.client_confirmation_status = 'reschedule_requested' THEN
    IF NOT v_still_salvageable OR v_appt.status = 'cancelled' THEN
      RETURN 'late_response';
    ELSIF p_action = 'reschedule' THEN
      v_decision := 'apply_reschedule_request_repeat';
    ELSIF p_action = 'confirm' THEN
      -- DEFEITO CORRIGIDO: agora também grava status='confirmed'.
      UPDATE public.appointments SET client_confirmation_status = 'confirmed', status = 'confirmed', client_confirmed_at = v_now WHERE id = v_appt.id;
      v_decision := 'apply_confirm';
    ELSE
      UPDATE public.appointments SET client_confirmation_status = 'declined', status = 'cancelled' WHERE id = v_appt.id;
      v_decision := CASE WHEN v_late_cancel THEN 'apply_cancel_late' ELSE 'apply_cancel' END;
    END IF;

  ELSE -- 'pending': nenhuma resposta definitiva ainda — só aqui a frescura DESTA thread importa.
    IF v_thread.status <> 'awaiting_reply' THEN
      RETURN 'late_response';
    END IF;
    IF NOT v_still_salvageable OR v_appt.status = 'cancelled' THEN
      RETURN 'late_response';
    END IF;

    IF p_action = 'confirm' THEN
      -- DEFEITO CORRIGIDO (a causa raiz desta migration): agora também
      -- grava status='confirmed' — antes só client_confirmation_status
      -- mudava, e a Agenda nunca ficava verde.
      UPDATE public.appointments SET client_confirmation_status = 'confirmed', status = 'confirmed', client_confirmed_at = v_now WHERE id = v_appt.id;
      v_decision := 'apply_confirm';
    ELSIF p_action = 'cancel' THEN
      UPDATE public.appointments SET client_confirmation_status = 'declined', status = 'cancelled' WHERE id = v_appt.id;
      v_decision := CASE WHEN v_late_cancel THEN 'apply_cancel_late' ELSE 'apply_cancel' END;
    ELSE
      UPDATE public.appointments SET client_confirmation_status = 'reschedule_requested' WHERE id = v_appt.id;
      v_decision := 'apply_reschedule_request';
    END IF;
  END IF;

  -- Autoria (defeito 4): só quando algo de fato mudou no agendamento —
  -- 'apply_reschedule_request_repeat' nunca grava (nada muda). actor_id
  -- fica NULL (sem usuário autenticado nesta chamada, SECURITY DEFINER
  -- puro) — audit_log.actor_id já é nullable, nenhuma coluna nova.
  IF v_decision IN ('apply_confirm', 'apply_cancel', 'apply_cancel_late', 'apply_reschedule_request') THEN
    INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
    VALUES (
      v_appt.owner_id,
      NULL,
      'Cliente via WhatsApp',
      v_decision,
      'appointments',
      v_appt.id::text,
      jsonb_build_object('thread_id', p_thread_id, 'action', p_action)
    );
  END IF;

  UPDATE public.whatsapp_central_threads
  SET
    status = CASE
      WHEN v_decision = 'apply_confirm' THEN 'resolved_confirmed'
      WHEN v_decision IN ('apply_cancel', 'apply_cancel_late') THEN 'resolved_cancelled'
      WHEN v_decision IN ('apply_reschedule_request', 'apply_reschedule_request_repeat') THEN 'resolved_reschedule_requested'
      ELSE status
    END,
    resolved_at = v_now,
    resolved_by_message_id = p_resolved_by_message_id
  WHERE id = p_thread_id;

  RETURN v_decision;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_whatsapp_central_reply(uuid, text, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_central_reply(uuid, text, uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_central_reply(uuid, text, uuid, numeric) TO sandbox_exec;

NOTIFY pgrst, 'reload schema';

COMMIT;
