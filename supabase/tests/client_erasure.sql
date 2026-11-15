-- FASE LEGAL-1 REDUZIDA — suíte da migração 20261115140000_client_erasure.sql.
--
-- NÃO EXECUTADA contra produção nesta fase (branch nova + PR em DRAFT, por
-- instrução explícita da dona — "a migração NÃO é aplicada nesta fase").
-- Rodada LOCALMENTE (Postgres 16 deste ambiente, banco descartável
-- `legal1_test`, NUNCA o banco de produção da dona) — ver saída colada no
-- relatório final da fase. Pressupõe que auth.users, public.clients (com
-- TODAS as colunas reais), client_anamnesis, client_photos, client_consents
-- (+ trigger de imutabilidade + purge_client_consent_pii, corpo exato de
-- 20261115120000), whatsapp_messages, whatsapp_central_threads,
-- whatsapp_confirmation_threads, whatsapp_blocked_recipients,
-- notification_jobs, appointments (+ as 5 triggers reais de produção —
-- consume_appointment_materials/record_appointment_revenue/
-- record_commission_snapshot/enqueue_appointment_created_job/
-- enqueue_appointment_whatsapp_jobs), conversations, messages,
-- app_notifications e staff_can()/team_members/team_permissions já existem
-- (verdade em produção; localmente, um bootstrap fora deste arquivo — nunca
-- committed — recria versões fiéis dessas peças, com os corpos de função
-- lidos via pg_get_functiondef em produção nesta mesma fase).
--
-- Mesmo padrão de supabase/tests/client_consents.sql: fixtures sintéticas
-- zzle_, tudo dentro de BEGIN...ROLLBACK, DDL colado na íntegra (migração e
-- rollback, exatamente como os arquivos reais), lógica de teste em blocos
-- DO $$ separados, resultados agregados numa tabela temporária e impressos
-- com um SELECT final (JSON). Nunca COMMIT.
--
-- Ciclo cobrado pela fase: 0) confirma que as 2 funções não existem ainda;
-- 1) fixtures (2 estúdios A/B; cliente X com uma linha de `clients` em CADA
-- estúdio, mesmo user_id; cliente "outro" em A e em B, intocados; dados
-- completos de anamnese/fotos/consentimentos/mensagens/threads/bloqueio/
-- jobs/conversas para a cliente X em A, um subconjunto em B; agendamentos
-- futuro-pendente, futuro-já-cancelado, futuro-completed-antecipado e
-- passado-completed para a cliente X em A); 2) aplica a migração;
-- 3) verificação estrutural (coluna nova, GRANT/REVOKE); 4) client_erasure_plan
-- devolve as contagens certas, inclusive storage_paths; 5) erase_client_data
-- apaga/anonimiza cada tabela conforme o desenho (caso a caso); 6) isolamento
-- (outro cliente do estúdio A intacto; estúdio B intacto exceto a própria
-- linha da cliente X; bloqueio de WhatsApp do estúdio B NUNCA tocado mesmo
-- com o mesmo telefone); 7) UNIQUE (owner_id,user_id) liberado — novo
-- cadastro com o mesmo user_id funciona; 8) idempotência (2ª chamada não
-- falha e não muda nada); 9) permissão (anon/authenticated sem EXECUTE;
-- service_role com EXECUTE); 10) aplica o rollback (com backup); 11) confirma
-- que coluna/funções somem; 12) reaplica a migração e confirma que volta a
-- funcionar. Nunca COMMIT.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

CREATE TEMP TABLE zzle_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzle_ids (chave text PRIMARY KEY, valor uuid) ON COMMIT DROP;
GRANT ALL ON zzle_results TO PUBLIC;
GRANT ALL ON zzle_ids TO PUBLIC;
GRANT ALL ON SEQUENCE zzle_results_ordem_seq TO PUBLIC;

