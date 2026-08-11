-- MVP de WhatsApp via Evolution API (conexão por QR Code) — camada PROVISÓRIA,
-- isolada atrás da abstração WhatsAppProvider (src/lib/whatsapp/provider.ts) para
-- ser trocada depois por Meta Cloud API/360dialog oficial sem tocar em agenda,
-- clientes ou no restante do domínio do AURA. Ver docs/whatsapp-evolution-mvp.md.
--
-- Escopo: confirmação automática de agendamento + lembretes de 24h/2h, para um
-- grupo pequeno de profissionais em teste. Deliberadamente separado do
-- Communication Service (communication_provider_config/conversations/messages/
-- message_templates, 20260804180000) — aquele foi desenhado para BSPs
-- (360dialog/Meta) sem conceito de pareamento de dispositivo por QR Code, que a
-- Evolution exige estruturalmente. Reconciliar as duas camadas fica para quando
-- a integração oficial (Meta/360dialog) substituir esta, não agora.

-- 1. Conexão WhatsApp por conta. "professional_id" do pedido original = owner_id
--    no modelo atual do AURA (multi-tenant por conta, não por team_members) —
--    mesmo padrão de company_profiles (chave primária é o próprio owner_id,
--    no máximo uma conexão por conta neste MVP).
CREATE TABLE public.whatsapp_instances (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'evolution' CHECK (provider = 'evolution'),
  instance_name text NOT NULL UNIQUE,
  instance_token text,
  phone_number text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connecting', 'connected', 'disconnected', 'error')),
  connection_state text,
  instance_id text,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Igual a client_otp_codes: zero policy pra anon/authenticated, só service_role
-- (sempre via server function) toca aqui — instance_token é segredo, e nem a
-- própria dona tem motivo pra lê-lo diretamente da tabela (o frontend só recebe
-- o status, via getWhatsAppStatus).
ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_instances FROM anon, authenticated;
GRANT ALL ON public.whatsapp_instances TO service_role;

CREATE TRIGGER trg_whatsapp_instances_updated_at BEFORE UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Fila de notificações — desacopla a criação/confirmação do agendamento do
--    envio de fato (nunca bloqueia o fluxo esperando a Evolution responder).
--    Também é a peça central de idempotência: um único índice único por
--    (appointment_id, type) garante que trigger, scheduler e retries nunca
--    criem dois jobs para o mesmo lembrete/confirmação, não importa quantas
--    vezes rodem.
CREATE TABLE public.notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  type text NOT NULL
    CHECK (type IN ('appointment_confirmation', 'appointment_reminder_24h', 'appointment_reminder_2h', 'test')),
  recipient_phone text NOT NULL,
  message text NOT NULL DEFAULT '',
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sem WHERE parcial de propósito: appointment_id é sempre preenchido neste MVP
-- (o único tipo sem agendamento, "test", nunca passa pela fila — vai direto
-- via WhatsAppMessageService, síncrono, ação explícita da profissional). Índice
-- não-parcial deixa o ON CONFLICT (appointment_id, type) do upsert/trigger
-- resolver de forma simples e confiável (NULLs, se um dia existirem, não
-- conflitam entre si por padrão).
CREATE UNIQUE INDEX notification_jobs_appt_type_idx ON public.notification_jobs (appointment_id, type);
CREATE INDEX notification_jobs_claim_idx ON public.notification_jobs (status, next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX notification_jobs_owner_idx ON public.notification_jobs (owner_id, created_at DESC);

ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_jobs FROM anon, authenticated;
GRANT ALL ON public.notification_jobs TO service_role;

CREATE TRIGGER trg_notification_jobs_updated_at BEFORE UPDATE ON public.notification_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reivindicação atômica de jobs (FOR UPDATE SKIP LOCKED) — garante que dois
-- workers/crons concorrentes nunca peguem o mesmo job pendente (cron duplicado,
-- worker reiniciando no meio do processamento etc.). SECURITY DEFINER porque só
-- service_role deve poder chamar isto (revogado de anon/authenticated abaixo).
CREATE OR REPLACE FUNCTION public.claim_notification_jobs(p_limit int DEFAULT 10)
RETURNS SETOF public.notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.notification_jobs
  SET status = 'processing', attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM public.notification_jobs
    WHERE status = 'pending' AND next_attempt_at <= now()
    ORDER BY scheduled_for
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_jobs(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_jobs(int) TO service_role;

-- 3. Log de mensagens (outbound/inbound) — observabilidade e base para a futura
--    Inbox do AURA. Não tem policy de leitura pro frontend ainda neste MVP (só
--    service_role); uma tela de histórico viria com uma server function
--    dedicada, igual ao restante do projeto.
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  message_type text NOT NULL,
  recipient_phone text NOT NULL,
  content text,
  provider text NOT NULL DEFAULT 'evolution',
  provider_message_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_messages_owner_idx ON public.whatsapp_messages (owner_id, created_at DESC);
CREATE INDEX whatsapp_messages_client_idx ON public.whatsapp_messages (client_id, created_at DESC);
CREATE UNIQUE INDEX whatsapp_messages_provider_id_idx ON public.whatsapp_messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_messages FROM anon, authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;

-- 4. Controle de lembretes já enviados por agendamento — idempotência de alto
--    nível (o índice único em notification_jobs já impede duplicar o job; isto
--    aqui impede o scheduler de sequer tentar recriar um job pra um lembrete já
--    confirmadamente entregue).
ALTER TABLE public.appointments
  ADD COLUMN reminder_24h_sent_at timestamptz,
  ADD COLUMN reminder_2h_sent_at timestamptz;

-- 5. Fuso horário por conta, pros lembretes nunca serem calculados só em UTC.
--    Nenhuma tabela do projeto tinha essa coluna ainda — default seguro pro
--    público atual do AURA (100% Brasil), mas não é uma regra fixa no código:
--    fica no banco, por conta, pronta pra variar no futuro.
ALTER TABLE public.company_profiles
  ADD COLUMN timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

-- 6. Trigger de enfileiramento: única porta de entrada pra "isto virou um
--    agendamento confirmado", porque appointments é escrita por DOIS caminhos
--    diferentes no app (agenda.ts, direto do navegador com RLS; e
--    booking.functions.ts, server-side com service_role, no Portal da Cliente)
--    — um trigger de banco é o único ponto que nenhum dos dois consegue
--    contornar. Mesmo padrão já usado no projeto (consume_appointment_materials,
--    record_appointment_revenue, comentados em 20260730130000_agenda_real.sql).
--
--    A mensagem em si (message) fica vazia aqui de propósito — é montada pelo
--    worker em TypeScript (src/lib/whatsapp/templates.ts), lendo os dados mais
--    atuais do agendamento no momento do envio, não no momento da criação.
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
  -- A confirmação, se já foi enviada, não é "desenviada" — só lembretes futuros
  -- deixam de fazer sentido.
  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.notification_jobs
      SET status = 'cancelled'
      WHERE appointment_id = NEW.id
        AND status = 'pending'
        AND type IN ('appointment_reminder_24h', 'appointment_reminder_2h');
  END IF;

  -- Confirmação automática: só na transição PARA "confirmed" (criação já
  -- confirmada, ou update de outro status -> confirmed). Nunca reenvia se já
  -- estava confirmed (ON CONFLICT DO NOTHING é a segunda camada de proteção).
  IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
    SELECT phone INTO v_phone FROM public.clients WHERE id = NEW.client_id;
    SELECT EXISTS (
      SELECT 1 FROM public.whatsapp_instances
      WHERE owner_id = NEW.owner_id AND status = 'connected'
    ) INTO v_has_connected_whatsapp;

    IF v_phone IS NOT NULL AND v_has_connected_whatsapp THEN
      INSERT INTO public.notification_jobs
        (owner_id, appointment_id, client_id, type, recipient_phone, scheduled_for)
      VALUES
        (NEW.owner_id, NEW.id, NEW.client_id, 'appointment_confirmation', v_phone, now())
      ON CONFLICT (appointment_id, type) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_appointments_enqueue_whatsapp
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_appointment_whatsapp_jobs();
