-- M4(a) — Suíte completa de apply_whatsapp_central_reply pós-correção
-- (20261104133657_whatsapp_central_reply_confirm_status.sql). Padrão ROLLBACK
-- (uma transação, NUNCA COMMIT), fixtures sintéticas ZZFX_/
-- zz-fixture-...@invalid.test — mesmo padrão de whatsapp_central_concurrency.sql.
-- Rodar o bloco inteiro (BEGIN...ROLLBACK) de uma vez só, numa chamada só.
--
-- Verificador de padrões proibidos (antes de rodar): este arquivo não
-- contém COMMIT nenhum, não contém DROP/TRUNCATE em tabela real, não
-- contém ALTER de policy/trigger/grant em objeto que não seja a própria
-- função sob teste, e todo dado sintético usa prefixo ZZFX_/zz-fixture-
-- (nunca toca linha real). Confirmar visualmente antes de colar.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE zzfx_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_results (ordem serial, caso text, detalhe text) ON COMMIT DROP;

-- ===== Setup: 2 salões (isolamento), salão A com 2 profissionais =====
DO $setup$
DECLARE
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_client_a uuid;
  v_client_b uuid;
  v_prof_1 uuid;
  v_prof_1_user uuid := gen_random_uuid();
  v_prof_2 uuid;
  v_prof_2_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_a||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_b||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_prof_1_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_prof_1_user||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_prof_2_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_prof_2_user||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb);

  INSERT INTO public.clients (id, owner_id, full_name, phone) VALUES
    (gen_random_uuid(), v_owner_a, 'ZZFX_Cliente_A', '+5547999990001') RETURNING id INTO v_client_a;
  INSERT INTO public.clients (id, owner_id, full_name, phone) VALUES
    (gen_random_uuid(), v_owner_b, 'ZZFX_Cliente_B', '+5547999990002') RETURNING id INTO v_client_b;

  INSERT INTO public.team_members (owner_id, user_id, full_name) VALUES
    (v_owner_a, v_prof_1_user, 'ZZFX_Profissional_1') RETURNING id INTO v_prof_1;
  INSERT INTO public.team_members (owner_id, user_id, full_name) VALUES
    (v_owner_a, v_prof_2_user, 'ZZFX_Profissional_2') RETURNING id INTO v_prof_2;

  INSERT INTO zzfx_ids (k, v) VALUES
    ('owner_a', v_owner_a), ('owner_b', v_owner_b),
    ('client_a', v_client_a), ('client_b', v_client_b),
    ('prof_1', v_prof_1), ('prof_1_user', v_prof_1_user),
    ('prof_2', v_prof_2), ('prof_2_user', v_prof_2_user);
END $setup$;

DO $sentinel$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE 'zz-fixture-%@invalid.test';
  IF n <> 4 THEN RAISE EXCEPTION 'SENTINELA: esperado 4 usuários sintéticos, achei %', n; END IF;
END $sentinel$;