-- ============================================================================
-- PASSO 0 — confirma que nada disto existe ainda
-- ============================================================================
DO $passo0$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('client_erasure_plan', 'erase_client_data');
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('00_funcoes_nao_existem_ainda', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients' AND column_name='deleted_by_client_at';
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('00_coluna_deleted_by_client_at_nao_existe_ainda', format('%s (esperado 0)', v_n), v_n = 0);
END $passo0$;

-- ============================================================================
-- PASSO 1 — fixtures
-- ============================================================================
INSERT INTO zzle_ids (chave, valor) VALUES
  ('owner_a', gen_random_uuid()),
  ('owner_b', gen_random_uuid()),
  ('user_x', gen_random_uuid()),
  ('user_other_a', gen_random_uuid()),
  ('user_other_b', gen_random_uuid());

DO $setup$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzle_ids WHERE chave='owner_a');
  v_owner_b uuid := (SELECT valor FROM zzle_ids WHERE chave='owner_b');
  v_user_x uuid := (SELECT valor FROM zzle_ids WHERE chave='user_x');
  v_user_other_a uuid := (SELECT valor FROM zzle_ids WHERE chave='user_other_a');
  v_user_other_b uuid := (SELECT valor FROM zzle_ids WHERE chave='user_other_b');
  v_client_x_a uuid; v_client_x_b uuid; v_client_other_a uuid; v_client_other_b uuid;
  v_appt_future_pending uuid; v_appt_future_cancelled uuid; v_appt_future_completed_early uuid; v_appt_past_completed uuid;
  v_appt_other_a uuid; v_appt_x_b_future uuid;
  v_conv_x_a uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner_a, 'zz-fixture-owner-a@invalid.test'),
    (v_owner_b, 'zz-fixture-owner-b@invalid.test'),
    (v_user_x, 'zz-fixture-user-x@invalid.test'),
    (v_user_other_a, 'zz-fixture-user-other-a@invalid.test'),
    (v_user_other_b, 'zz-fixture-user-other-b@invalid.test');

  -- Cliente X: uma linha em CADA estúdio, mesmo user_id (mesma pessoa,
  -- cadastro em dois salões) — telefone igual nos dois (mesma pessoa real).
  INSERT INTO public.clients (owner_id, full_name, phone, email, birthday, cpf, notes, how_found, avatar_url, tags, user_id, terms_accepted_at)
    VALUES (v_owner_a, 'zz-fixture Cliente X', '+5511999990001', 'x@invalid.test', '1990-01-01', '00000000000', 'nota privada A', 'instagram', 'https://x/avatar.png', ARRAY['vip'], v_user_x, now())
    RETURNING id INTO v_client_x_a;
  INSERT INTO public.clients (owner_id, full_name, phone, user_id)
    VALUES (v_owner_b, 'zz-fixture Cliente X (salão B)', '+5511999990001', v_user_x)
    RETURNING id INTO v_client_x_b;

  -- Cliente "outra", intocada, em cada estúdio.
  INSERT INTO public.clients (owner_id, full_name, phone, user_id) VALUES (v_owner_a, 'zz-fixture Outra Cliente A', '+5511999990002', v_user_other_a) RETURNING id INTO v_client_other_a;
  INSERT INTO public.clients (owner_id, full_name, phone, user_id) VALUES (v_owner_b, 'zz-fixture Outra Cliente B', '+5511999990003', v_user_other_b) RETURNING id INTO v_client_other_b;

  INSERT INTO zzle_ids (chave, valor) VALUES
    ('client_x_a', v_client_x_a), ('client_x_b', v_client_x_b),
    ('client_other_a', v_client_other_a), ('client_other_b', v_client_other_b);

  -- Anamnese (client_x_a e client_other_a).
  INSERT INTO public.client_anamnesis (client_id, owner_id, allergies, notes) VALUES (v_client_x_a, v_owner_a, 'zz alergia', 'zz nota saúde');
  INSERT INTO public.client_anamnesis (client_id, owner_id, allergies) VALUES (v_client_other_a, v_owner_a, 'zz alergia outra');

  -- Fotos (2 para client_x_a, 1 para client_other_a).
  INSERT INTO public.client_photos (owner_id, client_id, storage_path, kind) VALUES
    (v_owner_a, v_client_x_a, v_owner_a::text || '/' || v_client_x_a::text || '/foto1.jpg', 'face'),
    (v_owner_a, v_client_x_a, v_owner_a::text || '/' || v_client_x_a::text || '/foto2.jpg', 'other');
  INSERT INTO public.client_photos (owner_id, client_id, storage_path) VALUES
    (v_owner_a, v_client_other_a, v_owner_a::text || '/' || v_client_other_a::text || '/foto3.jpg');

  -- Consentimentos: client_x_a com PII preenchida (pra provar que só a PII
  -- é zerada, a linha nunca é apagada); client_other_a intocável.
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source, signer_name, evidence_ip, evidence_user_agent)
    VALUES (v_owner_a, v_client_x_a, 'health_data', 'granted', 'termo-consentimento', '2026-08-04', 'portal', 'Cliente X Nome', '203.0.113.9', 'Mozilla/5.0 (teste)');
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source, signer_name)
    VALUES (v_owner_a, v_client_other_a, 'terms_privacy', 'granted', 'termos-de-uso', '2026-08-04', 'portal', 'Outra Nome');

  -- Mensagens/threads de WhatsApp da cliente X em A.
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, content, status)
    VALUES (v_owner_a, v_client_x_a, 'outbound', 'template', '+5511999990001', 'zz conteudo', 'sent');
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, v_client_other_a, 'outbound', 'template', '+5511999990002', 'sent');

  -- Agendamentos da cliente X em A: futuro pendente (será cancelado),
  -- futuro JÁ cancelado (deve permanecer cancelado, não recontado), futuro
  -- com status completed antecipado (preservado — nunca "futuro a cancelar"
  -- porque já está completed), passado completed (preservado).
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price, notes)
    VALUES (v_owner_a, v_client_x_a, now() + interval '3 days', now() + interval '3 days 1 hour', 'pending', 100, 'nota do agendamento futuro')
    RETURNING id INTO v_appt_future_pending;
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price)
    VALUES (v_owner_a, v_client_x_a, now() + interval '5 days', now() + interval '5 days 1 hour', 'cancelled', 100)
    RETURNING id INTO v_appt_future_cancelled;
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price)
    VALUES (v_owner_a, v_client_x_a, now() + interval '7 days', now() + interval '7 days 1 hour', 'completed', 100)
    RETURNING id INTO v_appt_future_completed_early;
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price, notes)
    VALUES (v_owner_a, v_client_x_a, now() - interval '10 days', now() - interval '10 days' + interval '1 hour', 'completed', 150, 'nota do agendamento passado')
    RETURNING id INTO v_appt_past_completed;
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price)
    VALUES (v_owner_a, v_client_other_a, now() + interval '3 days', now() + interval '3 days 1 hour', 'pending', 100)
    RETURNING id INTO v_appt_other_a;

  INSERT INTO zzle_ids (chave, valor) VALUES
    ('appt_future_pending', v_appt_future_pending), ('appt_future_cancelled', v_appt_future_cancelled),
    ('appt_future_completed_early', v_appt_future_completed_early), ('appt_past_completed', v_appt_past_completed),
    ('appt_other_a', v_appt_other_a);

  -- Threads de WhatsApp ligadas ao agendamento futuro pendente da cliente X.
  INSERT INTO public.whatsapp_central_threads (owner_id, client_id, appointment_id, outbound_message_id, template_key, appointment_starts_at_snapshot)
    VALUES (v_owner_a, v_client_x_a, v_appt_future_pending, gen_random_uuid(), 'lembrete_24h', now() + interval '3 days');
  INSERT INTO public.whatsapp_confirmation_threads (owner_id, client_id, appointment_id, outbound_message_id, appointment_starts_at_snapshot)
    VALUES (v_owner_a, v_client_x_a, v_appt_future_pending, gen_random_uuid(), now() + interval '3 days');

  -- notification_jobs: 1 PENDENTE pro agendamento futuro, 1 já SENT pro
  -- agendamento passado (prova que TODOS são apagados, não só pendentes).
  INSERT INTO public.notification_jobs (owner_id, appointment_id, client_id, type, recipient_phone, status)
    VALUES (v_owner_a, v_appt_future_pending, v_client_x_a, 'appointment_reminder_24h', '+5511999990001', 'pending');
  INSERT INTO public.notification_jobs (owner_id, appointment_id, client_id, type, recipient_phone, status, sent_at)
    VALUES (v_owner_a, v_appt_past_completed, v_client_x_a, 'appointment_confirmation', '+5511999990001', 'sent', now() - interval '10 days');
  INSERT INTO public.notification_jobs (owner_id, appointment_id, client_id, type, recipient_phone, status)
    VALUES (v_owner_a, v_appt_other_a, v_client_other_a, 'appointment_created', '+5511999990002', 'pending');

  -- Bloqueio de WhatsApp da cliente X no estúdio A — e, de propósito, um
  -- bloqueio de OUTRO telefone (o da "outra cliente B") no estúdio B, que
  -- NUNCA deve ser tocado (prova de isolamento entre telefones/estúdios;
  -- o bloqueio do PRÓPRIO telefone da cliente X em B, se existisse, SERIA
  -- corretamente apagado também — ela tem uma linha de clients em B).
  INSERT INTO public.whatsapp_blocked_recipients (owner_id, phone_e164, source, reason) VALUES (v_owner_a, '+5511999990001', 'client_stop_request', 'zz pediu pra parar');
  INSERT INTO public.whatsapp_blocked_recipients (owner_id, phone_e164, source, reason) VALUES (v_owner_b, '+5511999990003', 'client_stop_request', 'zz bloqueio de outra pessoa em B');

  -- Chat legado (conversations/messages) da cliente X em A.
  INSERT INTO public.conversations (owner_id, client_id, contact_phone, contact_name) VALUES (v_owner_a, v_client_x_a, '+5511999990001', 'Cliente X') RETURNING id INTO v_conv_x_a;
  INSERT INTO public.messages (owner_id, conversation_id, direction, content) VALUES (v_owner_a, v_conv_x_a, 'in', 'zz mensagem legada');

  -- Estúdio B: cliente X com 1 agendamento futuro pendente (também deve ser
  -- cancelado — o erase cobre TODAS as linhas de clients do user_id, nos
  -- dois estúdios).
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price)
    VALUES (v_owner_b, v_client_x_b, now() + interval '2 days', now() + interval '2 days 1 hour', 'confirmed', 80)
    RETURNING id INTO v_appt_x_b_future;
  INSERT INTO zzle_ids (chave, valor) VALUES ('appt_x_b_future', v_appt_x_b_future);
