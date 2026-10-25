-- Rollback de 20261024194007_whatsapp_central_reply_function.sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DROP FUNCTION IF EXISTS public.apply_whatsapp_central_reply(uuid, text, uuid, numeric);

COMMIT;
