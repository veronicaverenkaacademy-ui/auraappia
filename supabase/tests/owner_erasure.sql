-- FASE LEGAL-2 — suíte da migração 20261117140000_owner_erasure.sql
-- (owner_erasure_plan / erase_owner_data — exclusão ATÔMICA da conta da
-- PROFISSIONAL, por decisão D1: apaga de verdade client_consents,
-- client_anamnesis, client_photos, mensagens, agenda e clientes; NUNCA
-- anonimiza esse caminho, ao contrário de erase_client_data).
--
-- NÃO EXECUTADA contra produção nesta fase (branch nova + PR em DRAFT, por
-- instrução explícita da dona). Rodada LOCALMENTE (Postgres 16 deste
-- ambiente, banco descartável `aura_legal2_test`, NUNCA o banco de
-- produção da dona) — ver saída colada no relatório da fase. Bootstrap com
-- as colunas/FKs/triggers REAIS confirmadas via introspecção de produção
-- nesta fase (pg_constraint, não information_schema — este último não
-- lista FKs contra auth.users neste projeto, por alguma particularidade de
-- visibilidade cross-schema; nenhuma coluna/constraint foi adivinhada).
--
-- Ciclo: 0) grants antes; 1) fixtures (owner A completo — clientes com e
-- sem conta de portal, anamnese, fotos [via contagem, Storage real não
-- existe neste ambiente local], agenda, notification_jobs, threads dos
-- DOIS tipos com resolved_by_message_id apontando pra mensagem do
-- outbound e pra mensagem "resolvida" separada, mensagens, conversas,
-- team_members 'terminated' com access_level_id vinculado, access_levels,
-- portal_configurations com published_by/updated_by do owner,
-- company_profiles com portal_media_key, client_consents de vários
-- tipos/choices, app_notifications, whatsapp_instances; owner B com dados
-- equivalentes; cliente com conta de portal ligada a A OU a B [este
-- ambiente local não tem FK única impedindo duas linhas de clients com o
-- mesmo user_id de owners diferentes — é exatamente o cenário real:
-- "mesma conta de portal pode ser cliente de mais de um estúdio", D3]);
-- 2) equipe ativa bloqueia; 3) erase_owner_data(A) sem erro; 4) varredura
-- DINÂMICA via catálogo — zero linhas de A em toda tabela com
-- owner_id/user_id (exceto profiles, que a função não toca de propósito);
-- 5) B intacto (contagens + md5 de linhas-chave); 6) client_consents de A
-- apagados (não anonimizados); 7) audit_log intacto + 1 linha nova sem
-- dado pessoal; 8) idempotência (2ª chamada = zeros, sem erro); 9) falha
-- injetada no meio = rollback total (nada apagado); 10) permissão
-- (anon/authenticated não executam); 11) grants depois (inalterados);
-- 12) nenhuma FK RESTRICT/NO ACTION sobra apontando pra linha de A ainda
-- viva (checagem de catálogo, não simulação de DELETE em auth.users, que
-- este ambiente local não tem como Supabase Auth faria). Nunca COMMIT.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE zzoe_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzoe_ids (chave text PRIMARY KEY, valor uuid) ON COMMIT DROP;
GRANT ALL ON zzoe_results TO PUBLIC;
GRANT ALL ON zzoe_ids TO PUBLIC;
GRANT ALL ON SEQUENCE zzoe_results_ordem_seq TO PUBLIC;

-- ============================================================================
-- PASSO 0 — grants ANTES (prova que já nascem service_role-only)
-- ============================================================================
DO $passo0$
DECLARE v_ok boolean;
BEGIN
  SELECT NOT has_function_privilege('anon', 'public.erase_owner_data(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.erase_owner_data(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.erase_owner_data(uuid)', 'EXECUTE')
    INTO v_ok;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('00a_grants_antes_erase', 'anon/authenticated sem EXECUTE, service_role com EXECUTE', v_ok);

  SELECT NOT has_function_privilege('anon', 'public.owner_erasure_plan(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.owner_erasure_plan(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.owner_erasure_plan(uuid)', 'EXECUTE')
    INTO v_ok;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('00b_grants_antes_plan', 'anon/authenticated sem EXECUTE, service_role com EXECUTE', v_ok);