-- Helper: cria 1 agendamento + 1 mensagem outbound 'sent' com wamid próprio +
-- 1 thread 'awaiting_reply' já alinhada. RETURNS TABLE (não OUT composite) —
-- evita declarar uma variável do tipo-registro da função no chamador
-- (observado nesta sessão: o ambiente de execução usado para validar este
-- arquivo não resolve o tipo composto de uma função recém-criada dentro da
-- mesma chamada; RETURNS TABLE + SELECT INTO 3 variáveis simples é
-- equivalente e sempre funciona).
CREATE OR REPLACE FUNCTION pg_temp.zzfx_make_thread(
  p_owner uuid, p_client uuid, p_professional uuid, p_starts_in interval,
  -- 'pending' é o cenário REAL: a profissional só cria o agendamento,
  -- nunca confirma sozinha — é exatamente o caso que reproduz o defeito
  -- original (status nunca virava 'confirmed' no toque de "Confirmar").
  p_appt_status text DEFAULT 'pending', p_conf_status text DEFAULT 'pending'
) RETURNS TABLE(o_appt uuid, o_thread uuid, o_msg uuid) AS $$
DECLARE v_appt uuid; v_msg uuid; v_thread uuid;
BEGIN
  INSERT INTO public.appointments (owner_id, client_id, professional_id, service_name, starts_at, ends_at, status, client_confirmation_status)
  VALUES (p_owner, p_client, p_professional, 'ZZFX_Servico', clock_timestamp() + p_starts_in, clock_timestamp() + p_starts_in + interval '1 hour', p_appt_status::public.appointment_status, p_conf_status)
  RETURNING id INTO v_appt;

  INSERT INTO public.whatsapp_messages (owner_id, client_id, appointment_id, direction, message_type, recipient_phone, provider, provider_message_id, status)
  VALUES (p_owner, p_client, v_appt, 'outbound', 'lembrete_24h', 'ZZFX_PHONE', 'meta_cloud_api_central', 'ZZFX_WAMID_'||gen_random_uuid(), 'sent')
  RETURNING id INTO v_msg;

  INSERT INTO public.whatsapp_central_threads (owner_id, client_id, appointment_id, outbound_message_id, template_key, appointment_starts_at_snapshot, status)
  VALUES (p_owner, p_client, v_appt, v_msg, 'lembrete_24h', (SELECT starts_at FROM public.appointments WHERE id = v_appt), 'awaiting_reply')
  RETURNING id INTO v_thread;

  RETURN QUERY SELECT v_appt, v_thread, v_msg;
END;
$$ LANGUAGE plpgsql;

-- ===== CASO 1: pending -> confirm. A CORREÇÃO EM SI: status vira 'confirmed' =====
DO $caso1$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid;
  r text; v_status text; v_conf text; v_thread_status text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '24 hours');
  r := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
  SELECT status::text, client_confirmation_status INTO v_status, v_conf FROM public.appointments WHERE id = v_appt;
  SELECT status INTO v_thread_status FROM public.whatsapp_central_threads WHERE id = v_thread;
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('1_pending_confirm',
    format('resultado=%s status_agendamento=%s (esperado confirmed) confirmacao=%s thread=%s', r, v_status, v_conf, v_thread_status));
  IF r <> 'apply_confirm' OR v_status <> 'confirmed' OR v_conf <> 'confirmed' OR v_thread_status <> 'resolved_confirmed' THEN
    RAISE EXCEPTION 'FALHOU caso 1: %', (SELECT detalhe FROM zzfx_results WHERE caso='1_pending_confirm');
  END IF;

  -- auditoria: autor correto, sem auth.uid()
  PERFORM 1 FROM public.audit_log WHERE resource='appointments' AND resource_id=v_appt::text
    AND action='apply_confirm' AND actor_id IS NULL AND actor_name='Cliente via WhatsApp';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU caso 1: audit_log não gravou autor correto'; END IF;
END $caso1$;

-- ===== CASO 2: confirmed -> confirm (no-op, idempotente) =====
DO $caso2$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r1 text; r2 text; v_status text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '26 hours');
  r1 := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
  r2 := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4); -- mesmo botão de novo
  SELECT status::text INTO v_status FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('2_confirm_repetido',
    format('r1=%s r2=%s status=%s', r1, r2, v_status));
  IF r2 <> 'no_op_already_confirmed' THEN RAISE EXCEPTION 'FALHOU caso 2: %', r2; END IF;
END $caso2$;

-- ===== CASO 3: confirmed -> cancel -> confirm (ordem trocada: confirma depois de cancelar) =====
DO $caso3$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r1 text; r2 text; v_status text; v_conf text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '28 hours');
  r1 := public.apply_whatsapp_central_reply(v_thread, 'cancel', v_msg, 4);
  r2 := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4); -- "voltou atrás"
  SELECT status::text, client_confirmation_status INTO v_status, v_conf FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('3_cancelar_depois_confirmar',
    format('r1=%s r2=%s status=%s (NUNCA reabre sozinho) confirmacao=%s', r1, r2, v_status, v_conf));
  IF r2 <> 'confirm_after_cancel' OR v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'FALHOU caso 3: agendamento não deveria reabrir automaticamente — %', v_status;
  END IF;
