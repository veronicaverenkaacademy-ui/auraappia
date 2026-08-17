-- Permite whatsapp_instances.provider = 'meta_cloud_api', além do 'evolution'
-- já existente — necessário pra reutilizar a mesma tabela/dispatch
-- (WhatsAppMessageService.PROVIDERS, em message-service.server.ts) pro novo
-- MetaCloudApiProvider, em vez de criar um schema paralelo.
--
-- Nenhuma outra estrutura muda: as colunas existentes já são genéricas o
-- suficiente para guardar as credenciais da Meta —
--   instance_id    → phone_number_id (o identificador que a Graph API usa)
--   phone_number   → número confirmado, mesmo uso da Evolution
--   instance_token → fica NULL nas linhas meta_cloud_api; o access token da
--                    Cloud API é uma credencial GLOBAL da conta (env var
--                    META_WHATSAPP_ACCESS_TOKEN), não por instância — mesma
--                    relação que EVOLUTION_GLOBAL_API_KEY já tem com a
--                    Evolution hoje.
ALTER TABLE public.whatsapp_instances
  DROP CONSTRAINT IF EXISTS whatsapp_instances_provider_check;
ALTER TABLE public.whatsapp_instances
  ADD CONSTRAINT whatsapp_instances_provider_check
  CHECK (provider IN ('evolution', 'meta_cloud_api'));