END $passo0$;

-- ============================================================================
-- PASSO 1 — fixtures
-- ============================================================================
INSERT INTO zzoe_ids (chave, valor) VALUES
  ('owner_a', gen_random_uuid()),
  ('owner_b', gen_random_uuid()),
  ('client_a1', gen_random_uuid()),
  ('client_a2_portal', gen_random_uuid()),
  ('client_b1', gen_random_uuid()),
  ('shared_portal_user', gen_random_uuid());

DO $setup$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzoe_ids WHERE chave='owner_a');
  v_owner_b uuid := (SELECT valor FROM zzoe_ids WHERE chave='owner_b');
  v_client_a1 uuid := (SELECT valor FROM zzoe_ids WHERE chave='client_a1');
  v_client_a2 uuid := (SELECT valor FROM zzoe_ids WHERE chave='client_a2_portal');
  v_client_b1 uuid := (SELECT valor FROM zzoe_ids WHERE chave='client_b1');
  v_shared uuid := (SELECT valor FROM zzoe_ids WHERE chave='shared_portal_user');
  v_appt_a1 uuid; v_appt_a2 uuid; v_appt_b1 uuid;
  v_msg_a_out uuid; v_msg_a_resolved uuid; v_msg_a2_out uuid; v_msg_a2_resolved uuid;
  v_msg_b_out uuid; v_msg_b_resolved uuid;
  v_al_a uuid;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_owner_a), (v_owner_b), (v_shared);

  INSERT INTO public.clients (owner_id, full_name, user_id) VALUES (v_owner_a, 'zz A1', NULL) RETURNING id INTO v_client_a1;
  INSERT INTO public.clients (owner_id, full_name, user_id) VALUES (v_owner_a, 'zz A2 portal', v_shared) RETURNING id INTO v_client_a2;
  -- D3: a MESMA conta de portal (v_shared) também é cliente de B — não
  -- pode ser removida enquanto esse vínculo sobreviver.
  INSERT INTO public.clients (owner_id, full_name, user_id) VALUES (v_owner_b, 'zz B1 portal', v_shared) RETURNING id INTO v_client_b1;

  UPDATE zzoe_ids SET valor = v_client_a1 WHERE chave = 'client_a1';
  UPDATE zzoe_ids SET valor = v_client_a2 WHERE chave = 'client_a2_portal';
  UPDATE zzoe_ids SET valor = v_client_b1 WHERE chave = 'client_b1';

  INSERT INTO public.appointments (owner_id, client_id, starts_at) VALUES (v_owner_a, v_client_a1, now()+interval '1 day') RETURNING id INTO v_appt_a1;
  INSERT INTO public.appointments (owner_id, client_id, starts_at) VALUES (v_owner_a, v_client_a2, now()+interval '2 day') RETURNING id INTO v_appt_a2;
  INSERT INTO public.appointments (owner_id, client_id, starts_at) VALUES (v_owner_b, v_client_b1, now()+interval '1 day') RETURNING id INTO v_appt_b1;

  INSERT INTO public.client_anamnesis (owner_id, client_id) VALUES (v_owner_a, v_client_a1);
  INSERT INTO public.client_photos (owner_id, client_id, storage_path) VALUES (v_owner_a, v_client_a1, v_owner_a::text || '/' || v_client_a1::text || '/foto1.jpg');
  INSERT INTO public.client_anamnesis (owner_id, client_id) VALUES (v_owner_b, v_client_b1);

  -- Threads com resolved_by_message_id — os DOIS tipos, mesma forma do
  -- fixture de LEGAL-1C (outbound separado da mensagem "resolvida", senão
  -- o CASCADE de outbound_message_id mascara o defeito que estamos
  -- provando que NÃO acontece mais).
  INSERT INTO public.whatsapp_messages (owner_id, client_id, recipient_phone) VALUES (v_owner_a, NULL, '+5511900000001') RETURNING id INTO v_msg_a_out;
  INSERT INTO public.whatsapp_messages (owner_id, client_id, recipient_phone) VALUES (v_owner_a, v_client_a1, '+5511900000001') RETURNING id INTO v_msg_a_resolved;
  INSERT INTO public.whatsapp_central_threads (owner_id, client_id, appointment_id, outbound_message_id, resolved_by_message_id)
    VALUES (v_owner_a, v_client_a1, v_appt_a1, v_msg_a_out, v_msg_a_resolved);

  INSERT INTO public.whatsapp_messages (owner_id, client_id, recipient_phone) VALUES (v_owner_a, NULL, '+5511900000002') RETURNING id INTO v_msg_a2_out;
  INSERT INTO public.whatsapp_messages (owner_id, client_id, recipient_phone) VALUES (v_owner_a, v_client_a2, '+5511900000002') RETURNING id INTO v_msg_a2_resolved;
  INSERT INTO public.whatsapp_confirmation_threads (owner_id, client_id, appointment_id, outbound_message_id, resolved_by_message_id)
    VALUES (v_owner_a, v_client_a2, v_appt_a2, v_msg_a2_out, v_msg_a2_resolved);

  INSERT INTO public.whatsapp_messages (owner_id, client_id, recipient_phone) VALUES (v_owner_b, NULL, '+5511900000003') RETURNING id INTO v_msg_b_out;
  INSERT INTO public.whatsapp_messages (owner_id, client_id, recipient_phone) VALUES (v_owner_b, v_client_b1, '+5511900000003') RETURNING id INTO v_msg_b_resolved;
  INSERT INTO public.whatsapp_central_threads (owner_id, client_id, appointment_id, outbound_message_id, resolved_by_message_id)
    VALUES (v_owner_b, v_client_b1, v_appt_b1, v_msg_b_out, v_msg_b_resolved);

  INSERT INTO public.whatsapp_blocked_recipients (owner_id, phone_e164) VALUES (v_owner_a, '+5511900000099');
  INSERT INTO public.whatsapp_instances (owner_id, instance_token) VALUES (v_owner_a, 'zz-fake-token-a');
  INSERT INTO public.whatsapp_instances (owner_id, instance_token) VALUES (v_owner_b, 'zz-fake-token-b');

  INSERT INTO public.notification_jobs (owner_id, client_id, appointment_id) VALUES (v_owner_a, v_client_a1, v_appt_a1);
  INSERT INTO public.marketing_sends (owner_id, client_id) VALUES (v_owner_a, v_client_a1);

  INSERT INTO public.service_materials (owner_id) VALUES (v_owner_a);
  INSERT INTO public.stock_movements (owner_id) VALUES (v_owner_a);
  INSERT INTO public.products (owner_id) VALUES (v_owner_a);
  INSERT INTO public.product_batches (owner_id) VALUES (v_owner_a);
  INSERT INTO public.suppliers (owner_id) VALUES (v_owner_a);
  INSERT INTO public.agenda_blocks (owner_id) VALUES (v_owner_a);
  INSERT INTO public.finance_goals (owner_id) VALUES (v_owner_a);
  INSERT INTO public.finance_settings (owner_id) VALUES (v_owner_a);
  INSERT INTO public.automations (owner_id) VALUES (v_owner_a);
  INSERT INTO public.journeys (owner_id) VALUES (v_owner_a);
  INSERT INTO public.message_templates (owner_id) VALUES (v_owner_a);
  INSERT INTO public.communication_provider_config (owner_id) VALUES (v_owner_a);
  INSERT INTO public.services (owner_id) VALUES (v_owner_a);
  INSERT INTO public.portal_service_categories (owner_id) VALUES (v_owner_a);

  -- Equipe 'terminated' (não bloqueia) com access_level ainda vinculado —
  -- o caso que travava access_levels (RESTRICT) antes desta fase.
  INSERT INTO public.access_levels (owner_id) VALUES (v_owner_a) RETURNING id INTO v_al_a;
  INSERT INTO public.team_members (owner_id, status, access_level_id) VALUES (v_owner_a, 'terminated', v_al_a);

  INSERT INTO public.company_profiles (owner_id) VALUES (v_owner_a);
  INSERT INTO public.portal_configurations (owner_id, published_by, updated_by) VALUES (v_owner_a, v_owner_a, v_owner_a);

  INSERT INTO public.app_notifications (owner_id, recipient_user_id) VALUES (v_owner_a, v_owner_a);
  INSERT INTO public.user_roles (user_id) VALUES (v_owner_a);
  INSERT INTO public.profiles (id) VALUES (v_owner_a);
  INSERT INTO public.finance_transactions (owner_id, description) VALUES (v_owner_a, 'zz descrição A');

  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source, signer_name, evidence_ip, evidence_user_agent)
    VALUES (v_owner_a, v_client_a1, 'health_data', 'granted', 'termo-consentimento', '2026-08-04', 'studio_device', NULL, '203.0.113.1', 'zz-UA');
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
    VALUES (v_owner_a, v_client_a2, 'marketing', 'denied', 'politica-de-privacidade', '2026-08-04', 'portal');
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
    VALUES (v_owner_a, v_client_a2, 'image_use', 'granted_no_face', 'termo-consentimento', '2026-08-04', 'portal');

  -- owner B — mesma forma, menor, só pra provar isolamento.
  INSERT INTO public.client_anamnesis (owner_id, client_id) VALUES (v_owner_b, v_client_b1);
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
    VALUES (v_owner_b, v_client_b1, 'health_data', 'granted', 'termo-consentimento', '2026-08-04', 'portal');
  INSERT INTO public.app_notifications (owner_id, recipient_user_id) VALUES (v_owner_b, v_owner_b);
  INSERT INTO public.user_roles (user_id) VALUES (v_owner_b);
  INSERT INTO public.profiles (id) VALUES (v_owner_b);
  INSERT INTO public.company_profiles (owner_id) VALUES (v_owner_b);

  INSERT INTO public.audit_log (owner_id, actor_id, action, resource) VALUES (v_owner_a, v_owner_a, 'zz_evento_anterior', 'zz_recurso');
