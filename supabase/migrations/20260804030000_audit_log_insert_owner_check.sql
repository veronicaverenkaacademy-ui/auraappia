-- audit_insert_authenticated permitia gravar audit_log com WITH CHECK (auth.uid() IS
-- NOT NULL) — só exigia que alguém estivesse logado, sem comparar owner_id com
-- auth.uid(). Qualquer usuário autenticado podia inserir um log se passando por outro
-- dono/profissional (owner_id arbitrário).
--
-- Não afeta os writers reais de hoje: os dois inserts em audit_log (em
-- src/lib/team.functions.ts) usam supabaseAdmin (service_role), que tem
-- rolbypassrls = true — RLS não se aplica a eles independente da policy. O único
-- writer sujeito a RLS é logAudit() (src/lib/team.ts), hoje não chamada em lugar
-- nenhum do app, que já define owner_id como o próprio auth.uid() do chamador — a
-- policy mais estrita não quebra o uso futuro correto dela.
DROP POLICY IF EXISTS audit_insert_authenticated ON public.audit_log;

CREATE POLICY audit_insert_own ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