END $setup$;

DO $sentinela$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE 'zz-fixture-%@invalid.test';
  IF n <> 5 THEN RAISE EXCEPTION 'SENTINELA: esperado 5 usuários sintéticos, achei %', n; END IF;
END $sentinela$;

-- ============================================================================
-- PASSO 2 — aplica a migração (DDL colado, igual ao arquivo real)
-- ============================================================================
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS deleted_by_client_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.client_erasure_plan(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'client_id', c.id,
    'owner_id', c.owner_id,
    'already_anonymized', c.deleted_by_client_at IS NOT NULL,
    'anamnesis_count', (SELECT count(*) FROM public.client_anamnesis a WHERE a.client_id = c.id),
    'photo_storage_paths', (
      SELECT COALESCE(jsonb_agg(p.storage_path), '[]'::jsonb)
      FROM public.client_photos p WHERE p.client_id = c.id
    ),
    'consents_count', (SELECT count(*) FROM public.client_consents cc WHERE cc.client_id = c.id),
    'whatsapp_messages_count', (SELECT count(*) FROM public.whatsapp_messages m WHERE m.client_id = c.id),
    'central_threads_count', (SELECT count(*) FROM public.whatsapp_central_threads t WHERE t.client_id = c.id),
    'confirmation_threads_count', (SELECT count(*) FROM public.whatsapp_confirmation_threads t WHERE t.client_id = c.id),
    'notification_jobs_count', (SELECT count(*) FROM public.notification_jobs n WHERE n.client_id = c.id),
    'conversations_count', (SELECT count(*) FROM public.conversations cv WHERE cv.client_id = c.id),
    'future_appointments_to_cancel', (
      SELECT count(*) FROM public.appointments ap
      WHERE ap.client_id = c.id AND ap.starts_at > now()
        AND ap.status NOT IN ('completed', 'cancelled', 'no_show')
    ),
    'past_appointments_preserved', (
      SELECT count(*) FROM public.appointments ap
      WHERE ap.client_id = c.id
        AND NOT (ap.starts_at > now() AND ap.status NOT IN ('completed', 'cancelled', 'no_show'))
    )
  )), '[]'::jsonb)
  INTO _result
  FROM public.clients c
  WHERE c.user_id = _user_id;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.client_erasure_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_erasure_plan(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.erase_client_data(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _client record;
  _old_phone text;
  _n_anamnesis integer;
  _n_photos integer;
  _n_messages integer;
  _n_central integer;
  _n_confirmation integer;
  _n_jobs integer;
  _n_blocked integer;
  _n_conv_messages integer;
  _n_conversations integer;
  _n_cancelled integer;
  _n_consents_purged integer;
  _per_client jsonb;
  _totals jsonb := '[]'::jsonb;
BEGIN
  FOR _client IN SELECT id, owner_id, phone FROM public.clients WHERE user_id = _user_id LOOP
    _old_phone := _client.phone;

    SELECT public.purge_client_consent_pii(_client.id) INTO _n_consents_purged;

    DELETE FROM public.client_anamnesis WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_anamnesis = ROW_COUNT;

    DELETE FROM public.client_photos WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_photos = ROW_COUNT;

    DELETE FROM public.whatsapp_messages WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_messages = ROW_COUNT;

    DELETE FROM public.whatsapp_central_threads WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_central = ROW_COUNT;

    DELETE FROM public.whatsapp_confirmation_threads WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_confirmation = ROW_COUNT;

    IF _old_phone IS NOT NULL THEN
      DELETE FROM public.whatsapp_blocked_recipients wbr
      WHERE wbr.owner_id = _client.owner_id
        AND right(regexp_replace(wbr.phone_e164, '\D', '', 'g'), 8)
          = right(regexp_replace(_old_phone, '\D', '', 'g'), 8);
      GET DIAGNOSTICS _n_blocked = ROW_COUNT;
    ELSE
      _n_blocked := 0;
    END IF;

    DELETE FROM public.messages msg
    WHERE msg.conversation_id IN (SELECT id FROM public.conversations WHERE client_id = _client.id);
    GET DIAGNOSTICS _n_conv_messages = ROW_COUNT;
    DELETE FROM public.conversations WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_conversations = ROW_COUNT;

    UPDATE public.appointments
    SET status = 'cancelled'
    WHERE client_id = _client.id
      AND starts_at > now()
      AND status NOT IN ('completed', 'cancelled', 'no_show');
    GET DIAGNOSTICS _n_cancelled = ROW_COUNT;

    DELETE FROM public.notification_jobs WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_jobs = ROW_COUNT;

    UPDATE public.clients
    SET full_name = 'Cliente excluída',
        phone = NULL,
        email = NULL,
        birthday = NULL,
        cpf = NULL,
        notes = NULL,
        how_found = NULL,
        avatar_url = NULL,
        tags = '{}',
        user_id = NULL,
        deleted_by_client_at = now()
    WHERE id = _client.id;

    INSERT INTO public.app_notifications (owner_id, recipient_user_id, kind, title, body, dedupe_key)
    VALUES (
      _client.owner_id, NULL, 'client_account_deleted',
      'Uma cliente excluiu a conta',
      'Uma cliente excluiu a própria conta no portal. Os dados pessoais dela foram apagados; o histórico de atendimentos foi mantido sem identificação.',
      'client_erasure:' || _client.id::text
    )
    ON CONFLICT (owner_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

    _per_client := jsonb_build_object(
      'client_id', _client.id,
      'owner_id', _client.owner_id,
      'consents_purged', _n_consents_purged,
      'anamnesis_deleted', _n_anamnesis,
      'photos_deleted', _n_photos,
      'whatsapp_messages_deleted', _n_messages,
      'central_threads_deleted', _n_central,
      'confirmation_threads_deleted', _n_confirmation,
      'blocked_recipients_deleted', _n_blocked,
      'conversation_messages_deleted', _n_conv_messages,
      'conversations_deleted', _n_conversations,
      'appointments_cancelled', _n_cancelled,
      'notification_jobs_deleted', _n_jobs
    );
    _totals := _totals || jsonb_build_array(_per_client);
  END LOOP;

  RETURN _totals;
END;
$$;

REVOKE ALL ON FUNCTION public.erase_client_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_client_data(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PASSO 3 — verificação estrutural
-- ============================================================================
DO $passo3$
DECLARE v_ok boolean;
BEGIN
  SELECT count(*) = 1 INTO v_ok FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients' AND column_name='deleted_by_client_at';
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('03_coluna_deleted_by_client_at_criada', 'existe em clients', v_ok);

  SELECT count(*) = 2 INTO v_ok FROM pg_proc WHERE proname IN ('client_erasure_plan', 'erase_client_data');
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('03_duas_funcoes_criadas', 'client_erasure_plan + erase_client_data', v_ok);

  SELECT NOT has_function_privilege('anon', 'public.client_erasure_plan(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.client_erasure_plan(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.client_erasure_plan(uuid)', 'EXECUTE')
    INTO v_ok;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('03_plan_so_service_role_executa', 'anon/authenticated sem EXECUTE, service_role com EXECUTE', v_ok);

  SELECT NOT has_function_privilege('anon', 'public.erase_client_data(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.erase_client_data(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.erase_client_data(uuid)', 'EXECUTE')
    INTO v_ok;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('03_erase_so_service_role_executa', 'anon/authenticated sem EXECUTE, service_role com EXECUTE', v_ok);
END $passo3$;

-- ============================================================================
-- PASSO 4 — client_erasure_plan devolve as contagens certas
-- ============================================================================
DO $passo4$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzle_ids WHERE chave='user_x');
  v_client_x_a uuid := (SELECT valor FROM zzle_ids WHERE chave='client_x_a');
  v_plan jsonb;
  v_entry jsonb;
BEGIN
  SET ROLE service_role;
  SELECT public.client_erasure_plan(v_user_x) INTO v_plan;
  RESET ROLE;

  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('04a_plano_tem_2_linhas_de_clients', format('%s entradas (esperado 2: A e B)', jsonb_array_length(v_plan)), jsonb_array_length(v_plan) = 2);

  SELECT e INTO v_entry FROM jsonb_array_elements(v_plan) e WHERE e->>'client_id' = v_client_x_a::text;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('04b_plano_client_x_a_anamnesis_1', format('%s', v_entry->>'anamnesis_count'), (v_entry->>'anamnesis_count')::int = 1);
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('04c_plano_client_x_a_2_storage_paths', format('%s', v_entry->'photo_storage_paths'), jsonb_array_length(v_entry->'photo_storage_paths') = 2);
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('04d_plano_client_x_a_consents_1', format('%s', v_entry->>'consents_count'), (v_entry->>'consents_count')::int = 1);
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('04e_plano_client_x_a_future_to_cancel_1', format('%s (só o pendente — cancelado/completed não contam)', v_entry->>'future_appointments_to_cancel'), (v_entry->>'future_appointments_to_cancel')::int = 1);
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('04f_plano_client_x_a_past_preserved_3', format('%s (cancelado+completed-antecipado+passado)', v_entry->>'past_appointments_preserved'), (v_entry->>'past_appointments_preserved')::int = 3);
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('04g_plano_client_x_a_notification_jobs_2', format('%s', v_entry->>'notification_jobs_count'), (v_entry->>'notification_jobs_count')::int = 2);
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('04h_plano_client_x_a_nao_esta_anonimizada_ainda', format('%s', v_entry->>'already_anonymized'), (v_entry->>'already_anonymized')::boolean = false);
END $passo4$;

-- ============================================================================
-- PASSO 5 — erase_client_data: executa e confere caso a caso
-- ============================================================================
DO $passo5$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzle_ids WHERE chave='user_x');
  v_owner_a uuid := (SELECT valor FROM zzle_ids WHERE chave='owner_a');
  v_owner_b uuid := (SELECT valor FROM zzle_ids WHERE chave='owner_b');
  v_client_x_a uuid := (SELECT valor FROM zzle_ids WHERE chave='client_x_a');
  v_client_x_b uuid := (SELECT valor FROM zzle_ids WHERE chave='client_x_b');
  v_appt_future_pending uuid := (SELECT valor FROM zzle_ids WHERE chave='appt_future_pending');
  v_appt_future_cancelled uuid := (SELECT valor FROM zzle_ids WHERE chave='appt_future_cancelled');
  v_appt_future_completed_early uuid := (SELECT valor FROM zzle_ids WHERE chave='appt_future_completed_early');
  v_appt_past_completed uuid := (SELECT valor FROM zzle_ids WHERE chave='appt_past_completed');
  v_appt_x_b_future uuid := (SELECT valor FROM zzle_ids WHERE chave='appt_x_b_future');
  v_result jsonb;
  v_row record;
  v_n int;
BEGIN
  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_x) INTO v_result;
  RESET ROLE;

  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('05a_erase_processou_2_linhas', format('%s entradas', jsonb_array_length(v_result)), jsonb_array_length(v_result) = 2);

  -- clients: ANONIMIZADA, nunca excluída.
  SELECT * INTO v_row FROM public.clients WHERE id = v_client_x_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('05b_clients_x_a_nao_foi_excluida', 'linha ainda existe', FOUND);
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('05c_clients_x_a_full_name_anonimizado', format('full_name=%s', v_row.full_name), v_row.full_name = 'Cliente excluída');
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('05d_clients_x_a_pii_zerada', format('phone=%s email=%s cpf=%s notes=%s avatar=%s how_found=%s', v_row.phone, v_row.email, v_row.cpf, v_row.notes, v_row.avatar_url, v_row.how_found),
     v_row.phone IS NULL AND v_row.email IS NULL AND v_row.birthday IS NULL AND v_row.cpf IS NULL AND v_row.notes IS NULL AND v_row.avatar_url IS NULL AND v_row.how_found IS NULL);
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('05e_clients_x_a_tags_zeradas', format('tags=%s', v_row.tags), v_row.tags = '{}');
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('05f_clients_x_a_user_id_nulo', 'user_id IS NULL', v_row.user_id IS NULL);
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('05g_clients_x_a_deleted_by_client_at_preenchido', format('%s', v_row.deleted_by_client_at), v_row.deleted_by_client_at IS NOT NULL);

  -- anamnese/fotos/consentimentos/mensagens/threads/bloqueio/conversas apagados.
  SELECT count(*) INTO v_n FROM public.client_anamnesis WHERE client_id = v_client_x_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05h_anamnesis_apagada', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM public.client_photos WHERE client_id = v_client_x_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05i_fotos_apagadas', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM public.whatsapp_messages WHERE client_id = v_client_x_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05j_whatsapp_messages_apagadas', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM public.whatsapp_central_threads WHERE client_id = v_client_x_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05k_central_threads_apagadas', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM public.whatsapp_confirmation_threads WHERE client_id = v_client_x_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05l_confirmation_threads_apagadas', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM public.whatsapp_blocked_recipients WHERE owner_id = v_owner_a AND phone_e164 = '+5511999990001';
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05m_bloqueio_whatsapp_estudio_a_apagado', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM public.conversations WHERE client_id = v_client_x_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05n_conversations_apagadas', format('%s (esperado 0)', v_n), v_n = 0);

  -- consentimentos: NUNCA apagados, só PII zerada.
  SELECT count(*) INTO v_n FROM public.client_consents WHERE client_id = v_client_x_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05o_consentimento_nao_foi_apagado', format('%s (esperado 1, continua existindo)', v_n), v_n = 1);
  SELECT signer_name, evidence_ip, evidence_user_agent, choice, consent_type INTO v_row FROM public.client_consents WHERE client_id = v_client_x_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('05p_consentimento_pii_zerada_prova_minima_intacta', format('signer=%s choice=%s type=%s', v_row.signer_name, v_row.choice, v_row.consent_type),
     v_row.signer_name IS NULL AND v_row.choice = 'granted' AND v_row.consent_type = 'health_data');

  -- agendamentos: futuro pendente CANCELADO; já-cancelado permanece
  -- cancelado; completed-antecipado e passado-completed preservados com notes.
  SELECT status INTO v_row FROM public.appointments WHERE id = v_appt_future_pending;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05q_agendamento_futuro_pendente_cancelado', format('status=%s', v_row.status), v_row.status = 'cancelled');

  SELECT status INTO v_row FROM public.appointments WHERE id = v_appt_future_cancelled;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05r_agendamento_ja_cancelado_permanece_cancelado', format('status=%s', v_row.status), v_row.status = 'cancelled');

  SELECT status INTO v_row FROM public.appointments WHERE id = v_appt_future_completed_early;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05s_agendamento_completed_antecipado_preservado', format('status=%s', v_row.status), v_row.status = 'completed');

  SELECT status, notes INTO v_row FROM public.appointments WHERE id = v_appt_past_completed;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('05t_agendamento_passado_preservado_com_notes', format('status=%s notes=%s', v_row.status, v_row.notes), v_row.status = 'completed' AND v_row.notes = 'nota do agendamento passado');

  -- notification_jobs: TODOS apagados (pendente E já-sent), nenhum pendente sobra.
  SELECT count(*) INTO v_n FROM public.notification_jobs WHERE client_id = v_client_x_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05u_todos_notification_jobs_apagados', format('%s (esperado 0)', v_n), v_n = 0);
  SELECT count(*) INTO v_n FROM public.notification_jobs WHERE appointment_id = v_appt_future_pending AND status = 'pending';
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05v_nenhum_job_pendente_para_agendamento_cancelado', format('%s (esperado 0)', v_n), v_n = 0);

  -- aviso no sino (idempotente via dedupe_key) — 1 por estúdio vinculado,
  -- sem nenhum dado pessoal no corpo.
  SELECT count(*) INTO v_n FROM public.app_notifications
    WHERE owner_id = v_owner_a AND dedupe_key = 'client_erasure:' || v_client_x_a::text AND kind = 'client_account_deleted';
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05w_aviso_no_sino_estudio_a', format('%s', v_n), v_n = 1);
  SELECT count(*) INTO v_n FROM public.app_notifications
    WHERE owner_id = v_owner_b AND dedupe_key = 'client_erasure:' || v_client_x_b::text AND kind = 'client_account_deleted';
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05x_aviso_no_sino_estudio_b', format('%s', v_n), v_n = 1);

  -- estúdio B: agendamento futuro da cliente X também cancelado.
  SELECT status INTO v_row FROM public.appointments WHERE id = v_appt_x_b_future;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('05y_agendamento_futuro_estudio_b_tambem_cancelado', format('status=%s', v_row.status), v_row.status = 'cancelled');
