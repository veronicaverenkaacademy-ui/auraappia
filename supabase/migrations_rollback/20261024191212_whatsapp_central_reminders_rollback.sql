-- Rollback de 20261024191212_whatsapp_central_reminders.sql
-- Fora de supabase/migrations/ propositalmente (mesmo padrão dos rollbacks
-- anteriores) — SQL de referência para reverter manualmente via
-- query_database/SQL Editor, como conexão privilegiada (postgres/
-- service_role, para aura_system_bypass() evoluir true e os triggers novos
-- não interferirem no próprio rollback).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ---- SEÇÃO E — notificações ----
DROP TRIGGER IF EXISTS trg_app_notifications_protect_fields ON public.app_notifications;
DROP FUNCTION IF EXISTS public.app_notifications_protect_fields();
DROP POLICY IF EXISTS app_notifications_mark_read ON public.app_notifications;
DROP POLICY IF EXISTS app_notifications_select ON public.app_notifications;
DROP TABLE IF EXISTS public.app_notifications;

-- ---- SEÇÃO D — incidentes/freio de emergência ----
DROP TABLE IF EXISTS public.whatsapp_central_incidents;

-- ---- SEÇÃO C — fila de reconciliação de status ----
DROP TABLE IF EXISTS public.whatsapp_status_reconciliation;

-- ---- SEÇÃO B — whatsapp_messages: reverte colunas/CHECKs ao estado anterior ----
ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_status_check;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed'));

ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_error_class_check;
ALTER TABLE public.whatsapp_messages
  DROP COLUMN IF EXISTS error_class,
  DROP COLUMN IF EXISTS error_code,
  DROP COLUMN IF EXISTS template_language,
  DROP COLUMN IF EXISTS template_name;

-- ---- SEÇÃO A — restaura o meta_status exato de antes, a partir do backup ----
-- Confirmar antes de rodar isto: nenhuma correção manual adicional de
-- meta_status deve ter acontecido entre a migration e este rollback (senão
-- o backup está desatualizado e restaurar por ele seria errado).
UPDATE public.automations a
SET meta_status = b.meta_status
FROM aura_private.backup_whatsapp_central_20261024_automations_meta_status b
WHERE a.id = b.automation_id;

-- A tabela de backup fica — nunca apagar evidência de antes/depois sem
-- confirmação explícita separada (mesmo padrão dos backups da Fase 1).

COMMIT;
