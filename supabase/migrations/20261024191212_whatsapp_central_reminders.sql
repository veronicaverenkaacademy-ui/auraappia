-- WhatsApp central (Etapa 1): lembretes 24h/2h por template pelo número
-- central da AURA + base para tratar respostas de botão. Só aditivo:
-- colunas novas (nulas ou com default), tabelas novas com RLS, correção de
-- dados (meta_status) via caminho já autorizado (aura_system_bypass, dentro
-- de uma migration, nunca pela API). Nenhuma coluna/tabela/política
-- existente é removida ou tornada mais permissiva.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ===================== SEÇÃO A — correção de meta_status (item 1 do pedido) =====================
-- A dona confirmou os 4 templates como Ativos/aprovados na Meta. Hoje
-- (confirmado por consulta antes desta migration): lembrete_24h=PENDING,
-- lembrete_2h=APPROVED (já correto), pos_avaliacao_google=PENDING,
-- retorno_30_dias=PENDING. Corrige os 3 que não estão certos ainda — rodando
-- como sessão `postgres`, que aura_system_bypass() reconhece, então passa
-- pelo trigger trg_23_automations_protect_meta_fields sem violar a trava.
-- NÃO altera a coluna `active` (fora do que foi nomeado na autorização) —
-- ver "Decisões que dependem de você" no relatório.
--
-- Backup pontual (só id + meta_status, as únicas colunas que esta seção
-- toca) antes da correção, pro rollback conseguir restaurar o valor exato
-- de cada linha em vez de assumir um valor fixo.
CREATE SCHEMA IF NOT EXISTS aura_private;
CREATE TABLE IF NOT EXISTS aura_private.backup_whatsapp_central_20261024_automations_meta_status (
  automation_id uuid PRIMARY KEY,
  meta_status text NOT NULL
);
INSERT INTO aura_private.backup_whatsapp_central_20261024_automations_meta_status (automation_id, meta_status)
SELECT id, meta_status
FROM public.automations
WHERE is_system = true
  AND template_key IN ('lembrete_24h', 'lembrete_2h', 'pos_avaliacao_google', 'retorno_30_dias')
ON CONFLICT (automation_id) DO NOTHING;

UPDATE public.automations
SET meta_status = 'APPROVED'
WHERE is_system = true
  AND template_key IN ('lembrete_24h', 'lembrete_2h', 'pos_avaliacao_google', 'retorno_30_dias')
  AND meta_status <> 'APPROVED';

-- ===================== SEÇÃO B — whatsapp_messages: colunas novas (item M2) =====================
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS template_name text NULL,
  ADD COLUMN IF NOT EXISTS template_language text NULL,
  ADD COLUMN IF NOT EXISTS error_code int NULL,
  ADD COLUMN IF NOT EXISTS error_class text NULL;

ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_error_class_check;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_error_class_check
  CHECK (error_class IS NULL OR error_class IN ('transient', 'permanent', 'uncertain'));

-- Amplia o CHECK de status para incluir 'uncertain' (resultado possível de um
-- envio de template: timeout depois de mandar o POST, sem saber se chegou).
-- Nome real confirmado por catálogo antes de escrever esta migration
-- (pg_get_constraintdef): whatsapp_messages_status_check.
ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_status_check;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'uncertain'));

-- ===================== SEÇÃO C — fila de reconciliação de status (item M2) =====================
-- Guarda um evento de status (sent/delivered/read/failed) que chegou pelo
-- webhook ANTES de sabermos o wamid (whatsapp_messages.provider_message_id
-- ainda não foi gravado — corrida possível entre a resposta do POST de envio
-- e o webhook de status, que pode chegar primeiro). Nunca apagada em
-- silêncio: ou é resolvida (resolved_at) quando o wamid aparece, ou abandonada
-- (abandoned_at) depois do limite de tentativas/validade — sempre consultável.
CREATE TABLE public.whatsapp_status_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  error_code int NULL,
  occurred_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 10,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  resolved_at timestamptz NULL,
  abandoned_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Um wamid pode passar por vários status (sent -> delivered -> read); cada
-- status distinto é sua própria linha, mas reentrega do MESMO status pela
-- Meta (ela reenvia webhooks) não deve duplicar.
CREATE UNIQUE INDEX whatsapp_status_reconciliation_wamid_status_idx
  ON public.whatsapp_status_reconciliation (provider_message_id, status);
CREATE INDEX whatsapp_status_reconciliation_pending_idx
  ON public.whatsapp_status_reconciliation (expires_at)
  WHERE resolved_at IS NULL AND abandoned_at IS NULL;

ALTER TABLE public.whatsapp_status_reconciliation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_status_reconciliation FROM anon, authenticated;
GRANT ALL ON public.whatsapp_status_reconciliation TO service_role;