END $caso3$;

-- ===== CASO 4: declined -> cancel (no-op, sem aviso duplicado) =====
DO $caso4$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r1 text; r2 text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '30 hours');
  r1 := public.apply_whatsapp_central_reply(v_thread, 'cancel', v_msg, 4);
  r2 := public.apply_whatsapp_central_reply(v_thread, 'cancel', v_msg, 4);
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('4_cancel_repetido', format('r1=%s r2=%s', r1, r2));
  IF r2 <> 'no_op_already_cancelled' THEN RAISE EXCEPTION 'FALHOU caso 4: %', r2; END IF;
END $caso4$;

-- ===== CASO 5: reschedule -> reschedule (repetição, SEM duplicar aviso) =====
DO $caso5$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r1 text; r2 text; v_audit_count int;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '32 hours');
  r1 := public.apply_whatsapp_central_reply(v_thread, 'reschedule', v_msg, 4);
  r2 := public.apply_whatsapp_central_reply(v_thread, 'reschedule', v_msg, 4); -- repete
  SELECT count(*) INTO v_audit_count FROM public.audit_log WHERE resource_id = v_appt::text;
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('5_reschedule_repetido',
    format('r1=%s r2=%s audit_rows=%s (esperado 1, repeat nao audita de novo)', r1, r2, v_audit_count));
  IF r2 <> 'apply_reschedule_request_repeat' OR v_audit_count <> 1 THEN
    RAISE EXCEPTION 'FALHOU caso 5: r2=%, audit_rows=%', r2, v_audit_count;
  END IF;
END $caso5$;

-- ===== CASO 6: no_show (starts_at ainda no futuro, edição manual incomum) =====
-- DEFEITO CORRIGIDO: antes, só 'completed' era excluído — no_show deveria
-- se comportar igual ('late_response'), sem nunca mudar o agendamento.
DO $caso6$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r text; v_status text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '34 hours', p_appt_status := 'no_show');
  r := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
  SELECT status::text INTO v_status FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('6_no_show_confirm', format('resultado=%s status=%s (nunca deveria virar confirmed)', r, v_status));
  IF r <> 'late_response' OR v_status <> 'no_show' THEN RAISE EXCEPTION 'FALHOU caso 6: r=%, status=%', r, v_status; END IF;
END $caso6$;

-- ===== CASO 7: completed (de verdade, passado) =====
DO $caso7$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '-3 hours', p_appt_status := 'completed');
  r := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('7_completed_confirm', format('resultado=%s', r));
  IF r <> 'late_response' THEN RAISE EXCEPTION 'FALHOU caso 7: %', r; END IF;
END $caso7$;

-- ===== CASO 8: agendamento já passado (pending, mas starts_at no passado) =====
DO $caso8$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '-1 hours');
  r := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('8_horario_passado_confirm', format('resultado=%s', r));
  IF r <> 'late_response' THEN RAISE EXCEPTION 'FALHOU caso 8: %', r; END IF;
END $caso8$;

-- ===== CASO 9: agendamento apagado de verdade (hard delete) =====
DO $caso9$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '36 hours');
  DELETE FROM public.appointments WHERE id = v_appt; -- a thread é ON DELETE CASCADE... então apaga a thread também!
  BEGIN
    r := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
    INSERT INTO zzfx_results (caso, detalhe) VALUES ('9_apagado_hard_delete', format('resultado=%s (via cascade a thread tb some, cai em thread_not_found)', r));
    IF r NOT IN ('thread_not_found', 'appointment_not_found') THEN RAISE EXCEPTION 'FALHOU caso 9: %', r; END IF;
  END;
