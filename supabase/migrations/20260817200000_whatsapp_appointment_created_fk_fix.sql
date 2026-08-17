-- Corrige erro real observado em produção após a PR #52:
--
--   insert or update on table "notification_jobs" violates foreign key
--   constraint "notification_jobs_appointment_id_fkey"
--
-- Causa: a migration 20260817160000 passou a enfileirar 'appointment_created'
-- dentro de enqueue_appointment_whatsapp_jobs(), presa a um trigger
-- BEFORE INSERT OR UPDATE. Num BEFORE INSERT, NEW.id já tem valor, mas a
-- linha ainda não foi persistida em appointments — o INSERT em
-- notification_jobs (appointment_id = NEW.id) viola a FK porque o "pai"
-- ainda não existe na tabela.
--
-- Correção: separa a responsabilidade em dois triggers/funções, como já era
-- a estrutura antes da 20260817160000 (mas mantendo appointment_created):
--
-- 1. enqueue_appointment_whatsapp_jobs() volta a cuidar só do que sempre foi
--    UPDATE-only (reset de reminder_24h_sent_at/reminder_2h_sent_at em
--    reagendamento/mudança de status; cancelamento de lembretes pendentes) —
--    trigger muda de BEFORE INSERT OR UPDATE para BEFORE UPDATE. Nunca mais
--    roda em INSERT, então os `IF TG_OP = 'UPDATE'` internos (agora sempre
--    verdadeiros) foram removidos por clareza — comportamento idêntico.
--
-- 2. enqueue_appointment_created_job(), novo, roda em AFTER INSERT — nesse
--    momento o registro em appointments já foi persistido (mesma transação),
--    então o INSERT em notification_jobs respeita a FK normalmente. Mesma
--    lógica de guarda (telefone da cliente + instância conectada) e mesma
--    idempotência via ON CONFLICT (appointment_id, type), sem mudança de
--    comportamento — só o momento em que roda.

CREATE OR REPLACE FUNCTION public.enqueue_appointment_whatsapp_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reagendou (mudou starts_at) ou mudou de status: os lembretes antigos não
  -- valem mais pro novo horário/estado — zera pra recalcular do zero. O
  -- scheduler só volta a enfileirar se as condições (confirmed, janela de
  -- tempo) baterem de novo contra o novo starts_at.
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.reminder_24h_sent_at := NULL;
    NEW.reminder_2h_sent_at := NULL;
  END IF;

  -- Cancelamento: cancela jobs de LEMBRETE ainda pendentes deste agendamento.
  -- A confirmação, se já foi enviada, não é "desenviada" — só lembretes futuros
  -- deixam de fazer sentido.
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.notification_jobs
      SET status = 'cancelled'
      WHERE appointment_id = NEW.id
        AND status = 'pending'
        AND type IN ('appointment_reminder_24h', 'appointment_reminder_2h');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_enqueue_whatsapp ON public.appointments;
CREATE TRIGGER trg_appointments_enqueue_whatsapp
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_appointment_whatsapp_jobs();

-- Aviso de criação: dispara uma vez, em AFTER INSERT (registro pai já
-- existe), independente do status inicial — é o EVENTO "foi agendado" que
-- importa, não o status. Nunca pede confirmação — mensagem informativa.
CREATE OR REPLACE FUNCTION public.enqueue_appointment_created_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_has_connected_whatsapp boolean;
BEGIN
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

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointments_enqueue_created ON public.appointments;
CREATE TRIGGER trg_appointments_enqueue_created
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_appointment_created_job();