-- ===================== SEÇÃO D — incidentes / freio de emergência (item M2) =====================
-- Um incidente ABERTO (resolved_at IS NULL) de escopo 'global' significa
-- "para de enviar tudo"; de escopo 'template' (com template_key preenchido)
-- significa "para de enviar só esse template". notified_at garante o aviso
-- único por incidente (item M2: "dispara um aviso para a dona uma vez por
-- incidente") — a aplicação checa se já é não-nulo antes de notificar de novo.
CREATE TABLE public.whatsapp_central_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('global', 'template')),
  template_key text NULL,
  reason text NOT NULL,
  meta_error_code int NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  notified_at timestamptz NULL,
  CONSTRAINT whatsapp_central_incidents_template_scope_check
    CHECK ((scope = 'template' AND template_key IS NOT NULL) OR (scope = 'global' AND template_key IS NULL))
);

-- Nunca dois incidentes abertos do mesmo escopo ao mesmo tempo — a aplicação
-- consulta "existe incidente aberto?" antes de decidir se interrompe o lote.
CREATE UNIQUE INDEX whatsapp_central_incidents_open_global_idx
  ON public.whatsapp_central_incidents (scope)
  WHERE scope = 'global' AND resolved_at IS NULL;
CREATE UNIQUE INDEX whatsapp_central_incidents_open_template_idx
  ON public.whatsapp_central_incidents (template_key)
  WHERE scope = 'template' AND resolved_at IS NULL;

ALTER TABLE public.whatsapp_central_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_central_incidents FROM anon, authenticated;
GRANT ALL ON public.whatsapp_central_incidents TO service_role;

-- ===================== SEÇÃO E — notificações para dona/profissional (item M2/M7/M8) =====================
-- Mínimo pedido no item M8: não existia nenhuma estrutura de notificação real
-- para a profissional antes desta migration (/notificacoes é só preferências,
-- ver docs/whatsapp-central-progress.md). `recipient_user_id` NULL = só a
-- dona vê (ex.: incidente de configuração); preenchido = aquela profissional
-- específica também vê, além da dona.
CREATE TABLE public.app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  appointment_id uuid NULL REFERENCES public.appointments(id) ON DELETE SET NULL,
  -- Chave de unicidade pedida no item M7 ("repetição não duplica
  -- notificação") — nula quando não se aplica (ex.: aviso de incidente).
  dedupe_key text NULL,
  read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX app_notifications_dedupe_idx
  ON public.app_notifications (owner_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX app_notifications_owner_unread_idx
  ON public.app_notifications (owner_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX app_notifications_recipient_idx
  ON public.app_notifications (recipient_user_id, created_at DESC);

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_notifications FROM anon, authenticated;
GRANT ALL ON public.app_notifications TO service_role;

-- Leitura: a própria dona (owner_id = auth.uid()), a profissional destinatária
-- direta (recipient_user_id = auth.uid()), ou qualquer colaboradora com
-- staff_can(owner_id, 'agenda', 'view') — reaproveita a função já existente
-- (staff_access.sql), nunca amplia o que ela já concede. Escrita (marcar como
-- lida) só quem pode ler a própria notificação; nunca altera title/body/kind.
CREATE POLICY app_notifications_select ON public.app_notifications
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR recipient_user_id = auth.uid()
    OR staff_can(owner_id, 'agenda', 'view')
  );

CREATE POLICY app_notifications_mark_read ON public.app_notifications
  FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid()
    OR recipient_user_id = auth.uid()
    OR staff_can(owner_id, 'agenda', 'view')
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR recipient_user_id = auth.uid()
    OR staff_can(owner_id, 'agenda', 'view')
  );

-- Protege title/body/kind/appointment_id/dedupe_key/owner_id/recipient_user_id
-- contra alteração pelo authenticated — só read_at pode mudar pela policy
-- acima na prática, mas o Postgres não restringe UPDATE por coluna via RLS;
-- um trigger é a forma real de travar isso (mesmo padrão UR00x já usado no
-- projeto).
CREATE OR REPLACE FUNCTION public.app_notifications_protect_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT aura_private.aura_system_bypass()
     AND (NEW.owner_id IS DISTINCT FROM OLD.owner_id
          OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
          OR NEW.kind IS DISTINCT FROM OLD.kind
          OR NEW.title IS DISTINCT FROM OLD.title
          OR NEW.body IS DISTINCT FROM OLD.body
          OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
          OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UR011',
      MESSAGE = 'AURA_NOTIFICATION_FIELDS_LOCKED: só read_at pode ser alterado por quem recebeu a notificação.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.app_notifications_protect_fields() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_app_notifications_protect_fields
  BEFORE UPDATE ON public.app_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.app_notifications_protect_fields();

NOTIFY pgrst, 'reload schema';

COMMIT;
