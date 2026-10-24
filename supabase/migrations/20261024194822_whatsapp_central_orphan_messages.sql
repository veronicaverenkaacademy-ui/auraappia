-- Mensagens de texto/mídia recebidas no número central que não puderam ser
-- correlacionadas a nenhum agendamento/cliente específico (zero ou mais de
-- um candidato na janela de 7 dias — ver central-webhook-handler.server.ts)
-- — não têm owner_id válido, por isso não cabem em whatsapp_messages (FK
-- NOT NULL pra auth.users). Tabela só de observabilidade/diagnóstico, sem
-- RLS para nenhum papel além de service_role (não é "de" nenhum salão).
--
-- Limite de volume e retenção (item M7): nunca cresce sem limite por spam —
-- linhas mais antigas que RETENTION_DAYS (ver constante no código) são
-- responsabilidade do código limpar periodicamente (nenhum cron de limpeza
-- automática existe ainda — ver "Achados fora de escopo").
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

CREATE TABLE public.whatsapp_central_orphan_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_message_id text NOT NULL,
  from_phone text NOT NULL,
  content text,
  media_type text NOT NULL DEFAULT 'text',
  candidate_count int NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX whatsapp_central_orphan_messages_provider_id_idx
  ON public.whatsapp_central_orphan_messages (provider_message_id);
CREATE INDEX whatsapp_central_orphan_messages_created_idx
  ON public.whatsapp_central_orphan_messages (created_at DESC);

ALTER TABLE public.whatsapp_central_orphan_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_central_orphan_messages FROM anon, authenticated;
GRANT ALL ON public.whatsapp_central_orphan_messages TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
