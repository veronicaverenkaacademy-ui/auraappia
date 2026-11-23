-- Rollback de 20261123190000_client_otp_codes_cleanup.sql
-- Fora de supabase/migrations/ propositalmente (mesmo padrão dos rollbacks
-- anteriores) — SQL de referência para reverter manualmente via
-- query_database/SQL Editor, como conexão privilegiada (postgres/
-- service_role).
--
-- IMPACTO: remove só a função public.cleanup_old_client_otp_codes. Não
-- apaga nenhuma linha de client_otp_codes (a função em si nunca é chamada
-- por este rollback) e não toca em nenhuma outra tabela/coluna/política.
-- Se o agendamento separado (ver arquivo *_cron_schedule.sql) já tiver sido
-- ligado antes deste rollback, desligue-o PRIMEIRO com
-- `select cron.unschedule('client-otp-codes-cleanup');` — rodar este
-- DROP FUNCTION com o cron ainda apontando pra ela faria o próximo disparo
-- do cron falhar (função inexistente) em vez de simplesmente não fazer
-- nada.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DROP FUNCTION IF EXISTS public.cleanup_old_client_otp_codes(integer);

NOTIFY pgrst, 'reload schema';

COMMIT;
