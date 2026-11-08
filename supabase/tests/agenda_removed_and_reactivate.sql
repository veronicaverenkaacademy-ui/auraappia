-- D1.4 — Suíte completa de set_agenda_removed e reactivate_cancelled_appointment
-- (20261107150000_agenda_removed_and_reactivate.sql). Padrão ROLLBACK (uma
-- transação, NUNCA COMMIT), fixtures sintéticas ZZFX_/zz-fixture-...@invalid.test
-- — mesmo padrão de whatsapp_central_reply_confirm_status.sql e
-- whatsapp_central_notifications_permissions.sql (simulação de auth.uid()
-- via SET LOCAL ROLE + set_config('request.jwt.claim.sub', ...)).
--
-- Verificador de padrões proibidos (antes de rodar): este arquivo não
-- contém COMMIT nenhum, não contém DROP/TRUNCATE em tabela real, não
-- contém ALTER de policy/trigger/grant em objeto que não seja as próprias
-- funções sob teste, e todo dado sintético usa prefixo ZZFX_/zz-fixture-
-- (nunca toca linha real). Confirmar visualmente antes de colar.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE zzfx_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;

-- ===== Setup: 2 estabelecimentos; A com dona + 1 staff com permissão + 1 staff sem permissão =====
DO $setup$
DECLARE
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_staff_ok_user uuid := gen_random_uuid();
  v_staff_noperm_user uuid := gen_random_uuid();
  v_client_a uuid;
  v_al_gerente uuid;
  v_al_sem_agenda uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_a||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_b||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_staff_ok_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_staff_ok_user||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_staff_noperm_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_staff_noperm_user||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb);

  INSERT INTO public.clients (id, owner_id, full_name, phone) VALUES
    (gen_random_uuid(), v_owner_a, 'ZZFX_Cliente_A', '+5547999990001') RETURNING id INTO v_client_a;

  -- "Gerente" (seed_default_access_levels) tem agenda/edit=true, kind='global' —
  -- staff_ok passa por staff_can() sem precisar da ramificação "own".
  PERFORM public.seed_default_access_levels(v_owner_a);
  SELECT id INTO v_al_gerente FROM public.access_levels WHERE owner_id = v_owner_a AND name = 'Gerente';

  INSERT INTO public.access_levels (owner_id, name) VALUES (v_owner_a, 'ZZFX_SemAgenda') RETURNING id INTO v_al_sem_agenda;
  INSERT INTO public.access_level_permissions (access_level_id, resource, action, allowed) VALUES (v_al_sem_agenda, 'agenda', 'edit', false);

  INSERT INTO public.team_members (owner_id, user_id, access_level_id, status, full_name) VALUES
    (v_owner_a, v_staff_ok_user, v_al_gerente, 'active', 'ZZFX_Staff_OK');
  INSERT INTO public.team_members (owner_id, user_id, access_level_id, status, full_name) VALUES
    (v_owner_a, v_staff_noperm_user, v_al_sem_agenda, 'active', 'ZZFX_Staff_SemPermissao');

  INSERT INTO zzfx_ids (k, v) VALUES
    ('owner_a', v_owner_a), ('owner_b', v_owner_b),
    ('client_a', v_client_a),
    ('staff_ok_user', v_staff_ok_user), ('staff_noperm_user', v_staff_noperm_user);
END $setup$;

DO $sentinel$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE 'zz-fixture-%@invalid.test';
  IF n <> 4 THEN RAISE EXCEPTION 'SENTINELA: esperado 4 usuários sintéticos, achei %', n; END IF;
END $sentinel$;

-- Helper: cria 1 agendamento sintético com status/conf/horário/profissional à escolha.
CREATE OR REPLACE FUNCTION pg_temp.zzfx_make_appt(
  p_owner uuid, p_client uuid, p_professional uuid, p_starts_in interval,
  p_status text DEFAULT 'cancelled', p_conf text DEFAULT 'declined', p_duration interval DEFAULT interval '1 hour'
) RETURNS uuid AS $$
DECLARE v_appt uuid;
BEGIN
  INSERT INTO public.appointments (owner_id, client_id, professional_id, service_name, starts_at, ends_at, status, client_confirmation_status)
  VALUES (p_owner, p_client, p_professional, 'ZZFX_Servico', clock_timestamp() + p_starts_in, clock_timestamp() + p_starts_in + p_duration, p_status::public.appointment_status, p_conf)
  RETURNING id INTO v_appt;
  RETURN v_appt;
