-- Permissões de app_notifications e das outras 4 tabelas/função do
-- WhatsApp central. Padrão ROLLBACK (como marketing_permissions.sql,
-- versão simplificada). Fixtures sintéticas com prefixo ZZFX_ e e-mail
-- zz-fixture-...@invalid.test (sentinela), nada persiste.
--
-- HISTÓRICO: a primeira versão deste arquivo (auditoria de testes da etapa
-- anterior) encontrou authenticated/anon SEM NENHUM grant em
-- app_notifications — corrigido pela migration
-- 20261025210243_whatsapp_central_grants.sql (GRANT SELECT de tabela
-- inteira + UPDATE só na coluna read_at, pra authenticated). Esta versão
-- testa o estado JÁ CORRIGIDO (sem precisar mais do truque de GRANT
-- temporário dentro da transação) e amplia a cobertura: privilégio de
-- coluna no UPDATE, INSERT/DELETE negados, e as outras 4 tabelas + função
-- confirmadas inacessíveis a authenticated/anon.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE zzfx_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO zzfx_ids (k, v) VALUES
  ('owner_a', gen_random_uuid()), ('prof_a', gen_random_uuid()),
  ('outra_prof_a', gen_random_uuid()), ('owner_b', gen_random_uuid());

DO $setup$
DECLARE
  v_owner_a uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_al_sem_agenda uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  SELECT u.v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'zz-fixture-'||u.v||'@invalid.test', '', now(), now(), now(), '{}',
         CASE WHEN u.k IN ('owner_a','owner_b') THEN '{"user_type":"professional"}'::jsonb ELSE '{}'::jsonb END
  FROM zzfx_ids u WHERE u.k IN ('owner_a','prof_a','outra_prof_a','owner_b');

  INSERT INTO public.access_levels (owner_id, name) VALUES (v_owner_a, 'ZZFX_SemAgenda') RETURNING id INTO v_al_sem_agenda;
  INSERT INTO public.access_level_permissions (access_level_id, resource, action, allowed) VALUES (v_al_sem_agenda, 'agenda', 'view', false);

  INSERT INTO public.team_members (owner_id, user_id, access_level_id, status, full_name)
  SELECT v_owner_a, (SELECT v FROM zzfx_ids WHERE k='prof_a'),
         (SELECT id FROM public.access_levels WHERE owner_id=v_owner_a AND name='Gerente' LIMIT 1), 'active', 'ZZFX_Prof'
  UNION ALL
  SELECT v_owner_a, (SELECT v FROM zzfx_ids WHERE k='outra_prof_a'), v_al_sem_agenda, 'active', 'ZZFX_OutraProf';
END $setup$;

DO $sentinel$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE 'zz-fixture-%@invalid.test';
  IF n <> 4 THEN RAISE EXCEPTION 'SENTINELA: esperado 4, achei %', n; END IF;
END $sentinel$;

CREATE TEMP TABLE zzfx_notif (id uuid) ON COMMIT DROP;
INSERT INTO public.app_notifications (owner_id, recipient_user_id, kind, title, body)
VALUES ((SELECT v FROM zzfx_ids WHERE k='owner_a'), (SELECT v FROM zzfx_ids WHERE k='prof_a'), 'client_cancelled', 'ZZFX_Teste', 'ZZFX corpo');
INSERT INTO zzfx_notif (id) SELECT id FROM public.app_notifications WHERE title = 'ZZFX_Teste';

CREATE TEMP TABLE zzfx_results (caso text PRIMARY KEY, esperado text, obtido text, sqlstate_obtido text, passou boolean) ON COMMIT DROP;

-- Schema temp só dá USAGE pra quem criou — sem isto, SET LOCAL ROLE
-- authenticated/anon não conseguiria ler/escrever nas tabelas TEMP.
DO $grant$
DECLARE v_schema text := (SELECT pg_my_temp_schema()::regnamespace::text);
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %s TO anon, authenticated', v_schema);
  EXECUTE format('GRANT ALL ON %s.zzfx_results, %s.zzfx_ids, %s.zzfx_notif TO anon, authenticated', v_schema, v_schema, v_schema);
END $grant$;

