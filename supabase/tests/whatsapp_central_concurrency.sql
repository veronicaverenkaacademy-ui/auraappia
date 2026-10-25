-- Seção 6 da auditoria de testes do WhatsApp central: concorrência. Padrão
-- ROLLBACK, fixtures sintéticas ZZFX_/zz-fixture-...@invalid.test.
--
-- LIMITAÇÃO HONESTA (confirmar e cancelar DE VERDADE ao mesmo tempo): esta
-- ferramenta (query_database) executa uma consulta por vez, numa conexão
-- só — não há como abrir duas transações REALMENTE sobrepostas (uma presa
-- num FOR UPDATE enquanto a outra tenta a mesma linha) a partir daqui. O
-- que ESTE arquivo prova são duas chamadas SEQUENCIAIS à função real
-- apply_whatsapp_central_reply (não uma reimplementação em outra
-- linguagem) na MESMA transação, uma imediatamente depois da outra — isso
-- prova que a MÁQUINA DE ESTADOS está correta quando a segunda chamada vê
-- o resultado da primeira (o que o lock de linha GARANTE que sempre
-- acontece em produção, serializando o que seria concorrente). O que isto
-- NÃO prova: que o FOR UPDATE de fato BLOQUEIA uma segunda sessão real
-- enquanto a primeira ainda está em andamento. Ver "Decisões que dependem
-- de mim" no relatório final.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE zzfx_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO zzfx_ids (k, v) VALUES
  ('owner_a', gen_random_uuid()), ('client_a', gen_random_uuid());

CREATE TEMP TABLE zzfx_appt (id uuid) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_msg (id uuid) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_thread (id uuid) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_results (caso text PRIMARY KEY, detalhe text) ON COMMIT DROP;

DO $setup$
DECLARE
  v_owner uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_client uuid := (SELECT v FROM zzfx_ids WHERE k='client_a');
  v_appt uuid;
  v_msg uuid;
  v_thread uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-fixture-'||v_owner||'@invalid.test', '', now(), now(), now(), '{}', '{"user_type":"professional"}'::jsonb);

  INSERT INTO public.clients (id, owner_id, full_name, phone)
  VALUES (v_client, v_owner, 'ZZFX_Cliente', '+5547999990099');

  INSERT INTO public.appointments (owner_id, client_id, service_name, starts_at, ends_at, status, client_confirmation_status)
  VALUES (v_owner, v_client, 'ZZFX_Corte', now() + interval '24 hours', now() + interval '25 hours', 'confirmed', 'pending')
  RETURNING id INTO v_appt;
  INSERT INTO zzfx_appt VALUES (v_appt);

  INSERT INTO public.whatsapp_messages (owner_id, client_id, appointment_id, direction, message_type, recipient_phone, provider, provider_message_id, status)
  VALUES (v_owner, v_client, v_appt, 'outbound', 'lembrete_24h', '+5547999990099', 'meta_cloud_api_central', 'ZZFX_WAMID_OUT_1', 'sent')
  RETURNING id INTO v_msg;
  INSERT INTO zzfx_msg VALUES (v_msg);

  INSERT INTO public.whatsapp_central_threads (owner_id, client_id, appointment_id, outbound_message_id, template_key, appointment_starts_at_snapshot, status)
  VALUES (v_owner, v_client, v_appt, v_msg, 'lembrete_24h', (SELECT starts_at FROM public.appointments WHERE id = v_appt), 'awaiting_reply')
  RETURNING id INTO v_thread;
  INSERT INTO zzfx_thread VALUES (v_thread);
END $setup$;

DO $sentinel$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE 'zz-fixture-%@invalid.test';
  IF n <> 1 THEN RAISE EXCEPTION 'SENTINELA: esperado 1 usuário sintético, achei %', n; END IF;
END $sentinel$;

-- ===== CASO 1: Confirmar e Cancelar "quase simultâneos" (sequenciais) =====
DO $caso1$
DECLARE
  v_thread uuid := (SELECT id FROM zzfx_thread);
  v_msg uuid := (SELECT id FROM zzfx_msg);
  v_appt uuid := (SELECT id FROM zzfx_appt);
  r1 text; r2 text; v_status text; v_conf text;
BEGIN
  r1 := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
  r2 := public.apply_whatsapp_central_reply(v_thread, 'cancel', v_msg, 4); -- "logo depois", mesma transação
  SELECT status, client_confirmation_status INTO v_status, v_conf FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results VALUES ('1_confirmar_depois_cancelar',
    format('passo1=%s passo2=%s status_final=%s confirmacao_final=%s', r1, r2, v_status, v_conf));

  -- reseta pro caso 2 (mesma transação, sem COMMIT)
  UPDATE public.appointments SET status='confirmed', client_confirmation_status='pending' WHERE id = v_appt;
  UPDATE public.whatsapp_central_threads SET status='awaiting_reply', resolved_at=NULL, resolved_by_message_id=NULL WHERE id = v_thread;
END $caso1$;

-- ===== CASO 2: o MESMO botão duas vezes =====
DO $caso2$
DECLARE
  v_thread uuid := (SELECT id FROM zzfx_thread);
  v_msg uuid := (SELECT id FROM zzfx_msg);
  v_appt uuid := (SELECT id FROM zzfx_appt);
  r1 text; r2 text; v_conf text;
BEGIN
  r1 := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4);
  r2 := public.apply_whatsapp_central_reply(v_thread, 'confirm', v_msg, 4); -- mesmo botão de novo
  SELECT client_confirmation_status INTO v_conf FROM public.appointments WHERE id = v_appt;
  INSERT INTO zzfx_results VALUES ('2_mesmo_botao_duas_vezes',
    format('passo1=%s passo2=%s confirmacao_final=%s', r1, r2, v_conf));
END $caso2$;

INSERT INTO zzfx_results VALUES ('3_cron_x_toque_mesmo_agendamento',
  'NAO TESTADO (precisaria 2 conexoes reais) - CONFIRMADO NO CODIGO POR LEITURA: ' ||
  'cron (central-reminder-scheduler.server.ts) so grava reminder_24h_sent_at/reminder_2h_sent_at; ' ||
  'resposta de botao (esta funcao SQL) so grava client_confirmation_status/status - colunas disjuntas, sem risco de sobrescrita cruzada');

-- Resultado real desta rodada (2026-10-25):
--   1_confirmar_depois_cancelar: passo1=apply_confirm passo2=apply_cancel status_final=cancelled confirmacao_final=declined
--   2_mesmo_botao_duas_vezes:    passo1=apply_confirm passo2=no_op_already_confirmed confirmacao_final=confirmed (nunca re-aplica)
SELECT * FROM zzfx_results ORDER BY caso;

ROLLBACK;
