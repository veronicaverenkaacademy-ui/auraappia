-- Fase 1 da arquitetura de comunicação (Communication Service): tabelas de
-- conversas, mensagens, templates e status de conexão do provedor. Nenhuma
-- guarda segredo/API key — isso fica só em variável de ambiente server-side
-- (ex: WHATSAPP_360DIALOG_API_KEY), lida dentro de src/lib/communication/
-- providers/dialog360.server.ts, nunca em tabela nem no bundle do cliente.

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  provider text NOT NULL DEFAULT '360dialog',
  external_id text,
  contact_phone text,
  contact_name text,
  handler text NOT NULL DEFAULT 'ai',
  status text NOT NULL DEFAULT 'open',
  last_message_at timestamptz,
  unread_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_owner_idx ON public.conversations (owner_id, last_message_at DESC);
CREATE UNIQUE INDEX conversations_provider_external_idx ON public.conversations (provider, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'geral',
  channel text NOT NULL DEFAULT 'whatsapp',
  provider text NOT NULL DEFAULT '360dialog',
  provider_template_name text,
  language text NOT NULL DEFAULT 'pt_BR',
  body text NOT NULL,
  variables text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_templates_owner_idx ON public.message_templates (owner_id);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction text NOT NULL,
  kind text NOT NULL DEFAULT 'text',
  content text,
  media_url text,
  template_id uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT '360dialog',
  external_id text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  sent_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_direction_check CHECK (direction IN ('in', 'out'))
);
CREATE INDEX messages_conversation_idx ON public.messages (conversation_id, created_at DESC);
CREATE UNIQUE INDEX messages_provider_external_idx ON public.messages (provider, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE public.communication_provider_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  provider text NOT NULL DEFAULT '360dialog',
  status text NOT NULL DEFAULT 'not_configured',
  phone_number text,
  display_name text,
  waba_id text,
  channel_id text,
  quality_rating text,
  messaging_limit text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, channel, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_provider_config TO authenticated;
GRANT ALL ON public.conversations TO service_role;
GRANT ALL ON public.messages TO service_role;
GRANT ALL ON public.message_templates TO service_role;
GRANT ALL ON public.communication_provider_config TO service_role;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_provider_config ENABLE ROW LEVEL SECURITY;

-- O webhook do provedor grava via service_role (bypassa RLS, mesmo padrão de
-- team.functions.ts) — estas policies cobrem o acesso da profissional pelo app.
CREATE POLICY conversations_owner_all ON public.conversations
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY messages_owner_all ON public.messages
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY message_templates_owner_all ON public.message_templates
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY communication_provider_config_owner_all ON public.communication_provider_config
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_message_templates_updated_at BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_communication_provider_config_updated_at BEFORE UPDATE ON public.communication_provider_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