END $passo5$;

-- ============================================================================
-- PASSO 6 — isolamento: outra cliente de A e estúdio B intactos
-- ============================================================================
DO $passo6$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzle_ids WHERE chave='owner_a');
  v_owner_b uuid := (SELECT valor FROM zzle_ids WHERE chave='owner_b');
  v_client_other_a uuid := (SELECT valor FROM zzle_ids WHERE chave='client_other_a');
  v_appt_other_a uuid := (SELECT valor FROM zzle_ids WHERE chave='appt_other_a');
  v_row record;
  v_n int;
BEGIN
  SELECT full_name, phone, user_id INTO v_row FROM public.clients WHERE id = v_client_other_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('06a_outra_cliente_a_intacta', format('full_name=%s phone=%s', v_row.full_name, v_row.phone),
     v_row.full_name = 'zz-fixture Outra Cliente A' AND v_row.phone = '+5511999990002' AND v_row.user_id IS NOT NULL);

  SELECT count(*) INTO v_n FROM public.client_anamnesis WHERE client_id = v_client_other_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('06b_outra_cliente_a_anamnesis_intacta', format('%s', v_n), v_n = 1);

  SELECT count(*) INTO v_n FROM public.client_photos WHERE client_id = v_client_other_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('06c_outra_cliente_a_fotos_intactas', format('%s', v_n), v_n = 1);

  SELECT count(*) INTO v_n FROM public.client_consents WHERE client_id = v_client_other_a AND signer_name = 'Outra Nome';
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('06d_outra_cliente_a_consentimento_intacto', format('%s', v_n), v_n = 1);

  SELECT status INTO v_row FROM public.appointments WHERE id = v_appt_other_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('06e_outra_cliente_a_agendamento_nao_cancelado', format('status=%s', v_row.status), v_row.status = 'pending');

  SELECT count(*) INTO v_n FROM public.notification_jobs WHERE appointment_id = v_appt_other_a;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('06f_outra_cliente_a_notification_job_intacto', format('%s', v_n), v_n = 1);

  -- o bloqueio de WhatsApp do ESTÚDIO B de um telefone QUE NÃO é da cliente
  -- X nunca foi tocado (prova de isolamento por telefone/estúdio).
  SELECT count(*) INTO v_n FROM public.whatsapp_blocked_recipients WHERE owner_id = v_owner_b AND phone_e164 = '+5511999990003';
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('06g_bloqueio_whatsapp_estudio_b_de_outro_telefone_intacto', format('%s (esperado 1, nunca tocado)', v_n), v_n = 1);
END $passo6$;

