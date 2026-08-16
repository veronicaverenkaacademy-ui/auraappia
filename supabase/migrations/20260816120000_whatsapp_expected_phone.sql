-- Guarda o telefone que a profissional informou ao pedir um código de
-- pareamento, para permitir validar depois (via fetchInstances da Evolution)
-- se o número que realmente conectou é o mesmo que foi pedido — em vez de
-- confiar cegamente no webhook/status para marcar a conexão como válida.
-- Limpo assim que a conexão é confirmada (vira whatsapp_instances.phone_number)
-- ou permanece como diagnóstico quando a conexão é rejeitada por descompasso.
ALTER TABLE public.whatsapp_instances
  ADD COLUMN expected_phone_number text;

-- Identificador da tentativa de conexão em curso. Gerado de novo a cada
-- createWhatsAppConnection bem-sucedida (delete da instância antiga + create
-- da nova). Toda escrita subsequente relacionada a essa tentativa (o próprio
-- createWhatsAppConnection, reconcileWhatsAppConnection, o webhook) condiciona
-- seus UPDATEs a "owner_id AND attempt_id" — se uma tentativa antiga terminar
-- de validar depois de uma nova já ter começado, o attempt_id não bate mais,
-- o UPDATE afeta zero linhas, e a escrita obsoleta é descartada sem efeito
-- sobre a tentativa atual. DEFAULT só para as linhas existentes na migração;
-- todo código novo grava o valor explicitamente a cada tentativa.
ALTER TABLE public.whatsapp_instances
  ADD COLUMN attempt_id uuid NOT NULL DEFAULT gen_random_uuid();