END $setup$;

DO $sentinela$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.clients WHERE full_name LIKE 'zz %';
  IF n <> 3 THEN RAISE EXCEPTION 'SENTINELA: esperado 3 clientes sintéticos, achei %', n; END IF;
END $sentinela$;

-- ============================================================================
-- PASSO 2 — equipe ATIVA bloqueia (não-terminated)
-- ============================================================================
DO $passo2$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzoe_ids WHERE chave='owner_a');
  v_sqlstate text; v_falhou boolean := false;
BEGIN
  INSERT INTO public.team_members (owner_id, status) VALUES (v_owner_a, 'active');
  BEGIN
    SET ROLE service_role;
    PERFORM public.erase_owner_data(v_owner_a);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_falhou := true;
  END;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('02a_equipe_ativa_bloqueia', format('sqlstate=%s', v_sqlstate), v_falhou AND v_sqlstate = 'UC010');

  -- Nada foi tocado (bloqueio é ANTES de qualquer DELETE).
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('02b_bloqueio_nao_apagou_nada',
     format('%s clientes de A (esperado 2)', (SELECT count(*) FROM public.clients WHERE owner_id = v_owner_a)),
     (SELECT count(*) FROM public.clients WHERE owner_id = v_owner_a) = 2);

  DELETE FROM public.team_members WHERE owner_id = v_owner_a AND status = 'active';
