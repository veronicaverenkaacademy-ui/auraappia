-- Rollback de 20261112200000_whatsapp_reminders_reliable_dispatch.sql
-- Fora de supabase/migrations/ propositalmente (mesmo padrão dos rollbacks
-- anteriores) — SQL de referência para reverter manualmente via
-- query_database/SQL Editor, como conexão privilegiada (postgres/
-- service_role).
--
-- NÃO desinstala pg_cron/pg_net (SEÇÃO A) — DROP EXTENSION é destrutivo por
-- natureza (removeria qualquer outro objeto que algum dia dependa delas, e
-- cron.job/net.http_request_queue são tabelas de sistema dessas extensões,
-- não deste projeto) e, mais importante, instalar a extensão nunca ligou
-- nada por si só (nenhum cron.schedule() foi criado por esta migration —
-- isso fica no arquivo separado, próprio passo de autorização).
--
-- AJUSTE (revisão da dona, 13/11/2026) — NÃO apaga whatsapp_blocked_recipients
-- (SEÇÃO B) nem suas linhas: essa tabela guarda pedidos de PARAR/opt-out de
-- clientes de verdade. Se o rollback apagasse a tabela, qualquer bloqueio
-- já registrado seria perdido e o próximo lembrete voltaria a ser enviado
-- para quem pediu para parar de receber — o oposto do que o opt-out existe
-- para garantir, e um risco real mesmo que o rollback só rode pouco depois
-- da aplicação (um cliente pode pedir PARAR nesse intervalo). Reverter as
-- SEÇÕES C/D/E (que não guardam nenhum dado de cliente, só histórico de
-- execução/config técnica) já é suficiente para desfazer tudo que esta
-- migration criou/alterou, EXCETO a SEÇÃO B, que fica de pé de propósito —
-- a suíte de testes (PASSO 7/8) prova que as linhas de bloqueio sobrevivem
-- a este rollback.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ---- SEÇÃO E — recuperação de job preso ----
REVOKE ALL ON FUNCTION public.recover_stuck_notification_jobs(int, int) FROM service_role;
DROP FUNCTION IF EXISTS public.recover_stuck_notification_jobs(int, int);

-- ---- SEÇÃO D — reverte o CHECK de whatsapp_messages.status ao estado
-- anterior exato (confirmado via pg_get_constraintdef em 12/11/2026, antes
-- de qualquer alteração desta fase): os MESMOS 6 valores, sem
-- 'incerto_expirado'. Nenhuma linha com esse status deveria existir se o
-- rollback rodar logo depois da aplicação (nunca dentro de 24h) — mas, se
-- existir por qualquer motivo, o DROP+ADD abaixo falharia com "constraint
-- violated" em vez de silenciosamente perder dado, o que é o comportamento
-- certo: pare e investigue antes de insistir.
ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_status_check;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'uncertain'));

-- ---- SEÇÃO C — histórico de execuções do cron ----
DROP TABLE IF EXISTS public.whatsapp_cron_runs;

-- ---- SEÇÃO B — bloqueio de opt-out ----
-- PROPOSITALMENTE NÃO REVERTIDA (ajuste 13/11/2026, ver comentário no topo
-- do arquivo): whatsapp_blocked_recipients e suas linhas continuam de pé.
-- Nenhum DROP/DELETE aqui — não é um esquecimento, é a regra.

NOTIFY pgrst, 'reload schema';

COMMIT;
