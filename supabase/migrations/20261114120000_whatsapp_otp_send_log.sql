-- FASE LEMBRETES-3 (Ponto B) — registro mínimo do envio de OTP via WhatsApp
-- (número central, Meta Cloud API). ESTE ARQUIVO AINDA NÃO FOI APLICADO EM
-- PRODUÇÃO nesta fase — por instrução explícita da dona, só branch nova +
-- PR em DRAFT. Criado só com leitura prévia do código (send-otp-meta.server.ts,
-- ver relatório da fase): hoje, QUALQUER tentativa de envio de OTP (sucesso
-- ou falha) só produz, no melhor caso, um console.error efêmero — nenhuma
-- tabela registra que um envio de OTP aconteceu, muito menos se funcionou.
-- Isso deixa a dona sem qualquer jeito de investigar "por que a cliente não
-- recebeu o código" além de pedir pra ela tentar de novo.
--
-- Nunca grava telefone, código OTP, hash do código nem texto de mensagem —
-- só o nome do modelo, o desfecho (sent|failed) e, quando falhou, o código
-- de erro da Meta e a classe do erro (permanent|temporary). Mesmo padrão de
-- "só contagens/metadados agregados, nunca o conteúdo real" já usado em
-- whatsapp_cron_runs (20261112200000_whatsapp_reminders_reliable_dispatch.sql).
--
-- owner_id é NULLABLE e, na prática, hoje SEMPRE NULL: sendOtpViaMeta()
-- (send-otp-meta.server.ts) não recebe nem resolve nenhum ownerId — o envio
-- de OTP usa o número CENTRAL compartilhado, antes de a cliente estar
-- vinculada a nenhuma dona específica (ela pode nem ter conta ainda). A
-- coluna já nasce nullable/preparada para um eventual contexto futuro com
-- dona conhecida, mas nenhum código desta fase jamais preenche um valor
-- não-nulo nela.
--
-- RLS ligada, acesso só para service_role — mesmo padrão de
-- whatsapp_cron_runs/whatsapp_blocked_recipients: REVOKE explícito de
-- PUBLIC/anon/authenticated (nunca confiar só no "não foi concedido",
-- sempre revogar explicitamente, mesma lição já aplicada nas migrations
-- anteriores desta família).
--
-- Aditiva e retrocompatível: cria só esta tabela nova, não altera nenhuma
-- tabela/coluna/função/política existente. Idempotente (CREATE TABLE/INDEX
-- IF NOT EXISTS) — seguro reaplicar.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.whatsapp_otp_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- NULLABLE de propósito — ver comentário no topo do arquivo. ON DELETE SET
  -- NULL (nunca CASCADE): excluir a conta da dona não deve apagar histórico
  -- de observabilidade de envio, só desvincular (mesmo raciocínio de nunca
  -- perder dado de auditoria por uma exclusão em cascata de outra tabela).
  owner_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Nome do modelo Meta (ex.: 'autenti_') — NUNCA telefone/código/hash/texto
  -- da mensagem.
  template_name text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('sent', 'failed')),
  -- Código numérico devolvido pela Meta (ex.: 131026, 132018) — só quando
  -- outcome='failed' e a Meta devolveu um código; NULL em qualquer outro caso.
  meta_error_code int NULL,
  -- Classificação já calculada por classifySendError (central-send-error-
  -- classifier.ts) — 'permanent'|'temporary'; NULL quando outcome='sent' ou
  -- quando o desfecho bruto foi 'uncertain' (timeout da Meta — nem claramente
  -- permanente nem temporário, mesma convenção de classifySendError).
  error_class text NULL CHECK (error_class IN ('permanent', 'temporary'))
);

CREATE INDEX IF NOT EXISTS whatsapp_otp_send_log_created_at_idx
  ON public.whatsapp_otp_send_log (created_at);

ALTER TABLE public.whatsapp_otp_send_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_otp_send_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_otp_send_log TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
