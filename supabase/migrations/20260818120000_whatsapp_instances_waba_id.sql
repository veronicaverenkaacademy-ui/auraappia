-- Adiciona waba_id (WhatsApp Business Account ID) por conexão — a única
-- lacuna real identificada para o Embedded Signup: o retorno do fluxo da
-- Meta entrega phone_number_id (já cabia em instance_id) e waba_id (não
-- tinha onde guardar). Não usado por sendText/getConnectedIdentity (que só
-- precisam de phone_number_id + token), mas necessário para qualquer gestão
-- futura de templates/WABA e para auditoria de qual conta Meta está por
-- trás de cada conexão.
--
-- Aditiva, não destrutiva — não apaga nem altera nenhuma linha existente.
ALTER TABLE public.whatsapp_instances
  ADD COLUMN waba_id text;