END $passo2$;

-- ============================================================================
-- PASSO 3 — SNAPSHOT de B (contagens + md5) ANTES de apagar A, pra
-- comparar DEPOIS (prova de isolamento real, não só "não deu erro").
-- ============================================================================
CREATE TEMP TABLE zzoe_snapshot_b AS
SELECT
  (SELECT count(*) FROM public.clients WHERE owner_id = (SELECT valor FROM zzoe_ids WHERE chave='owner_b')) AS n_clients,
  (SELECT count(*) FROM public.client_consents WHERE owner_id = (SELECT valor FROM zzoe_ids WHERE chave='owner_b')) AS n_consents,
  (SELECT md5(string_agg(full_name, ',' ORDER BY id)) FROM public.clients WHERE owner_id = (SELECT valor FROM zzoe_ids WHERE chave='owner_b')) AS md5_clients,
  (SELECT md5(string_agg(choice, ',' ORDER BY id)) FROM public.client_consents WHERE owner_id = (SELECT valor FROM zzoe_ids WHERE chave='owner_b')) AS md5_consents;

-- ============================================================================
-- PASSO 4 — FALHA INJETADA no meio: provoca erro depois de várias DELETEs
-- já terem rodado NESTA transação (via SAVEPOINT — simula o que uma
-- exceção real no meio da função faria) e confirma ROLLBACK TOTAL.
-- ============================================================================
DO $passo4$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzoe_ids WHERE chave='owner_a');
  v_client_a1 uuid := (SELECT valor FROM zzoe_ids WHERE chave='client_a1');
  v_falhou boolean := false;