END $caso9$;

-- ===== CASO 10: lembrete desatualizado — ESTADO 'pending' (já cobria antes) =====
DO $caso10$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r text; v_status text; v_thread_status text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '38 hours');
  -- Simula a Agenda remarcando o horário DEPOIS do lembrete já ter saído.
  UPDATE public.appointments SET starts_at = starts_at + interval '5 hours', ends_at = ends_at + interval '5 hours' WHERE id = v_appt;
  r := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
  SELECT status::text INTO v_status FROM public.appointments WHERE id = v_appt;
  SELECT status INTO v_thread_status FROM public.whatsapp_central_threads WHERE id = v_thread;
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('10_stale_pending',
    format('resultado=%s status_agendamento=%s (nunca confirmed) thread=%s', r, v_status, v_thread_status));
  IF r <> 'stale_reminder' OR v_status = 'confirmed' OR v_thread_status <> 'stale' THEN
    RAISE EXCEPTION 'FALHOU caso 10: %', (SELECT detalhe FROM zzfx_results WHERE caso='10_stale_pending');
  END IF;
END $caso10$;

-- ===== CASO 11: lembrete desatualizado — ESTADO JÁ CONFIRMADO (DEFEITO =====
-- CORRIGIDO: antes a checagem de snapshot só valia no ramo 'pending'; um
-- toque com client_confirmation_status='confirmed' NUNCA conferia o
-- snapshot. "Agenda editando o horário no meio" — a remarcação acontece
-- DEPOIS que a cliente já tinha confirmado o horário original.
DO $caso11$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r1 text; r2 text; v_status_antes text; v_status_depois text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '60 hours');
  r1 := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4); -- confirma o horário original
  SELECT status::text INTO v_status_antes FROM public.appointments WHERE id = v_appt;
  -- Agenda remarca DEPOIS da confirmação (o snapshot da thread fica desatualizado).
  UPDATE public.appointments SET starts_at = starts_at + interval '3 hours', ends_at = ends_at + interval '3 hours' WHERE id = v_appt;
  -- Reabre a thread (simula uma 2ª tentativa de resposta chegando — na prática
  -- isto só aconteceria com uma thread NOVA, mas o que importa é provar que
  -- o estado 'confirmed' TAMBÉM respeita o snapshot, não só 'pending').
  UPDATE public.whatsapp_central_threads SET status = 'awaiting_reply', resolved_at = NULL WHERE id = v_thread;
  r2 := public.apply_whatsapp_central_reply(v_thread, 'cancel', v_msg, 4); -- tenta cancelar o horário ANTIGO
  SELECT status::text INTO v_status_depois FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('11_stale_estado_confirmado',
    format('r1=%s status_antes=%s r2=%s status_depois=%s (NUNCA deveria cancelar o horario novo por engano)', r1, v_status_antes, r2, v_status_depois));
  IF r2 <> 'stale_reminder' OR v_status_depois = 'cancelled' THEN
    RAISE EXCEPTION 'FALHOU caso 11: % (regressão da correção universal de staleness)',
      (SELECT detalhe FROM zzfx_results WHERE caso='11_stale_estado_confirmado');
  END IF;
END $caso11$;

-- ===== CASO 12: dois salões — isolamento (thread do salão B nunca afeta A) =====
DO $caso12$
DECLARE
  v_owner_b uuid := (SELECT v FROM zzfx_ids WHERE k='owner_b');
  v_client_b uuid := (SELECT v FROM zzfx_ids WHERE k='client_b');
  v_appt uuid; v_thread uuid; v_msg uuid; r text; v_owner_no_resultado uuid;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner_b, v_client_b, NULL, interval '24 hours');
  r := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
  SELECT owner_id INTO v_owner_no_resultado FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('12_isolamento_salao_b',
    format('resultado=%s owner_afetado=%s (tem que ser owner_b, nunca owner_a)', r, CASE WHEN v_owner_no_resultado = v_owner_b THEN 'owner_b_correto' ELSE 'ERRO_cruzou_salao' END));
  IF r <> 'apply_confirm' OR v_owner_no_resultado <> v_owner_b THEN RAISE EXCEPTION 'FALHOU caso 12 (isolamento)'; END IF;
