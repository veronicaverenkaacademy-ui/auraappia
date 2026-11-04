-- ROLLBACK de 20261104133657_whatsapp_central_reply_confirm_status.sql —
-- restaura apply_whatsapp_central_reply pra definição EXATA capturada via
-- pg_get_functiondef ANTES desta migration (md5 7514f64af75944595a7437bc633465a3,
-- confirmado nesta sessão). Texto do corpo colado byte a byte da captura —
-- nunca reconstruído de memória.
--
-- Rodar isto DESFAZ: (1) CONFIRMAR deixa de gravar status='confirmed' (volta
-- a só mudar client_confirmation_status — o defeito original volta); (2)
-- 'no_show' deixa de ser excluído de "salvageable"; (3) a checagem de
-- lembrete desatualizado volta a valer só no ramo 'pending'; (4) o INSERT em
-- audit_log deixa de acontecer. Mesma assinatura/retorno/permissões de
-- antes (inclui sandbox_exec, que uma migration POSTERIOR à função original
-- --20261025210243_whatsapp_central_grants.sql-- concedeu; sem isso aqui o
-- rollback devolveria menos permissão do que a função tinha de fato
-- imediatamente antes desta mudança).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

CREATE OR REPLACE FUNCTION public.apply_whatsapp_central_reply(p_thread_id uuid, p_action text, p_resolved_by_message_id uuid, p_late_cancel_hours numeric DEFAULT 4)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      RETURN 'late_response';
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

  ELSE
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
$function$;

REVOKE ALL ON FUNCTION public.apply_whatsapp_central_reply(uuid, text, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_central_reply(uuid, text, uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_whatsapp_central_reply(uuid, text, uuid, numeric) TO sandbox_exec;

NOTIFY pgrst, 'reload schema';

COMMIT;