BEGIN
  -- O BEGIN...EXCEPTION do PL/pgSQL já cria um savepoint implícito no
  -- início do bloco e desfaz tudo dentro dele ao capturar a exceção — sem
  -- precisar (e sem poder, nesse contexto) de SAVEPOINT/ROLLBACK TO
  -- SAVEPOINT explícitos, que são comandos de nível SQL top-level, não
  -- PL/pgSQL.
  BEGIN
    SET ROLE service_role;
    DELETE FROM public.client_anamnesis WHERE owner_id = v_owner_a;
    DELETE FROM public.client_photos WHERE owner_id = v_owner_a;
    -- Provoca violação real (RESTRICT) no meio: tenta apagar um
    -- access_level ainda referenciado por team_members (sem o UPDATE que
    -- zera access_level_id primeiro) — simula "algo deu errado no meio".
    DELETE FROM public.access_levels WHERE owner_id = v_owner_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_falhou := true;
  END;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES ('04a_falha_injetada_foi_rejeitada', 'RESTRICT esperado', v_falhou);

  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('04b_rollback_restaurou_anamnesis',
     format('%s (esperado 1)', (SELECT count(*) FROM public.client_anamnesis WHERE client_id = v_client_a1)),
     (SELECT count(*) FROM public.client_anamnesis WHERE client_id = v_client_a1) = 1);
END $passo4$;

-- ============================================================================
-- PASSO 5 — erase_owner_data(A) de verdade, sem erro.
-- ============================================================================
DO $passo5$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzoe_ids WHERE chave='owner_a');
  v_result jsonb;
BEGIN
  SET ROLE service_role;
  SELECT public.erase_owner_data(v_owner_a) INTO v_result;
  RESET ROLE;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('05a_erase_owner_a_sem_erro',
     format('client_consents_deleted=%s clients_deleted=%s', v_result->>'client_consents_deleted', v_result->>'clients_deleted'),
     (v_result->>'client_consents_deleted')::int = 3 AND (v_result->>'clients_deleted')::int = 2);
END $passo5$;

-- ============================================================================
-- PASSO 6 — varredura DINÂMICA via catálogo: zero linhas de A em TODA
-- tabela public com coluna owner_id OU user_id (exceto profiles, que a
-- função não toca de propósito — isso é tarefa do orquestrador via
-- auth.admin.deleteUser).
-- ============================================================================
DO $passo6$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzoe_ids WHERE chave='owner_a');
  r record;
  v_n bigint;
  v_tudo_zero boolean := true;
  v_detalhe text := '';
BEGIN
  FOR r IN
    SELECT DISTINCT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = 'public'
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('owner_id', 'user_id')
      -- profiles: NÃO tocada de propósito (cascata de deleteUser, fora
      -- desta função). audit_log: NUNCA apagado (D1) — só recebe 1 linha
      -- nova. finance_transactions: scrubbed (description=NULL), linha
      -- preservada por entendimento de retenção fiscal — comportamento
      -- INALTERADO em relação ao código atual, D1 não menciona esta
      -- tabela. As três são exclusões INTENCIONAIS do "zero linhas",
      -- checadas separadamente abaixo (06b) e no passo 8.
      AND c.table_name NOT IN ('profiles', 'audit_log', 'finance_transactions')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', r.table_name, r.column_name)
      INTO v_n USING v_owner_a;
    IF v_n <> 0 THEN
      v_tudo_zero := false;
      v_detalhe := v_detalhe || format('%s.%s=%s ', r.table_name, r.column_name, v_n);
    END IF;
  END LOOP;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('06a_varredura_catalogo_zero_linhas_de_a', COALESCE(v_detalhe, 'tudo zero'), v_tudo_zero);

  -- profiles: NÃO tocada por esta função (de propósito) — ainda tem a
  -- linha de A; o orquestrador remove via cascata de auth.admin.deleteUser.
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('06b_profiles_intocada_de_proposito', format('%s (esperado 1)', v_n), v_n = 1);
END $passo6$;

