-- Corrige o fluxo de mensagens automáticas de WhatsApp conforme decisão de produto
-- (auditoria read-only feita antes desta migration, resumo — respostas completas no chat):
--
-- 1. Novo tipo 'appointment_created' — enviado na CRIAÇÃO do agendamento (INSERT em
--    appointments), avisando que foi agendado. Nunca pede confirmação e nunca abre
--    confirmation thread (THREAD_OPENING_TYPES, em message-service.server.ts, não
--    inclui este tipo).
-- 2. Remove o envio automático de 'appointment_confirmation' na transição
--    pending -> confirmed — não corresponde a nenhum evento do fluxo aprovado. O tipo
--    continua válido no CHECK e no código (scheduler.server.ts) só para não quebrar o
--    processamento de qualquer job 'appointment_confirmation' que já esteja
--    pendente/em retry na fila no momento do deploy; nenhum job novo desse tipo volta
--    a ser criado.
-- 3. appointment_reminder_24h / appointment_reminder_2h continuam gerados exatamente
--    como antes (scanAndEnqueueReminders, em src/lib/whatsapp/scheduler.server.ts, não
--    muda) — só o CONTEÚDO do 24h muda (templates.ts) e o COMPORTAMENTO do 2h muda
--    (sai de THREAD_OPENING_TYPES) — nenhuma mudança de schema para os dois.

ALTER TABLE public.notification_jobs
  DROP CONSTRAINT IF EXISTS notification_jobs_type_check;
ALTER TABLE public.notification_jobs
  ADD CONSTRAINT notification_jobs_type_check
  CHECK (type IN (
    'appointment_confirmation', 'appointment_created',
    'appointment_reminder_24h', 'appointment_reminder_2h', 'test'
  ));

CREATE OR REPLACE FUNCTION public.enqueue_appointment_whatsapp_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_has_connected_whatsapp boolean;
BEGIN
  -- Reagendou (mudou starts_at) ou mudou de status: os lembretes antigos não
  -- valem mais pro novo horário/estado — zera pra recalcular do zero. O
  -- scheduler só volta a enfileirar se as condições (confirmed, janela de
  -- tempo) baterem de novo contra o novo starts_at.
  IF TG_OP = 'UPDATE'
     AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.status IS DISTINCT FROM OLD.status) THEN
    NEW.reminder_24h_sent_at := NULL;
    NEW.reminder_2h_sent_at := NULL;
  END IF;

  -- Cancelamento: cancela jobs de LEMBRETE ainda pendentes deste agendamento.
  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.notification_jobs
      SET status = 'cancelled'
      WHERE appointment_id = NEW.id
        AND status = 'pending'
        AND type IN ('appointment_reminder_24h', 'appointment_reminder_2h');
  END IF;

  -- Aviso de criação: dispara uma vez, na criação do agendamento (INSERT),
  -- independente do status inicial — é o EVENTO "foi agendado" que importa,
  -- não o status (hoje sempre 'pending' nos dois caminhos de escrita: painel e
  -- Portal da Cliente). Nunca pede confirmação — mensagem informativa.
  IF TG_OP = 'INSERT' THEN
    SELECT phone INTO v_phone FROM public.clients WHERE id = NEW.client_id;
    SELECT EXISTS (
      SELECT 1 FROM public.whatsapp_instances
      WHERE owner_id = NEW.owner_id AND status = 'connected'
    ) INTO v_has_connected_whatsapp;

    IF v_phone IS NOT NULL AND v_has_connected_whatsapp THEN
      INSERT INTO public.notification_jobs
        (owner_id, appointment_id, client_id, type, recipient_phone, scheduled_for)
      VALUES
        (NEW.owner_id, NEW.id, NEW.client_id, 'appointment_created', v_phone, now())
      ON CONFLICT (appointment_id, type) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