END $caso12$;

-- ===== CASO 13: salão com 2 profissionais — aviso pra quem é dono do agendamento =====
DO $caso13$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof1 uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_prof1_user uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1_user');
  v_prof2 uuid := (SELECT v FROM zzfx_ids WHERE k='prof_2');
  v_prof2_user uuid := (SELECT v FROM zzfx_ids WHERE k='prof_2_user');
  v_appt1 uuid; v_thread1 uuid; v_msg1 uuid;
  v_appt2 uuid; v_thread2 uuid; v_msg2 uuid;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt1, v_thread1, v_msg1 FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof1, interval '100 hours');
  SELECT o_appt, o_thread, o_msg INTO v_appt2, v_thread2, v_msg2 FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof2, interval '101 hours');
  -- A RESOLUÇÃO de qual profissional é a certa é feita em TypeScript
  -- (central-webhook-handler.server.ts::resolveRecipientUserId, via
  -- appointments.professional_id -> team_members.user_id) — a função SQL
  -- não decide recipient_user_id (não existe parâmetro pra isso). Este
  -- caso prova que cada agendamento mantém o professional_id PRÓPRIO,
  -- intocado pela função, pra essa resolução em TS funcionar certo.
  PERFORM public.apply_whatsapp_central_reply(v_thread1, 'confirm', v_msg1, 4);
  PERFORM public.apply_whatsapp_central_reply(v_thread2, 'cancel', v_msg2, 4);
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('13_duas_profissionais_mesmo_salao',
    format('appt1.professional_id=%s (prof_1) appt2.professional_id=%s (prof_2) — cada um intocado pela função',
      (SELECT professional_id FROM public.appointments WHERE id = v_appt1) = v_prof1,
      (SELECT professional_id FROM public.appointments WHERE id = v_appt2) = v_prof2));
  IF (SELECT professional_id FROM public.appointments WHERE id = v_appt1) <> v_prof1
     OR (SELECT professional_id FROM public.appointments WHERE id = v_appt2) <> v_prof2 THEN
    RAISE EXCEPTION 'FALHOU caso 13: professional_id não deveria mudar';
  END IF;
END $caso13$;

-- ===== CASO 14: cancelar NÃO deixa o job de 2h pendente sair (gatilho já existente) =====
DO $caso14$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; r text; v_job_2h_status text; v_job_count int;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '45 hours');
  INSERT INTO public.notification_jobs (owner_id, appointment_id, client_id, type, status, recipient_phone, scheduled_for)
  VALUES (v_owner, v_appt, v_client, 'appointment_reminder_2h', 'pending', 'ZZFX_PHONE', now() + interval '22 hours');

  r := public.apply_whatsapp_central_reply(v_thread, 'cancel', v_msg, 4);
  SELECT status, count(*) OVER () INTO v_job_2h_status, v_job_count
    FROM public.notification_jobs WHERE appointment_id = v_appt AND type = 'appointment_reminder_2h';
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('14_cancelar_job_2h',
    format('resultado=%s job_2h_status=%s (esperado cancelled, via trigger enqueue_appointment_whatsapp_jobs)', r, v_job_2h_status));
  IF v_job_2h_status <> 'cancelled' THEN RAISE EXCEPTION 'FALHOU caso 14: job 2h continua %', v_job_2h_status; END IF;
END $caso14$;

-- ===== CASO 15: gatilhos permitem a mudança (SECURITY DEFINER, auth.uid() nulo) =====
DO $caso15$
DECLARE v_uid uuid;
BEGIN
  v_uid := auth.uid(); -- NULL nesta conexão (sem JWT) — confirma a premissa dos casos acima
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('15_auth_uid_nulo_nao_bloqueou',
    format('auth.uid()=%s — todos os UPDATEs dos casos 1-14 já aconteceram COM este auth.uid() nulo, sem erro', coalesce(v_uid::text, 'NULL')));
