-- Rollback de 20261024191819_whatsapp_central_threads.sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DROP TRIGGER IF EXISTS trg_whatsapp_central_threads_updated_at ON public.whatsapp_central_threads;
DROP TABLE IF EXISTS public.whatsapp_central_threads;

COMMIT;
