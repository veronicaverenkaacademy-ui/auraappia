-- Rollback de 20261114120000_whatsapp_otp_send_log.sql
-- Fora de supabase/migrations/ propositalmente (mesmo padrão dos rollbacks
-- anteriores) — SQL de referência para reverter manualmente via
-- query_database/SQL Editor, como conexão privilegiada (postgres/
-- service_role).
--
-- IMPACTO (descrito explicitamente, como pedido pela dona): este rollback
-- faz DROP TABLE de public.whatsapp_otp_send_log — TODO o histórico de
-- envios de OTP já acumulado (quantos 'sent'/'failed', com que código de
-- erro, de qual modelo) é perdido para sempre, sem possibilidade de
-- recuperação. Diferente de whatsapp_blocked_recipients (que guarda um
-- bloqueio de opt-out real, cuja perda teria uma consequência funcional —
-- reenviar para quem pediu pra parar), a tabela aqui é só OBSERVABILIDADE
-- (nenhum fluxo de login/OTP lê dela para decidir nada — sendOtpViaMeta
-- grava nela em melhor esforço, nunca lê) — perder essas linhas não muda o
-- comportamento do produto, só apaga o histórico de diagnóstico. Ainda
-- assim, se este rollback for aplicado em produção depois de a tabela já
-- ter acumulado dados reais que a dona ainda não tenha consultado/exportado,
-- esse histórico específico (desde a aplicação até o rollback) se perde —
-- por isso: só aplicar este rollback depois de confirmar com a dona que
-- nenhum histórico desse período precisa ser preservado (ou exportá-lo
-- antes, com um SELECT simples).
--
-- Nenhuma outra tabela/coluna/política/extensão pré-existente é tocada —
-- a migration original só criou esta tabela, então o rollback só a remove.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DROP TABLE IF EXISTS public.whatsapp_otp_send_log;

NOTIFY pgrst, 'reload schema';

COMMIT;
