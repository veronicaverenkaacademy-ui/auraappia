-- Rollback de 20261025210243_whatsapp_central_grants.sql — restaura
-- EXATAMENTE o estado anterior (confirmado por consulta antes de aplicar:
-- zero privilégios pra anon/authenticated nas 5 tabelas, zero EXECUTE pra
-- PUBLIC/anon/authenticated na função). Só desfaz os GRANT que a migration
-- concedeu; os REVOKE da migration eram idempotentes (já não havia nada ali
-- pra desfazer).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

REVOKE SELECT ON public.app_notifications FROM authenticated;
REVOKE UPDATE (read_at) ON public.app_notifications FROM authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
