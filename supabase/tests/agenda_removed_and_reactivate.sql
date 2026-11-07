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