-- ============================================================================
-- PASSO 7 — UNIQUE (owner_id, user_id) liberado: novo cadastro funciona
-- ============================================================================
DO $passo7$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzle_ids WHERE chave='owner_a');
  v_user_x uuid := (SELECT valor FROM zzle_ids WHERE chave='user_x');
  v_new_id uuid;
BEGIN
  INSERT INTO public.clients (owner_id, full_name, phone, user_id)
    VALUES (v_owner_a, 'zz-fixture Cliente X (novo cadastro)', '+5511999990099', v_user_x)
    RETURNING id INTO v_new_id;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('07a_unique_owner_user_liberado_novo_cadastro_funciona', format('id=%s', v_new_id), v_new_id IS NOT NULL);
  -- desfaz pra não interferir no passo de idempotência (que espera 0 linhas
  -- com user_id = v_user_x antes de chamar erase_client_data de novo).
  DELETE FROM public.clients WHERE id = v_new_id;
END $passo7$;

-- ============================================================================
-- PASSO 8 — idempotência: 2ª chamada não falha e não muda nada
-- ============================================================================
DO $passo8$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzle_ids WHERE chave='user_x');
  v_client_x_a uuid := (SELECT valor FROM zzle_ids WHERE chave='client_x_a');
  v_result jsonb;
  v_full_name_antes text; v_full_name_depois text;