END $caso15$;

-- ===== CASO 16: permissões da função (igual ao estado antes da migration) =====
DO $caso16$
DECLARE v_anon boolean; v_authenticated boolean; v_service boolean; v_sandbox boolean;
BEGIN
  v_anon := has_function_privilege('anon', 'public.apply_whatsapp_central_reply(uuid,text,uuid,numeric)', 'EXECUTE');
  v_authenticated := has_function_privilege('authenticated', 'public.apply_whatsapp_central_reply(uuid,text,uuid,numeric)', 'EXECUTE');
  v_service := has_function_privilege('service_role', 'public.apply_whatsapp_central_reply(uuid,text,uuid,numeric)', 'EXECUTE');
  v_sandbox := has_function_privilege('sandbox_exec', 'public.apply_whatsapp_central_reply(uuid,text,uuid,numeric)', 'EXECUTE');
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('16_permissoes',
    format('anon=%s(esperado false) authenticated=%s(esperado false) service_role=%s(esperado true) sandbox_exec=%s(esperado true)',
      v_anon, v_authenticated, v_service, v_sandbox));
  IF v_anon OR v_authenticated OR NOT v_service OR NOT v_sandbox THEN RAISE EXCEPTION 'FALHOU caso 16: permissões divergem do estado anterior'; END IF;
END $caso16$;

-- ===== CASO 17: atomicidade (SAVEPOINT) — tudo junto ou nada =====
-- Limitação honesta (mesma do arquivo de concorrência): não forçamos uma
-- falha real no meio do INSERT em audit_log (arriscado/artificial sem
-- tocar a tabela real) — em vez disso, provamos a garantia transacional
-- do Postgres: desfazer TODAS as escritas da função (appointments +
-- audit_log + whatsapp_central_threads) juntas, nunca parcialmente — é essa
-- mesma garantia que cobre "se o INSERT falhar, nada fica gravado", sem
-- precisar simular a falha em si.
-- plpgsql não aceita SAVEPOINT/ROLLBACK TO SAVEPOINT como comando solto
-- (erro de sintaxe) — um bloco BEGIN/EXCEPTION cria um savepoint implícito
-- no início do bloco e desfaz tudo dentro dele quando uma exceção é
-- capturada, mesma garantia, forma válida em plpgsql.
DO $caso17$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_prof uuid := (SELECT v FROM zzfx_ids WHERE k='prof_1');
  v_appt uuid; v_thread uuid; v_msg uuid; v_audit_antes int; v_audit_depois int; v_status_depois text;
BEGIN
  SELECT o_appt, o_thread, o_msg INTO v_appt, v_thread, v_msg FROM pg_temp.zzfx_make_thread(v_owner, v_client, v_prof, interval '46 hours');
  SELECT count(*) INTO v_audit_antes FROM public.audit_log;

  BEGIN
    PERFORM public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
    RAISE EXCEPTION 'zzfx_forced_rollback_caso17';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'zzfx_forced_rollback_caso17' THEN
      RAISE;
    END IF;
  END;

  SELECT count(*) INTO v_audit_depois FROM public.audit_log;
  SELECT status::text INTO v_status_depois FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results (caso, detalhe) VALUES ('17_atomicidade_savepoint',
    format('audit_antes=%s audit_depois=%s (tem que bater) status_depois=%s (tem que seguir pending, não confirmed)', v_audit_antes, v_audit_depois, v_status_depois));
  IF v_audit_antes <> v_audit_depois OR v_status_depois = 'confirmed' THEN
    RAISE EXCEPTION 'FALHOU caso 17: rollback parcial detectado';
  END IF;
END $caso17$;

SELECT caso, detalhe FROM zzfx_results ORDER BY ordem;

ROLLBACK;
