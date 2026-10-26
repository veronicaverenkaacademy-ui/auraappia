-- WhatsApp central: corrige o GRANT ausente em app_notifications (achado na
-- auditoria de testes da etapa anterior) e TORNA EXPLÍCITO, pra nunca mais
-- depender de "já está assim por acidente", que authenticated/anon não têm
-- nenhum privilégio nas outras 4 tabelas (uso só do servidor) nem EXECUTE na
-- função de ações. Só GRANT/REVOKE de privilégio — nenhuma política RLS,
-- coluna, dado ou migration anterior é alterada.
--
-- ESTADO ANTES (confirmado por consulta em information_schema.role_table_grants
-- e information_schema.routine_privileges em 2026-10-25, ver
-- supabase/tests/whatsapp_central_notifications_permissions.sql para a
-- consulta exata): anon e authenticated tinham ZERO privilégios (tabela e
-- coluna) nas 5 tabelas (app_notifications, whatsapp_central_threads,
-- whatsapp_central_incidents, whatsapp_status_reconciliation,
-- whatsapp_central_orphan_messages) e ZERO EXECUTE na função
-- apply_whatsapp_central_reply (só postgres/sandbox_exec/service_role tinham).
-- Essa é a linha de base que o rollback restaura.
--
-- CAUSA (lida na migration 20261024191212_whatsapp_central_reminders.sql,
-- seção E): app_notifications fez `REVOKE ALL ... FROM anon, authenticated`
-- seguido só de `GRANT ALL ... TO service_role` — nunca um GRANT seletivo de
-- volta pra authenticated, apesar das políticas RLS (app_notifications_select/
-- app_notifications_mark_read, FOR ... TO authenticated) terem sido escritas
-- pressupondo que authenticated conseguiria alcançar a tabela. RLS restringe
-- LINHAS; sem o GRANT de base, a consulta nem chega a ser avaliada pela RLS
-- (falha antes, com 42501).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ===== app_notifications: privilégio mínimo que a tela de avisos usa =====
-- SELECT de tabela inteira (as políticas RLS leem owner_id/recipient_user_id
-- pra decidir visibilidade, mesmo esses dois nunca aparecendo no SELECT
-- explícito do código — Postgres exige privilégio de SELECT na coluna pra
-- avaliar a USING da política, não só nas colunas realmente projetadas).
GRANT SELECT ON public.app_notifications TO authenticated;
-- Limpa qualquer UPDATE/INSERT/DELETE de tabela inteira que authenticated
-- pudesse ter (idempotente — hoje não tem nenhum) antes de conceder o
-- UPDATE estreito abaixo, pra nunca acumular um privilégio mais amplo por
-- engano numa reaplicação futura.
REVOKE INSERT, DELETE, UPDATE ON public.app_notifications FROM authenticated;
-- UPDATE só na coluna read_at (a ÚNICA que a tela altera, markNotificationRead
-- em src/lib/notifications.functions.ts) — qualquer tentativa de alterar
-- title/body/kind/owner_id/recipient_user_id/appointment_id/dedupe_key falha
-- por privilégio de coluna (42501), antes mesmo do trigger
-- trg_app_notifications_protect_fields entrar em ação (dupla trava).
GRANT UPDATE (read_at) ON public.app_notifications TO authenticated;
-- Explícito (já era assim, mas documentado em vez de implícito): nada pra anon.
REVOKE ALL ON public.app_notifications FROM anon;

-- ===== as outras 4 tabelas: reafirma explicitamente "nada pra anon/authenticated" =====
-- Já estava assim (confirmado no diagnóstico) — repetir o REVOKE é
-- idempotente e garante que isso nunca dependa de um acidente de default
-- ACL (que por padrão dá anon/authenticated=tudo em tabela nova do schema
-- public, ver pg_default_acl).
REVOKE ALL ON public.whatsapp_central_threads FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_central_incidents FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_status_reconciliation FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_central_orphan_messages FROM anon, authenticated;

-- ===== função de ações: reafirma "nunca PUBLIC/anon/authenticated" =====
REVOKE ALL ON FUNCTION public.apply_whatsapp_central_reply(uuid, text, uuid, numeric) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