BEGIN
  SELECT full_name INTO v_full_name_antes FROM public.clients WHERE id = v_client_x_a;

  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_x) INTO v_result;
  RESET ROLE;

  SELECT full_name INTO v_full_name_depois FROM public.clients WHERE id = v_client_x_a;

  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('08a_segunda_chamada_nao_encontra_mais_nenhuma_linha', format('%s entradas (esperado 0, user_id já é NULL)', jsonb_array_length(v_result)), jsonb_array_length(v_result) = 0);
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('08b_segunda_chamada_nao_mudou_nada', format('antes=%s depois=%s', v_full_name_antes, v_full_name_depois), v_full_name_antes = v_full_name_depois);
END $passo8$;

-- ============================================================================
-- PASSO 9 — permissão: anon/authenticated não executam
-- ============================================================================
DO $passo9$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzle_ids WHERE chave='user_x');
  v_rejeitou boolean;
BEGIN
  SET ROLE authenticated;
  BEGIN
    PERFORM public.erase_client_data(v_user_x);
    v_rejeitou := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejeitou := true;
  END;
  RESET ROLE;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('09a_authenticated_nao_executa_erase', 'insufficient_privilege', v_rejeitou);

  SET ROLE anon;
  BEGIN
    PERFORM public.client_erasure_plan(v_user_x);
    v_rejeitou := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejeitou := true;
  END;
  RESET ROLE;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('09b_anon_nao_executa_plan', 'insufficient_privilege', v_rejeitou);
