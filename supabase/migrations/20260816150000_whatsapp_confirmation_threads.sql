-- Confirmação de agendamento via resposta no WhatsApp (V1, determinística,
-- sem IA). Ver docs/whatsapp-evolution-mvp.md. Auditoria completa deste fluxo
-- feita antes desta migration: o webhook já recebia mensagens inbound e as
-- gravava em whatsapp_messages, mas nada as correlacionava a um agendamento
-- nem interpretava o conteúdo — esta migration cria a peça que faltava.
--
-- 1. Thread de confirmação — vínculo INEQUÍVOCO entre a mensagem que o AURA
--    mandou perguntando (outbound_message_id) e o agendamento em questão
--    (appointment_id). Resolver uma resposta recebida nunca depende de "qual
--    é o próximo/último agendamento da cliente" — depende só de "o que o
--    AURA está esperando essa cliente responder agora", rastreado aqui.
--
--    appointment_starts_at_snapshot guarda o horário no momento em que a
--    pergunta foi enviada — se o agendamento for reagendado depois, dá pra
--    comparar e recusar confirmar silenciosamente o horário errado (thread
--    vira 'stale', a aplicação decide, não o banco).
--
--    Histórico nunca é apagado — status vai acumulando
--    awaiting_reply -> resolved_* / superseded / stale, sempre com timestamp.
CREATE TABLE public.whatsapp_confirmation_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  outbound_message_id uuid NOT NULL REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  appointment_starts_at_snapshot timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_reply'
    CHECK (status IN (
      'awaiting_reply', 'resolved_confirmed', 'resolved_declined',
      'resolved_reschedule_requested', 'superseded', 'stale'
    )),
  resolved_by_message_id uuid REFERENCES public.whatsapp_messages(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Único ponto que impede duas perguntas em aberto para o mesmo agendamento
-- ao mesmo tempo — quando um lembrete novo é enviado (ex: 2h depois do de
-- 24h), a aplicação marca a thread antiga como 'superseded' ANTES de inserir
-- a nova; esse índice garante isso no próprio banco, não só por disciplina
-- de aplicação.
CREATE UNIQUE INDEX whatsapp_confirmation_threads_open_idx
  ON public.whatsapp_confirmation_threads (appointment_id)
  WHERE status = 'awaiting_reply';

-- Busca rápida de "quais threads estão em aberto para esta cliente agora" —
-- é a consulta central da resolução de uma resposta recebida.
CREATE INDEX whatsapp_confirmation_threads_client_open_idx
  ON public.whatsapp_confirmation_threads (client_id)
  WHERE status = 'awaiting_reply';

CREATE INDEX whatsapp_confirmation_threads_owner_idx
  ON public.whatsapp_confirmation_threads (owner_id, created_at DESC);
CREATE INDEX whatsapp_confirmation_threads_appointment_idx
  ON public.whatsapp_confirmation_threads (appointment_id, created_at DESC);

-- Mesmo padrão de RLS das demais tabelas deste MVP — só service_role, nunca
-- anon/authenticated (o frontend nunca lê/edita threads diretamente).
ALTER TABLE public.whatsapp_confirmation_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_confirmation_threads FROM anon, authenticated;
GRANT ALL ON public.whatsapp_confirmation_threads TO service_role;

CREATE TRIGGER trg_whatsapp_confirmation_threads_updated_at
  BEFORE UPDATE ON public.whatsapp_confirmation_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Confirmação da CLIENTE é uma informação separada da confirmação da
--    PROFISSIONAL (appointments.status = 'confirmed', que já existe e já
--    significa outra coisa — é o que dispara o próprio pipeline de lembrete.
--    Não sobrepor os dois conceitos no mesmo campo.
ALTER TABLE public.appointments
  ADD COLUMN client_confirmation_status text NOT NULL DEFAULT 'pending'
    CHECK (client_confirmation_status IN ('pending', 'confirmed', 'declined', 'reschedule_requested')),
  ADD COLUMN client_confirmed_at timestamptz;
