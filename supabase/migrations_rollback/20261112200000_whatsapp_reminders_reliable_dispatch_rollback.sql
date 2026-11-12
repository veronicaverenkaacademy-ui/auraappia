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
-- isso fica no arquivo separado, próprio passo de autorização). Reverter
-- as SEÇÕES B/C/D (as únicas que de fato criam objetos deste projeto) já
-- deixa o banco exatamente como estava antes, sem precisar tocar nas
-- extensões.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ---- SEÇÃO D — recuperação de job preso ----
REVOKE ALL ON FUNCTION public.recover_stuck_notification_jobs(int, int) FROM service_role;
DROP FUNCTION IF EXISTS public.recover_stuck_notification_jobs(int, int);

-- ---- SEÇÃO C — histórico de execuções do cron ----
DROP TABLE IF EXISTS public.whatsapp_cron_runs;

-- ---- SEÇÃO B — bloqueio de opt-out ----
DROP TABLE IF EXISTS public.whatsapp_blocked_recipients;

NOTIFY pgrst, 'reload schema';

COMMIT;
