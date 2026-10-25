-- Thread de pergunta↔resposta para o NOVO sistema central (template pelo
-- número da AURA) — independente de public.whatsapp_confirmation_threads
-- (que continua servindo só o fluxo antigo por salão/texto livre,
-- intencionalmente não tocado por esta etapa). Mesmo conceito,
-- implementação separada: evita qualquer risco de alterar o comportamento
-- do fluxo legado ao construir o novo.
--
-- Resolução de uma resposta de botão (M7) usa PRIMEIRO esta tabela via
-- outbound_message_id = context.id do webhook (nunca confia só no payload
-- do botão) — ver docs/whatsapp-central.md quando escrito.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

CREATE TABLE public.whatsapp_central_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  outbound_message_id uuid NOT NULL REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  template_key text NOT NULL CHECK (template_key IN ('lembrete_24h', 'lembrete_2h')),
  -- Snapshot do horário no momento do envio (item M7: "lembrete desatualizado"
  -- — se o agendamento mudar depois, uma resposta tardia não confirma/cancela
  -- o horário novo por engano).
  appointment_starts_at_snapshot timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_reply'
    CHECK (status IN (
      'awaiting_reply', 'resolved_confirmed', 'resolved_cancelled',
      'resolved_reschedule_requested', 'superseded', 'stale'
    )),
  resolved_by_message_id uuid NULL REFERENCES public.whatsapp_messages(id),
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Só uma pergunta em aberto por agendamento ao mesmo tempo — quem abre uma
-- nova (ex.: lembrete_2h depois do lembrete_24h) marca a antiga como
-- 'superseded' ANTES de inserir, mesmo padrão já usado na tabela legada.
CREATE UNIQUE INDEX whatsapp_central_threads_open_idx
  ON public.whatsapp_central_threads (appointment_id)
  WHERE status = 'awaiting_reply';

CREATE INDEX whatsapp_central_threads_client_open_idx
  ON public.whatsapp_central_threads (client_id)
  WHERE status = 'awaiting_reply';
CREATE INDEX whatsapp_central_threads_owner_idx
  ON public.whatsapp_central_threads (owner_id, created_at DESC);
CREATE INDEX whatsapp_central_threads_outbound_idx
  ON public.whatsapp_central_threads (outbound_message_id);

ALTER TABLE public.whatsapp_central_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_central_threads FROM anon, authenticated;
GRANT ALL ON public.whatsapp_central_threads TO service_role;

-- Reaproveita a função de trigger já existente no projeto (update_updated_at_column).
CREATE TRIGGER trg_whatsapp_central_threads_updated_at
  BEFORE UPDATE ON public.whatsapp_central_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';

COMMIT;
