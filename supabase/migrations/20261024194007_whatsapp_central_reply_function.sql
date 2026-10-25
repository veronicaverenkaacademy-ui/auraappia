-- Aplica a resposta de um botão (confirmar/reagendar/cancelar) de forma
-- atômica: SELECT ... FOR UPDATE no AGENDAMENTO (não na thread) garante que
-- dois toques simultâneos (ou toques em botões diferentes da mesma
-- mensagem, entregues em paralelo pela Meta) sejam serializados — o segundo
-- só roda depois do primeiro ter terminado e vê o estado já atualizado.
--
-- ESPELHA EXATAMENTE src/lib/whatsapp/central-reply-decision.ts
-- (decideThreadReply) — qualquer mudança de regra precisa ser feita NOS
-- DOIS lugares (a função TS é a especificação testada; esta função SQL é
-- quem de fato aplica, porque supabase-js não tem transação/lock de linha
-- pelo cliente). Decide por client_confirmation_status (estado de
-- verdade), não por whatsapp_central_threads.status — um segundo toque
-- (repetido, ou em botão diferente da mesma mensagem) é reconhecido pelo
-- que o agendamento JÁ É, nunca tratado como "resposta tardia" só porque a
-- thread da primeira resposta já foi marcada resolvida. Só
-- client_confirmation_status='pending' (nenhuma resposta definitiva ainda)
-- depende de a THREAD específica ainda estar em aberto e não estar
-- desatualizada.
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

  v_still_salvageable := v_appt.status <> 'completed' AND v_appt.starts_at > v_now;
  v_late_cancel := (EXTRACT(EPOCH FROM (v_appt.starts_at - v_now)) / 3600.0) < p_late_cancel_hours;

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
      UPDATE public.appointments SET client_confirmation_status = 'confirmed', client_confirmed_at = v_now WHERE id = v_appt.id;
      v_decision := 'apply_confirm';
    ELSE
      UPDATE public.appointments SET client_confirmation_status = 'declined', status = 'cancelled' WHERE id = v_appt.id;
      v_decision := CASE WHEN v_late_cancel THEN 'apply_cancel_late' ELSE 'apply_cancel' END;
    END IF;

  ELSE -- 'pending': nenhuma resposta definitiva ainda — só aqui a frescura DESTA thread importa.
    IF v_thread.status <> 'awaiting_reply' THEN
      RETURN 'late_response';
    END IF;
    IF v_thread.appointment_starts_at_snapshot <> v_appt.starts_at THEN
      UPDATE public.whatsapp_central_threads
      SET status = 'stale', resolved_at = v_now, resolved_by_message_id = p_resolved_by_message_id
      WHERE id = p_thread_id;
      RETURN 'stale_reminder';
    END IF;
    IF NOT v_still_salvageable OR v_appt.status = 'cancelled' THEN
      RETURN 'late_response';
    END IF;

    IF p_action = 'confirm' THEN
      UPDATE public.appointments SET client_confirmation_status = 'confirmed', client_confirmed_at = v_now WHERE id = v_appt.id;
      v_decision := 'apply_confirm';
    ELSIF p_action = 'cancel' THEN
      UPDATE public.appointments SET client_confirmation_status = 'declined', status = 'cancelled' WHERE id = v_appt.id;
      v_decision := CASE WHEN v_late_cancel THEN 'apply_cancel_late' ELSE 'apply_cancel' END;
    ELSE
      UPDATE public.appointments SET client_confirmation_status = 'reschedule_requested' WHERE id = v_appt.id;
      v_decision := 'apply_reschedule_request';
    END IF;
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

NOTIFY pgrst, 'reload schema';

COMMIT;