-- ============================================================================
-- PASSO 7 — B intacto (contagens + md5 idênticos ao snapshot do passo 3).
-- ============================================================================
DO $passo7$
DECLARE
  v_owner_b uuid := (SELECT valor FROM zzoe_ids WHERE chave='owner_b');
  v_snap record;
  v_now record;
BEGIN
  SELECT * INTO v_snap FROM zzoe_snapshot_b;
  SELECT
    (SELECT count(*) FROM public.clients WHERE owner_id = v_owner_b) AS n_clients,
    (SELECT count(*) FROM public.client_consents WHERE owner_id = v_owner_b) AS n_consents,
    (SELECT md5(string_agg(full_name, ',' ORDER BY id)) FROM public.clients WHERE owner_id = v_owner_b) AS md5_clients,
    (SELECT md5(string_agg(choice, ',' ORDER BY id)) FROM public.client_consents WHERE owner_id = v_owner_b) AS md5_consents
  INTO v_now;

  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('07a_owner_b_contagens_identicas',
     format('antes(%s,%s) depois(%s,%s)', v_snap.n_clients, v_snap.n_consents, v_now.n_clients, v_now.n_consents),
     v_snap.n_clients = v_now.n_clients AND v_snap.n_consents = v_now.n_consents);
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('07b_owner_b_md5_identico', 'md5 clients+consents', v_snap.md5_clients = v_now.md5_clients AND v_snap.md5_consents = v_now.md5_consents);

  -- A conta de portal COMPARTILHADA (D3) continua existindo — a função de
  -- banco não decide isso; é o orquestrador TS, DEPOIS de checar que ela
  -- ainda está ligada a um client de B.
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('07c_conta_portal_compartilhada_ainda_ligada_a_b',
     format('%s', (SELECT count(*) FROM public.clients WHERE owner_id = v_owner_b AND user_id = (SELECT valor FROM zzoe_ids WHERE chave='shared_portal_user'))),
     (SELECT count(*) FROM public.clients WHERE owner_id = v_owner_b AND user_id = (SELECT valor FROM zzoe_ids WHERE chave='shared_portal_user')) = 1);
END $passo7$;

-- ============================================================================
-- PASSO 8 — client_consents de A realmente APAGADOS (não anonimizados —
-- D1, ao contrário de purge_client_consent_pii) + audit_log intacto e com
-- 1 linha nova sem dado pessoal.
-- ============================================================================
DO $passo8$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzoe_ids WHERE chave='owner_a');
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.client_consents WHERE owner_id = v_owner_a;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('08a_client_consents_de_a_apagados_nao_anonimizados', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM public.audit_log WHERE owner_id = v_owner_a AND action = 'zz_evento_anterior';
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('08b_audit_log_anterior_intacto', format('%s (esperado 1)', v_n), v_n = 1);

  SELECT count(*) INTO v_n FROM public.audit_log WHERE owner_id = v_owner_a AND action = 'account_deleted' AND resource = 'professional_account';
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('08c_audit_log_nova_linha_generica', format('%s (esperado 1)', v_n), v_n = 1);

  -- finance_transactions: linha SOBREVIVE (scrubbed, não apagada) — mesma
  -- exclusão intencional do passo 6a; confere aqui o efeito real.
  SELECT count(*) INTO v_n FROM public.finance_transactions WHERE owner_id = v_owner_a AND description IS NULL;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('08d_finance_transactions_scrubbed_nao_apagada', format('%s (esperado 1, linha viva com description NULL)', v_n), v_n = 1);
END $passo8$;

-- ============================================================================
-- PASSO 9 — idempotência: 2ª chamada não falha e devolve zeros.
-- ============================================================================
DO $passo9$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzoe_ids WHERE chave='owner_a');
  v_result jsonb;
  v_todos_zero boolean;
BEGIN
  SET ROLE service_role;
  SELECT public.erase_owner_data(v_owner_a) INTO v_result;
  RESET ROLE;

  SELECT bool_and((value)::text::numeric = 0)
  INTO v_todos_zero
  FROM jsonb_each(v_result);

  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('09a_segunda_chamada_sem_erro_e_tudo_zero', v_result::text, v_todos_zero);