END;
$$ LANGUAGE plpgsql;

-- Schema temp só dá USAGE pra quem criou — sem isto, SET LOCAL ROLE authenticated/anon
-- não conseguiria ler/escrever nas tabelas TEMP (mesmo motivo do arquivo de notificações).
DO $grant$
DECLARE v_schema text := (SELECT pg_my_temp_schema()::regnamespace::text);
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %s TO anon, authenticated', v_schema);
  EXECUTE format('GRANT ALL ON %s.zzfx_results, %s.zzfx_ids TO anon, authenticated', v_schema, v_schema);
  -- A sequence do serial (zzfx_results.ordem) é um objeto separado — GRANT ALL
  -- na tabela não cobre automaticamente o USAGE/SELECT nela.
  EXECUTE format('GRANT USAGE, SELECT ON %s.zzfx_results_ordem_seq TO anon, authenticated', v_schema);
END $grant$;

DO $run$
DECLARE
  v_owner_a uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_owner_b uuid := (SELECT v FROM zzfx_ids WHERE k='owner_b');
  v_client_a uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_staff_ok uuid := (SELECT v FROM zzfx_ids WHERE k='staff_ok_user');
  v_staff_noperm uuid := (SELECT v FROM zzfx_ids WHERE k='staff_noperm_user');
  v_appt uuid; v_appt2 uuid; r text; r2 text;
  v_status text; v_conf text; v_removed_at timestamptz; v_removed_by uuid; v_n int; v_confirmed_at timestamptz;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- ===== 1: remover por quem tem permissão (a dona) =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '48 hours');
  r := public.set_agenda_removed(v_appt, true);
  SELECT agenda_removed_at, agenda_removed_by, status::text INTO v_removed_at, v_removed_by, v_status FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('1_dona_remove',
    format('r=%s removed_at=%s removed_by=%s status=%s', r, v_removed_at IS NOT NULL, v_removed_by, v_status),
    r = 'ok' AND v_removed_at IS NOT NULL AND v_removed_by = v_owner_a AND v_status = 'cancelled');

  -- ===== 2: desfazer (remove=false) o mesmo agendamento =====
  r := public.set_agenda_removed(v_appt, false);
  SELECT agenda_removed_at, agenda_removed_by INTO v_removed_at, v_removed_by FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('2_desfazer',
    format('r=%s removed_at=%s removed_by=%s', r, v_removed_at, v_removed_by),
    r = 'ok' AND v_removed_at IS NULL AND v_removed_by IS NULL);

  -- ===== 3: idempotência dupla — remover duas vezes seguidas, as duas 'ok' =====
  r := public.set_agenda_removed(v_appt, true);
  r2 := public.set_agenda_removed(v_appt, true);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('3_remover_idempotente',
    format('r1=%s r2=%s', r, r2), r = 'ok' AND r2 = 'ok');

  -- ===== 4: idempotência dupla — desfazer duas vezes seguidas, as duas 'ok' =====
  PERFORM public.set_agenda_removed(v_appt, false);
  r := public.set_agenda_removed(v_appt, false);
  r2 := public.set_agenda_removed(v_appt, false);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('4_desfazer_idempotente',
    format('r1=%s r2=%s', r, r2), r = 'ok' AND r2 = 'ok');

  -- ===== 5: outro estabelecimento negado (owner_b tenta remover agendamento de owner_a) =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_b::text, true);
  r := public.set_agenda_removed(v_appt, true);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('5_outro_estabelecimento_negado',
    format('r=%s', r), r = 'sem_permissao');

  -- ===== 6: staff SEM permissão de editar agenda — negado =====
  PERFORM set_config('request.jwt.claim.sub', v_staff_noperm::text, true);
  r := public.set_agenda_removed(v_appt, true);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('6_staff_sem_permissao_negado',
    format('r=%s', r), r = 'sem_permissao');

  -- ===== 7: staff COM permissão de editar agenda (staff_can, não é a dona) — permitido =====
  PERFORM set_config('request.jwt.claim.sub', v_staff_ok::text, true);
  r := public.set_agenda_removed(v_appt, true);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('7_staff_com_permissao_ok',
    format('r=%s', r), r = 'ok');

  -- ===== 8: sem login (auth.uid nulo) negado =====
  PERFORM set_config('request.jwt.claim.sub', '', true);
  r := public.set_agenda_removed(v_appt, true);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('8_sem_login_negado',
    format('r=%s (auth.uid()=%s)', r, coalesce(auth.uid()::text, 'NULL')), r = 'sem_permissao');

  -- ===== 9: só 'cancelled' pode ser removido =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_appt2 := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '49 hours', p_status := 'pending', p_conf := 'pending');
  r := public.set_agenda_removed(v_appt2, true);
  SELECT agenda_removed_at INTO v_removed_at FROM public.appointments WHERE id = v_appt2;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('9_so_cancelado_pode_remover',
    format('r=%s removed_at=%s', r, v_removed_at), r = 'nao_cancelado' AND v_removed_at IS NULL);

  -- ===== 10: remover não apaga a linha nem muda o status =====
  r := public.set_agenda_removed(v_appt, true);
  SELECT status::text INTO v_status FROM public.appointments WHERE id = v_appt;
  SELECT count(*) INTO v_n FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('10_remover_nao_apaga_nem_muda_status',
    format('linhas=%s status=%s', v_n, v_status), v_n = 1 AND v_status = 'cancelled');

  -- ===== 11: reativar com horário livre — volta pending/pending, limpa remoção e confirmação =====
  -- client_confirmed_at forçado pra NOT NULL antes, só pra provar que reativar
  -- realmente limpa (senão o teste passaria mesmo que a função não limpasse nada).
  UPDATE public.appointments SET client_confirmed_at = now() WHERE id = v_appt;
  r := public.reactivate_cancelled_appointment(v_appt);
  SELECT status::text, client_confirmation_status, agenda_removed_at, agenda_removed_by, client_confirmed_at
    INTO v_status, v_conf, v_removed_at, v_removed_by, v_confirmed_at
    FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('11_reativar_horario_livre',
    format('r=%s status=%s conf=%s removed_at=%s removed_by=%s confirmed_at=%s', r, v_status, v_conf, v_removed_at, v_removed_by, v_confirmed_at),
    r = 'ok' AND v_status = 'pending' AND v_conf = 'pending' AND v_removed_at IS NULL AND v_removed_by IS NULL AND v_confirmed_at IS NULL);

  -- ===== 12: reativar com horário ocupado por outro ativo — 'horario_ocupado', nada muda =====
  DECLARE
    v_cancelado_ocupado uuid;
    v_ativo_no_mesmo_horario uuid;
    v_status_antes text;
  BEGIN
    -- professional_id NULL nos dois (sem precisar de um team_member sintético
    -- de verdade): a EXCLUDE constraint usa COALESCE(professional_id, '00..0')
    -- com '=', então dois NULL colidem igual a dois profissionais iguais.
    v_cancelado_ocupado := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '72 hours');
    v_ativo_no_mesmo_horario := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '72 hours', p_status := 'pending', p_conf := 'pending');
    r := public.reactivate_cancelled_appointment(v_cancelado_ocupado);
    SELECT status::text INTO v_status_antes FROM public.appointments WHERE id = v_cancelado_ocupado;
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('12_reativar_horario_ocupado',
      format('r=%s status_depois=%s (tem que seguir cancelled)', r, v_status_antes),
      r = 'horario_ocupado' AND v_status_antes = 'cancelled');
  END;

  -- ===== 13: reativar horário já passado =====
  v_appt2 := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '-2 hours');
  r := public.reactivate_cancelled_appointment(v_appt2);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('13_reativar_horario_passado',
    format('r=%s', r), r = 'horario_passado');

  -- ===== 14: reativar horário EXATAMENTE agora (starts_at = now(), <=) também negado =====
  INSERT INTO public.appointments (owner_id, client_id, professional_id, service_name, starts_at, ends_at, status, client_confirmation_status)
  VALUES (v_owner_a, v_client_a, NULL, 'ZZFX_Servico', now(), now() + interval '1 hour', 'cancelled', 'declined')
  RETURNING id INTO v_appt2;
  r := public.reactivate_cancelled_appointment(v_appt2);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('14_reativar_horario_agora_negado',
    format('r=%s', r), r = 'horario_passado');

  -- ===== 15: reativar agendamento que não está cancelado =====
  v_appt2 := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '50 hours', p_status := 'pending', p_conf := 'pending');
  r := public.reactivate_cancelled_appointment(v_appt2);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('15_reativar_nao_cancelado_negado',
    format('r=%s', r), r = 'nao_cancelado');

  -- ===== 16: reativar duas vezes seguidas — segunda vez 'nao_cancelado' =====
  v_appt2 := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '51 hours');
  r := public.reactivate_cancelled_appointment(v_appt2);
  r2 := public.reactivate_cancelled_appointment(v_appt2);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('16_reativar_duas_vezes',
    format('r1=%s r2=%s', r, r2), r = 'ok' AND r2 = 'nao_cancelado');

  -- ===== 17: anon sem EXECUTE em nenhuma das duas funções =====
  SET LOCAL ROLE anon;
  v_appt2 := v_appt; -- qualquer id serve: o erro é na permissão de EXECUTE, antes de ler a linha
  BEGIN
    PERFORM public.set_agenda_removed(v_appt2, true);
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('17_anon_set_agenda_removed_negado', 'PERMITIDO (BUG!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('17_anon_set_agenda_removed_negado', 'erro:42501 (esperado)', true);
  END;
  BEGIN
    PERFORM public.reactivate_cancelled_appointment(v_appt2);
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('18_anon_reactivate_negado', 'PERMITIDO (BUG!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('18_anon_reactivate_negado', 'erro:42501 (esperado)', true);
  END;

  RESET ROLE;

  -- ===== 19: permissões da função (estado esperado após a migration) =====
  DECLARE v_anon1 boolean; v_anon2 boolean; v_authenticated1 boolean; v_authenticated2 boolean;
  BEGIN
    v_anon1 := has_function_privilege('anon', 'public.set_agenda_removed(uuid,boolean)', 'EXECUTE');
    v_anon2 := has_function_privilege('anon', 'public.reactivate_cancelled_appointment(uuid)', 'EXECUTE');
    v_authenticated1 := has_function_privilege('authenticated', 'public.set_agenda_removed(uuid,boolean)', 'EXECUTE');
    v_authenticated2 := has_function_privilege('authenticated', 'public.reactivate_cancelled_appointment(uuid)', 'EXECUTE');
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('19_permissoes_funcoes',
      format('anon=%s,%s(esperado false,false) authenticated=%s,%s(esperado true,true)', v_anon1, v_anon2, v_authenticated1, v_authenticated2),
      NOT v_anon1 AND NOT v_anon2 AND v_authenticated1 AND v_authenticated2);
  END;
END $run$;

-- =====================================================================================
-- D-TER (Opção A): reactivate_cancelled_appointment reabre lembretes 'cancelled'
-- que só foram cancelados pelo próprio cancelamento do agendamento
-- =====================================================================================

-- Helper: cria 1 job sintético com estado à escolha (sem passar pelo scheduler/trigger).
-- SECURITY DEFINER só nesta função auxiliar de TESTE: notification_jobs é
-- REVOKE ALL de authenticated/anon (só service_role tem acesso de verdade),
-- e os casos abaixo rodam como "authenticated" (simulando a profissional
-- logada chamando reactivate_cancelled_appointment) — sem isto, nem
-- conseguiríamos montar o cenário sintético.
CREATE OR REPLACE FUNCTION pg_temp.zzfx_make_job(
  p_owner uuid, p_appt uuid, p_client uuid, p_type text,
  p_status text DEFAULT 'cancelled', p_last_error text DEFAULT NULL, p_sent_at timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_job uuid;
BEGIN
  INSERT INTO public.notification_jobs (owner_id, appointment_id, client_id, type, recipient_phone, status, last_error, sent_at)
  VALUES (p_owner, p_appt, p_client, p_type, 'ZZFX_PHONE', p_status, p_last_error, p_sent_at)
  RETURNING id INTO v_job;
  RETURN v_job;
END;
$$;

-- Helper de LEITURA: mesmo motivo do zzfx_make_job acima — "authenticated"
-- não tem nem SELECT em notification_jobs, só service_role.
CREATE OR REPLACE FUNCTION pg_temp.zzfx_job_row(p_job uuid)
RETURNS TABLE(status text, sent_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY SELECT n.status, n.sent_at FROM public.notification_jobs n WHERE n.id = p_job;
END;
$$;

DO $run2$
DECLARE
  v_owner_a uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_owner_b uuid := (SELECT v FROM zzfx_ids WHERE k='owner_b');
  v_client_a uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_appt uuid; v_appt_b uuid; v_outro_appt uuid;
  v_job24 uuid; v_job2h uuid; v_job_sent uuid; v_job_outro_motivo uuid;
  v_job_outro_appt uuid; v_job_outro_estab uuid; v_job_nao_lembrete uuid;
  r text;
  v_status24 text; v_status2h text; v_sent_status text; v_sent_at_antes timestamptz; v_sent_at_depois timestamptz;
  v_outro_motivo_status text; v_outro_appt_status text; v_outro_estab_status text; v_nao_lembrete_status text;
  v_n int; v_claim_ids uuid[];
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);

  -- ===== 20: cancelar via TRIGGER REAL (pending->cancelled) com 2 lembretes pendentes, reativar dentro da janela — os dois voltam =====
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '100 hours', p_status := 'pending', p_conf := 'pending');
  v_job24 := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_24h', 'pending');
  v_job2h := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_2h', 'pending');
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt; -- trigger real cancela os 2 jobs 'pending'
  SELECT status INTO v_status24 FROM pg_temp.zzfx_job_row(v_job24);
  SELECT status INTO v_status2h FROM pg_temp.zzfx_job_row(v_job2h);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('20a_trigger_real_cancela_os_2_pendentes',
    format('24h=%s 2h=%s', v_status24, v_status2h), v_status24 = 'cancelled' AND v_status2h = 'cancelled');

  r := public.reactivate_cancelled_appointment(v_appt);
  SELECT status INTO v_status24 FROM pg_temp.zzfx_job_row(v_job24);
  SELECT status INTO v_status2h FROM pg_temp.zzfx_job_row(v_job2h);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('20b_reativar_dentro_da_janela_reabre_os_2',
    format('r=%s 24h=%s 2h=%s', r, v_status24, v_status2h), r = 'ok' AND v_status24 = 'pending' AND v_status2h = 'pending');

  -- ===== 21: janela do 24h já passou (falta 3h), mas 2h ainda cabe (>=105min) =====
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '3 hours', p_status := 'pending', p_conf := 'pending');
  v_job24 := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_24h', 'pending');
  v_job2h := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_2h', 'pending');
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  r := public.reactivate_cancelled_appointment(v_appt);
  SELECT status INTO v_status24 FROM pg_temp.zzfx_job_row(v_job24);
  SELECT status INTO v_status2h FROM pg_temp.zzfx_job_row(v_job2h);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('21_janela_24h_passou_mas_2h_cabe',
    format('r=%s 24h=%s(esperado cancelled) 2h=%s(esperado pending)', r, v_status24, v_status2h),
    r = 'ok' AND v_status24 = 'cancelled' AND v_status2h = 'pending');

  -- ===== 22: as duas janelas já passaram (falta 30min) — reativação 'ok', nenhum job reabre =====
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '30 minutes', p_status := 'pending', p_conf := 'pending');
  v_job24 := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_24h', 'pending');
  v_job2h := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_2h', 'pending');
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  r := public.reactivate_cancelled_appointment(v_appt);
  SELECT status INTO v_status24 FROM pg_temp.zzfx_job_row(v_job24);
  SELECT status INTO v_status2h FROM pg_temp.zzfx_job_row(v_job2h);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('22_as_duas_janelas_passaram_nenhum_reabre',
    format('r=%s 24h=%s 2h=%s', r, v_status24, v_status2h),
    r = 'ok' AND v_status24 = 'cancelled' AND v_status2h = 'cancelled');

  -- ===== 23: job 'sent' nunca é tocado (status e sent_at intactos) =====
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '102 hours', p_status := 'pending', p_conf := 'pending');
  v_sent_at_antes := now() - interval '10 hours';
  v_job_sent := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_24h', 'sent', NULL, v_sent_at_antes);
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt; -- trigger só afeta 'pending', não toca 'sent'
  PERFORM public.reactivate_cancelled_appointment(v_appt);
  SELECT status, sent_at INTO v_sent_status, v_sent_at_depois FROM pg_temp.zzfx_job_row(v_job_sent);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('23_job_sent_nunca_tocado',
    format('status=%s sent_at_igual=%s', v_sent_status, v_sent_at_depois = v_sent_at_antes),
    v_sent_status = 'sent' AND v_sent_at_depois = v_sent_at_antes);

  -- ===== 24: job cancelado por OUTRO motivo (last_error preenchido) nunca reabre =====
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '104 hours', p_status := 'pending', p_conf := 'pending');
  v_job_outro_motivo := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_24h', 'cancelled', 'Telefone inválido.');
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  PERFORM public.reactivate_cancelled_appointment(v_appt);
  SELECT status INTO v_outro_motivo_status FROM pg_temp.zzfx_job_row(v_job_outro_motivo);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('24_cancelado_por_outro_motivo_nao_reabre',
    format('status=%s (tem que seguir cancelled)', v_outro_motivo_status), v_outro_motivo_status = 'cancelled');

  -- ===== 25: job de OUTRO agendamento (mesmo estabelecimento) não é tocado =====
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '106 hours', p_status := 'pending', p_conf := 'pending');
  v_outro_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '108 hours', p_status := 'cancelled', p_conf := 'declined');
  v_job_outro_appt := pg_temp.zzfx_make_job(v_owner_a, v_outro_appt, v_client_a, 'appointment_reminder_24h', 'cancelled');
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  PERFORM public.reactivate_cancelled_appointment(v_appt);
  SELECT status INTO v_outro_appt_status FROM pg_temp.zzfx_job_row(v_job_outro_appt);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('25_job_de_outro_agendamento_intacto',
    format('status=%s', v_outro_appt_status), v_outro_appt_status = 'cancelled');

  -- ===== 26: job de OUTRO estabelecimento (owner_b) não é tocado ao reativar um agendamento de owner_a — prova o filtro por owner_id =====
  -- RLS de appointments exige auth.uid() = owner_id no INSERT (zzfx_make_appt não é
  -- SECURITY DEFINER) — troca temporária de sub pra owner_b só nesta linha.
  PERFORM set_config('request.jwt.claim.sub', v_owner_b::text, true);
  v_appt_b := pg_temp.zzfx_make_appt(v_owner_b, v_client_a, NULL, interval '48 hours', p_status := 'cancelled', p_conf := 'declined');
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_job_outro_estab := pg_temp.zzfx_make_job(v_owner_b, v_appt_b, v_client_a, 'appointment_reminder_24h', 'cancelled');
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '110 hours', p_status := 'pending', p_conf := 'pending');
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  PERFORM public.reactivate_cancelled_appointment(v_appt);
  SELECT status INTO v_outro_estab_status FROM pg_temp.zzfx_job_row(v_job_outro_estab);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('26_job_de_outro_estabelecimento_intacto',
    format('status=%s', v_outro_estab_status), v_outro_estab_status = 'cancelled');

  -- ===== 27: tipo que não é lembrete (ex. appointment_confirmation) nunca reabre =====
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '112 hours', p_status := 'pending', p_conf := 'pending');
  v_job_nao_lembrete := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_confirmation', 'cancelled');
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  PERFORM public.reactivate_cancelled_appointment(v_appt);
  SELECT status INTO v_nao_lembrete_status FROM pg_temp.zzfx_job_row(v_job_nao_lembrete);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('27_tipo_nao_lembrete_nao_reabre',
    format('status=%s', v_nao_lembrete_status), v_nao_lembrete_status = 'cancelled');

  -- ===== 28: reativar duas vezes seguidas — segunda 'nao_cancelado', job já reaberto fica como está =====
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '114 hours', p_status := 'pending', p_conf := 'pending');
  v_job24 := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_24h', 'pending');
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  PERFORM public.reactivate_cancelled_appointment(v_appt); -- 1a: reabre
  r := public.reactivate_cancelled_appointment(v_appt); -- 2a: já não está mais cancelled
  SELECT status INTO v_status24 FROM pg_temp.zzfx_job_row(v_job24);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('28_reativar_duas_vezes_job_nao_duplica',
    format('r2=%s job=%s', r, v_status24), r = 'nao_cancelado' AND v_status24 = 'pending');

  -- ===== 29: reativação 'horario_ocupado' não altera nenhum job =====
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '116 hours', p_status := 'pending', p_conf := 'pending');
  v_job24 := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_24h', 'pending');
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  PERFORM pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '116 hours', p_status := 'pending', p_conf := 'pending'); -- ocupa o mesmo horário (professional_id NULL nos dois)
  r := public.reactivate_cancelled_appointment(v_appt);
  SELECT status INTO v_status24 FROM pg_temp.zzfx_job_row(v_job24);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('29_horario_ocupado_nao_altera_job',
    format('r=%s job=%s(esperado cancelled)', r, v_status24), r = 'horario_ocupado' AND v_status24 = 'cancelled');

  -- ===== 30: depois de reaberto, claim_notification_jobs vê o job como elegível =====
  v_appt := pg_temp.zzfx_make_appt(v_owner_a, v_client_a, NULL, interval '118 hours', p_status := 'pending', p_conf := 'pending');
  v_job24 := pg_temp.zzfx_make_job(v_owner_a, v_appt, v_client_a, 'appointment_reminder_24h', 'pending');
  UPDATE public.appointments SET status = 'cancelled' WHERE id = v_appt;
  PERFORM public.reactivate_cancelled_appointment(v_appt);
  SET LOCAL ROLE service_role; -- claim_notification_jobs só é executável por service_role (o scheduler de verdade)
  SELECT array_agg(id) INTO v_claim_ids FROM public.claim_notification_jobs(50);
  SELECT count(*) INTO v_n FROM public.notification_jobs WHERE id = v_job24 AND status = 'processing';
  RESET ROLE; -- service_role nunca recebeu GRANT na tabela TEMP de resultados — volta antes do INSERT
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('30_job_reaberto_elegivel_pro_claim',
    format('job_id_no_resultado_do_claim=%s status_depois=processing(%s)', v_job24 = ANY(v_claim_ids), v_n = 1),
    v_job24 = ANY(v_claim_ids) AND v_n = 1);
END $run2$;

SELECT caso, detalhe, passou FROM zzfx_results ORDER BY ordem;

DO $final_check$
DECLARE v_falhas int;
BEGIN
  SELECT count(*) INTO v_falhas FROM zzfx_results WHERE passou IS NOT TRUE;
  IF v_falhas > 0 THEN
    RAISE EXCEPTION 'SUÍTE FALHOU: % caso(s) não passou(aram) — ver SELECT acima', v_falhas;
  END IF;
END $final_check$;

ROLLBACK;