END $passo9$;

-- ============================================================================
-- PASSO 10 — aplica o rollback (DDL colado, igual ao arquivo real)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS backup_rollback_fase1;
REVOKE ALL ON SCHEMA backup_rollback_fase1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_fase1.clients_deleted_by_client_at_backup (
  client_id uuid, deleted_by_client_at timestamptz, backed_up_at timestamptz
);
INSERT INTO backup_rollback_fase1.clients_deleted_by_client_at_backup
  SELECT id, deleted_by_client_at, now() FROM public.clients WHERE deleted_by_client_at IS NOT NULL;

DO $passo10_contagem$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM backup_rollback_fase1.clients_deleted_by_client_at_backup;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('10a_backup_preserva_linhas_anonimizadas_antes_do_drop', format('%s linha(s) no backup', v_n), v_n = 2);
END $passo10_contagem$;

REVOKE ALL ON FUNCTION public.erase_client_data(uuid) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.erase_client_data(uuid);
REVOKE ALL ON FUNCTION public.client_erasure_plan(uuid) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.client_erasure_plan(uuid);
ALTER TABLE public.clients DROP COLUMN IF EXISTS deleted_by_client_at;
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PASSO 11 — confirma que coluna/funções somem, com backup preservado
-- ============================================================================
DO $passo11$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients' AND column_name='deleted_by_client_at';
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('11a_coluna_removida_pelo_rollback', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('client_erasure_plan', 'erase_client_data');
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('11b_funcoes_removidas_pelo_rollback', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM backup_rollback_fase1.clients_deleted_by_client_at_backup;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('11c_backup_sobrevive_ao_drop', format('%s linha(s)', v_n), v_n = 2);
END $passo11$;

-- ============================================================================
-- PASSO 12 — reaplica a migração (DDL colado de novo) e confirma que volta
-- ============================================================================
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS deleted_by_client_at timestamptz NULL;

CREATE OR REPLACE FUNCTION public.client_erasure_plan(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('client_id', c.id)), '[]'::jsonb) INTO _result
  FROM public.clients c WHERE c.user_id = _user_id;
  RETURN _result;
END;
$$;
REVOKE ALL ON FUNCTION public.client_erasure_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_erasure_plan(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.erase_client_data(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN '[]'::jsonb;
END;
$$;
REVOKE ALL ON FUNCTION public.erase_client_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_client_data(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';

DO $passo12$
DECLARE v_ok boolean; v_plan jsonb;
BEGIN
  SELECT count(*) = 1 INTO v_ok FROM information_schema.columns
    WHERE table_schema='public' AND table_name='clients' AND column_name='deleted_by_client_at';
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES ('12a_coluna_volta_depois_de_reaplicar', 'existe de novo', v_ok);

  SET ROLE service_role;
  SELECT public.client_erasure_plan(gen_random_uuid()) INTO v_plan;
  RESET ROLE;
  INSERT INTO zzle_results (caso, detalhe, passou) VALUES
    ('12b_plan_funciona_normalmente_apos_reaplicar', format('%s', v_plan), v_plan = '[]'::jsonb);
END $passo12$;

-- Saída consolidada numa ÚNICA consulta (JSON).
SELECT jsonb_build_object(
  'casos', (
    SELECT jsonb_agg(jsonb_build_object('ordem', ordem, 'caso', caso, 'detalhe', detalhe, 'passou', passou) ORDER BY ordem)
    FROM zzle_results
  ),
  'resumo', (
    SELECT jsonb_build_object('passaram', count(*) FILTER (WHERE passou), 'falharam', count(*) FILTER (WHERE NOT passou))
    FROM zzle_results
  )
) AS resultado;

ROLLBACK;