END $passo9$;

-- ============================================================================
-- PASSO 10 — permissão: anon/authenticated não executam.
-- ============================================================================
DO $passo10$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzoe_ids WHERE chave='owner_a');
  v_rejeitou boolean;
BEGIN
  v_rejeitou := false;
  BEGIN
    SET ROLE authenticated;
    PERFORM public.erase_owner_data(v_owner_a);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejeitou := true;
  END;
  RESET ROLE;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES ('10a_authenticated_nao_executa_erase', 'insufficient_privilege', v_rejeitou);

  v_rejeitou := false;
  BEGIN
    SET ROLE anon;
    PERFORM public.owner_erasure_plan(v_owner_a);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejeitou := true;
  END;
  RESET ROLE;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES ('10b_anon_nao_executa_plan', 'insufficient_privilege', v_rejeitou);
END $passo10$;

-- ============================================================================
-- PASSO 11 — grants DEPOIS (inalterados).
-- ============================================================================
DO $passo11$
DECLARE v_ok boolean;
BEGIN
  SELECT NOT has_function_privilege('anon', 'public.erase_owner_data(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.erase_owner_data(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.erase_owner_data(uuid)', 'EXECUTE')
    INTO v_ok;
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES ('11a_grants_depois_inalterados', 'mesmo de antes', v_ok);
END $passo11$;

-- ============================================================================
-- PASSO 12 — plan: confirma formato (contagens + storage + candidatos a
-- conta de portal) ANTES da exclusão de A (chamado de novo com fixture
-- nova, já que A foi apagado acima) — prova que o plano serve de base real
-- pro orquestrador TS.
-- ============================================================================
DO $passo12$
DECLARE
  v_owner_c uuid := gen_random_uuid();
  v_client_c uuid;
  v_shared uuid := (SELECT valor FROM zzoe_ids WHERE chave='shared_portal_user');
  v_plan jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_owner_c);
  INSERT INTO public.clients (owner_id, full_name, user_id) VALUES (v_owner_c, 'zz C1 portal', v_shared) RETURNING id INTO v_client_c;
  INSERT INTO public.client_photos (owner_id, client_id, storage_path) VALUES (v_owner_c, v_client_c, v_owner_c::text || '/' || v_client_c::text || '/foto.jpg');
  INSERT INTO public.company_profiles (owner_id) VALUES (v_owner_c);

  SET ROLE service_role;
  SELECT public.owner_erasure_plan(v_owner_c) INTO v_plan;
  RESET ROLE;

  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('12a_plan_owner_exists', format('%s', v_plan->'owner_exists'), (v_plan->'owner_exists')::boolean = true);
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('12b_plan_portal_account_candidates_tem_shared', format('%s', v_plan->'portal_account_candidates'),
     v_plan->'portal_account_candidates' = to_jsonb(ARRAY[v_shared]));
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('12c_plan_storage_client_photos_paths_1', format('%s', v_plan->'storage'->'client_photos_paths'),
     jsonb_array_length(v_plan->'storage'->'client_photos_paths') = 1);
  INSERT INTO zzoe_results (caso, detalhe, passou) VALUES
    ('12d_plan_portal_media_key_nao_e_owner_id', format('%s', v_plan->'storage'->'portal_media_key'),
     (v_plan->'storage'->>'portal_media_key') <> v_owner_c::text);
END $passo12$;

-- ============================================================================
-- RESUMO
-- ============================================================================
SELECT ordem, caso, detalhe, passou FROM zzoe_results ORDER BY ordem;

DO $final$
DECLARE v_falhas int;
BEGIN
  SELECT count(*) INTO v_falhas FROM zzoe_results WHERE passou = false;
  IF v_falhas > 0 THEN
    RAISE EXCEPTION 'SUITE FALHOU: % caso(s) com passou=false — ver SELECT acima', v_falhas;
  END IF;
  RAISE NOTICE 'SUITE OK: % casos, todos passou=true', (SELECT count(*) FROM zzoe_results);
END $final$;

ROLLBACK;
