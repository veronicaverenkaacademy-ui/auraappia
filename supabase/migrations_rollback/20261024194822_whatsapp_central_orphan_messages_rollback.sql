-- Rollback de 20261024194822_whatsapp_central_orphan_messages.sql
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DROP TABLE IF EXISTS public.whatsapp_central_orphan_messages;

COMMIT;