DO $run$
DECLARE
  v_notif_id uuid := (SELECT id FROM zzfx_notif LIMIT 1);
  v_owner_a uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_prof_a uuid := (SELECT v FROM zzfx_ids WHERE k='prof_a');
  v_outra_prof_a uuid := (SELECT v FROM zzfx_ids WHERE k='outra_prof_a');
  v_owner_b uuid := (SELECT v FROM zzfx_ids WHERE k='owner_b');
  v_ok boolean; v_cnt int; v_state text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- 1) dona lê e marca como lido
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  SELECT count(*) INTO v_cnt FROM public.app_notifications WHERE id = v_notif_id;
  INSERT INTO zzfx_results VALUES ('1_dona_le', 've=1', format('ve=%s', v_cnt), NULL, v_cnt = 1);
  UPDATE public.app_notifications SET read_at = now() WHERE id = v_notif_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  INSERT INTO zzfx_results VALUES ('2_dona_marca_lido', 'altera=1', format('altera=%s', v_cnt), NULL, v_cnt = 1);
  UPDATE public.app_notifications SET read_at = NULL WHERE id = v_notif_id;

  -- 2) profissional destinatária lê e marca como lido
  PERFORM set_config('request.jwt.claim.sub', v_prof_a::text, true);
  SELECT count(*) INTO v_cnt FROM public.app_notifications WHERE id = v_notif_id;
  INSERT INTO zzfx_results VALUES ('3_profissional_le', 've=1', format('ve=%s', v_cnt), NULL, v_cnt = 1);
  UPDATE public.app_notifications SET read_at = now() WHERE id = v_notif_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  INSERT INTO zzfx_results VALUES ('4_profissional_marca_lido', 'altera=1', format('altera=%s', v_cnt), NULL, v_cnt = 1);
  UPDATE public.app_notifications SET read_at = NULL WHERE id = v_notif_id;

  -- 3) UPDATE não consegue alterar OUTRAS colunas — falha por privilégio de coluna (42501), como a dona (que PODE ver a linha, mas não essas colunas)
  BEGIN
    UPDATE public.app_notifications SET title = 'ZZFX_Adulterado' WHERE id = v_notif_id;
    INSERT INTO zzfx_results VALUES ('5_update_title_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('5_update_title_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;
  BEGIN
    UPDATE public.app_notifications SET body = 'ZZFX_Adulterado' WHERE id = v_notif_id;
    INSERT INTO zzfx_results VALUES ('6_update_body_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('6_update_body_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;
  BEGIN
    UPDATE public.app_notifications SET recipient_user_id = v_owner_b WHERE id = v_notif_id;
    INSERT INTO zzfx_results VALUES ('7_update_destinatario_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('7_update_destinatario_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;
  BEGIN
    UPDATE public.app_notifications SET owner_id = v_owner_b WHERE id = v_notif_id;
    INSERT INTO zzfx_results VALUES ('8_update_salao_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('8_update_salao_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;

  -- 4) outra colaboradora do MESMO salão, sem permissão de agenda — não vê
  PERFORM set_config('request.jwt.claim.sub', v_outra_prof_a::text, true);
  SELECT count(*) INTO v_cnt FROM public.app_notifications WHERE id = v_notif_id;
  INSERT INTO zzfx_results VALUES ('9_outra_profissional_nao_ve', 've=0', format('ve=%s', v_cnt), NULL, v_cnt = 0);

  -- 5) pessoa de OUTRO salão — não vê nem altera
  PERFORM set_config('request.jwt.claim.sub', v_owner_b::text, true);
  SELECT count(*) INTO v_cnt FROM public.app_notifications WHERE id = v_notif_id;
  INSERT INTO zzfx_results VALUES ('10_outro_salao_nao_ve', 've=0', format('ve=%s', v_cnt), NULL, v_cnt = 0);
  UPDATE public.app_notifications SET read_at = now() WHERE id = v_notif_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  INSERT INTO zzfx_results VALUES ('11_outro_salao_nao_altera', 'altera=0', format('altera=%s', v_cnt), NULL, v_cnt = 0);

  -- 6) authenticated não consegue INSERIR nem APAGAR avisos
  BEGIN
    INSERT INTO public.app_notifications (owner_id, kind, title, body) VALUES (v_owner_a, 'x', 'ZZFX_Forjado', 'x');
    INSERT INTO zzfx_results VALUES ('12_authenticated_insert_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('12_authenticated_insert_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;
  BEGIN
    DELETE FROM public.app_notifications WHERE id = v_notif_id;
    INSERT INTO zzfx_results VALUES ('13_authenticated_delete_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('13_authenticated_delete_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;

  -- 7) authenticated não lê as outras 4 tabelas nem executa a função
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  BEGIN
    PERFORM count(*) FROM public.whatsapp_central_threads;
    INSERT INTO zzfx_results VALUES ('14_authenticated_threads_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('14_authenticated_threads_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;
  BEGIN
    PERFORM count(*) FROM public.whatsapp_central_incidents;
    INSERT INTO zzfx_results VALUES ('15_authenticated_incidents_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('15_authenticated_incidents_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;
  BEGIN
    PERFORM count(*) FROM public.whatsapp_status_reconciliation;
    INSERT INTO zzfx_results VALUES ('16_authenticated_reconciliation_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('16_authenticated_reconciliation_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;
  BEGIN
    PERFORM count(*) FROM public.whatsapp_central_orphan_messages;
    INSERT INTO zzfx_results VALUES ('17_authenticated_orphan_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('17_authenticated_orphan_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;
  BEGIN
    PERFORM public.apply_whatsapp_central_reply(v_notif_id, 'confirm', v_notif_id, 4);
    INSERT INTO zzfx_results VALUES ('18_authenticated_funcao_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('18_authenticated_funcao_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;

  -- 8) anon é negado em app_notifications, nas outras 4 e na função
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM count(*) FROM public.app_notifications;
    INSERT INTO zzfx_results VALUES ('19_anon_notifications_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('19_anon_notifications_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;
  BEGIN
    PERFORM count(*) FROM public.whatsapp_central_threads;
    INSERT INTO zzfx_results VALUES ('20_anon_threads_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('20_anon_threads_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;
  BEGIN
    PERFORM public.apply_whatsapp_central_reply(v_notif_id, 'confirm', v_notif_id, 4);
    INSERT INTO zzfx_results VALUES ('21_anon_funcao_negado', 'erro 42501', 'PERMITIDO (BUG!)', NULL, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    INSERT INTO zzfx_results VALUES ('21_anon_funcao_negado', 'erro 42501', 'erro:'||v_state, v_state, v_state = '42501');
  END;

  RESET ROLE;
END $run$;

-- Resultado real desta rodada (2026-10-25, rodado contra o banco de
-- produção, ROLLBACK ao final — nada persistiu): 21/21 casos passaram.
SELECT caso, esperado, obtido, sqlstate_obtido, passou FROM zzfx_results ORDER BY caso;

ROLLBACK;
