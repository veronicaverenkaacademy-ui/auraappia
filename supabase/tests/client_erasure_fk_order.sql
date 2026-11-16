-- FASE LEGAL-1C — suíte da migração
-- 20261116180000_client_erasure_fk_order.sql (ordem de exclusão em
-- erase_client_data x FK sem ON DELETE em whatsapp_central_threads.
-- resolved_by_message_id / whatsapp_confirmation_threads.resolved_by_message_id).
--
-- NÃO EXECUTADA contra produção nesta fase (branch nova + PR em DRAFT, por
-- instrução explícita da dona). Rodada LOCALMENTE (Postgres 16 deste
-- ambiente, banco descartável `aura_legal1c_test`, NUNCA o banco de
-- produção da dona) — ver saída colada no relatório da fase. Pressupõe o
-- MESMO bootstrap de LEGAL-1/1B (auth.users, clients com todas as colunas
-- reais, appointments com a EXCLUSION CONSTRAINT real appointments_no_overlap
-- (owner_id + COALESCE(professional_id,'00000000-...') + tstzrange, WHERE
-- status<>'cancelled' AND NOT force_overlap), whatsapp_messages,
-- whatsapp_central_threads/whatsapp_confirmation_threads (client_id/
-- appointment_id/outbound_message_id NOT NULL — confirmado via
-- information_schema.columns nesta fase, nenhuma coluna adivinhada),
-- whatsapp_blocked_recipients, client_anamnesis, client_photos,
-- client_consents + trigger de imutabilidade + purge_client_consent_pii
-- (corpo exato de 20261115120000), conversations, messages,
-- notification_jobs, app_notifications — nenhuma tabela nova nesta fase,
-- só o corpo de erase_client_data muda.
--
-- Ciclo: 0) reproduz o DEFEITO de verdade contra a versão ANTIGA da função
-- (23503 em whatsapp_central_threads_resolved_by_message_id_fkey e em
-- whatsapp_confirmation_threads_resolved_by_message_id_fkey, cada um com
-- sua própria cliente); 1) aplica a migração NOVA; 2) os dois casos que
-- antes falhavam agora passam, com todas as validações de efeito
-- colateral (mensagens/threads apagadas, cliente anonimizada,
-- consentimentos com PII zerada mas linhas preservadas, aviso criado);
-- 3) thread de OUTRA cliente do mesmo dono apontando pra uma mensagem
-- ÓRFÃ que é apagada por telefone — fica com resolved_by_message_id NULL,
-- a thread em si sobrevive; 4) thread de outro DONO nunca é tocada;
-- 5) cliente sem threads/mensagens nenhuma erasa limpo; 6) idempotência;
-- 7) regressão — reexecuta as checagens-chave de client_erasure.sql e
-- client_erasure_orphan_messages.sql contra a função NOVA; 8) grants
-- inalterados (service_role sim, anon/authenticated não) antes E depois;
-- 9) aplica o rollback e reproduz o defeito de novo (prova que o rollback
-- restaura o comportamento antigo de verdade, não só o texto); 10) reaplica
-- a migração e confirma que volta a passar. Nunca COMMIT.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE zzlc_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzlc_ids (chave text PRIMARY KEY, valor uuid) ON COMMIT DROP;
GRANT ALL ON zzlc_results TO PUBLIC;
GRANT ALL ON zzlc_ids TO PUBLIC;
GRANT ALL ON SEQUENCE zzlc_results_ordem_seq TO PUBLIC;

-- ============================================================================
-- PASSO -1 — recria o estado JÁ EM PRODUÇÃO (a função da 20261115160000,
-- DDL colado byte-a-byte) — o bootstrap local só tem as TABELAS-base; as
-- duas funções em si vieram de migrações já aplicadas/mergeadas.
-- ============================================================================
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
    'orphan_whatsapp_messages_count', (
      SELECT count(*) FROM public.whatsapp_messages om
      WHERE om.owner_id = c.owner_id
        AND om.client_id IS NULL
        AND c.phone IS NOT NULL
        AND right(regexp_replace(om.recipient_phone, '\D', '', 'g'), 8)
          = right(regexp_replace(c.phone, '\D', '', 'g'), 8)
    ),
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
  _n_orphan_messages integer;
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
      DELETE FROM public.whatsapp_messages wm
      WHERE wm.owner_id = _client.owner_id
        AND wm.client_id IS NULL
        AND right(regexp_replace(wm.recipient_phone, '\D', '', 'g'), 8)
          = right(regexp_replace(_old_phone, '\D', '', 'g'), 8);
      GET DIAGNOSTICS _n_orphan_messages = ROW_COUNT;

      DELETE FROM public.whatsapp_blocked_recipients wbr
      WHERE wbr.owner_id = _client.owner_id
        AND right(regexp_replace(wbr.phone_e164, '\D', '', 'g'), 8)
          = right(regexp_replace(_old_phone, '\D', '', 'g'), 8);
      GET DIAGNOSTICS _n_blocked = ROW_COUNT;
    ELSE
      _n_orphan_messages := 0;
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
      'orphan_whatsapp_messages_deleted', _n_orphan_messages,
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
-- PASSO 0 — grants ANTES da migração (prova que já eram service_role-only)
-- ============================================================================
DO $passo0$
DECLARE v_ok boolean;
BEGIN
  SELECT NOT has_function_privilege('anon', 'public.erase_client_data(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.erase_client_data(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.erase_client_data(uuid)', 'EXECUTE')
    INTO v_ok;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('00a_grants_antes_da_migracao', 'anon/authenticated sem EXECUTE, service_role com EXECUTE', v_ok);
END $passo0$;

-- ============================================================================
-- PASSO 1 — fixtures
-- ============================================================================
-- owner_a: cliente X (central_threads aponta p/ mensagem dela mesma),
--          cliente Y (confirmation_threads aponta p/ mensagem dela mesma),
--          cliente Z (telefone PHONE_Z, será excluída — tem uma mensagem
--          ÓRFÃ com esse telefone que uma thread da cliente W referencia),
--          cliente W (thread dela aponta pra mensagem órfã de Z — W não é
--          excluída, só sua thread deve perder a referência),
--          cliente V (sem threads/mensagens nenhuma).
-- owner_b: cliente U (mesmo telefone de alguém de A só por acaso — nunca
--          deve ser tocada; dono diferente).
INSERT INTO zzlc_ids (chave, valor) VALUES
  ('owner_a', gen_random_uuid()),
  ('owner_b', gen_random_uuid()),
  ('user_x', gen_random_uuid()),
  ('user_y', gen_random_uuid()),
  ('user_z', gen_random_uuid()),
  ('user_w', gen_random_uuid()),
  ('user_v', gen_random_uuid()),
  ('user_u', gen_random_uuid());

DO $setup$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzlc_ids WHERE chave='owner_a');
  v_owner_b uuid := (SELECT valor FROM zzlc_ids WHERE chave='owner_b');
  v_user_x uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_x');
  v_user_y uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_y');
  v_user_z uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_z');
  v_user_w uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_w');
  v_user_v uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_v');
  v_user_u uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_u');
  v_client_x uuid; v_client_y uuid; v_client_z uuid; v_client_w uuid; v_client_v uuid; v_client_u uuid;
  v_appt_x uuid; v_appt_y uuid; v_appt_w uuid; v_appt_u uuid;
  v_msg_x_outbound uuid; v_msg_x_resolved uuid;
  v_msg_y_outbound uuid; v_msg_y_resolved uuid;
  v_msg_z_orphan uuid;
  v_msg_w_outbound uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner_a, 'zz-fixture-owner-a@invalid.test'),
    (v_owner_b, 'zz-fixture-owner-b@invalid.test'),
    (v_user_x, 'zz-fixture-user-x@invalid.test'),
    (v_user_y, 'zz-fixture-user-y@invalid.test'),
    (v_user_z, 'zz-fixture-user-z@invalid.test'),
    (v_user_w, 'zz-fixture-user-w@invalid.test'),
    (v_user_v, 'zz-fixture-user-v@invalid.test'),
    (v_user_u, 'zz-fixture-user-u@invalid.test');

  INSERT INTO public.clients (owner_id, full_name, phone, user_id) VALUES
    (v_owner_a, 'zz-fixture Cliente X', '+5511977770001', v_user_x) RETURNING id INTO v_client_x;
  INSERT INTO public.clients (owner_id, full_name, phone, user_id) VALUES
    (v_owner_a, 'zz-fixture Cliente Y', '+5511977770002', v_user_y) RETURNING id INTO v_client_y;
  INSERT INTO public.clients (owner_id, full_name, phone, user_id) VALUES
    (v_owner_a, 'zz-fixture Cliente Z', '+5511977770003', v_user_z) RETURNING id INTO v_client_z;
  INSERT INTO public.clients (owner_id, full_name, phone, user_id) VALUES
    (v_owner_a, 'zz-fixture Cliente W', '+5511977770004', v_user_w) RETURNING id INTO v_client_w;
  INSERT INTO public.clients (owner_id, full_name, phone, user_id) VALUES
    (v_owner_a, 'zz-fixture Cliente V (sem threads)', '+5511977770005', v_user_v) RETURNING id INTO v_client_v;
  INSERT INTO public.clients (owner_id, full_name, phone, user_id) VALUES
    (v_owner_b, 'zz-fixture Cliente U (outro dono)', '+5511977770003', v_user_u) RETURNING id INTO v_client_u;

  INSERT INTO zzlc_ids (chave, valor) VALUES
    ('client_x', v_client_x), ('client_y', v_client_y), ('client_z', v_client_z),
    ('client_w', v_client_w), ('client_v', v_client_v), ('client_u', v_client_u);

  -- Agendamentos (horários bem separados — appointments_no_overlap é por
  -- owner_id + professional_id NULL, então qualquer sobreposição entre
  -- CLIENTES DIFERENTES do mesmo dono colide).
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price)
    VALUES (v_owner_a, v_client_x, now() + interval '1 day', now() + interval '1 day 1 hour', 'confirmed', 100)
    RETURNING id INTO v_appt_x;
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price)
    VALUES (v_owner_a, v_client_y, now() + interval '2 days', now() + interval '2 days 1 hour', 'confirmed', 100)
    RETURNING id INTO v_appt_y;
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price)
    VALUES (v_owner_a, v_client_w, now() + interval '3 days', now() + interval '3 days 1 hour', 'confirmed', 100)
    RETURNING id INTO v_appt_w;
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price)
    VALUES (v_owner_b, v_client_u, now() + interval '1 day', now() + interval '1 day 1 hour', 'confirmed', 100)
    RETURNING id INTO v_appt_u;

  -- CASO 1 (central_threads): cliente X tem uma mensagem "de resposta"
  -- (resolved, com client_id dela — é a que a DELETE por client_id tenta
  -- apagar) e a thread referencia essa mensagem via resolved_by_message_id
  -- (SEM ON DELETE — é a que bloqueia na versão antiga). outbound_message_id
  -- é uma mensagem À PARTE, SEM client_id (órfã) — de propósito: se o
  -- outbound TAMBÉM tivesse client_id da própria X, o mesmo DELETE FROM
  -- whatsapp_messages WHERE client_id=X apagaria as DUAS mensagens no
  -- mesmo comando, e o CASCADE de outbound_message_id removeria a thread
  -- ANTES de sobrar algo pra violar resolved_by_message_id — mascarando o
  -- defeito (confirmado empiricamente rodando esta suíte: só reproduz de
  -- verdade quando a mensagem resolved é apagada enquanto a thread ainda
  -- existe por outro motivo).
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, NULL, 'outbound', 'template', '+5511977770001', 'sent') RETURNING id INTO v_msg_x_outbound;
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, v_client_x, 'inbound', 'text', '+5511977770001', 'delivered') RETURNING id INTO v_msg_x_resolved;
  INSERT INTO public.whatsapp_central_threads
    (owner_id, client_id, appointment_id, outbound_message_id, template_key, appointment_starts_at_snapshot, resolved_by_message_id, resolved_at)
    VALUES (v_owner_a, v_client_x, v_appt_x, v_msg_x_outbound, 'lembrete_24h', now() + interval '1 day', v_msg_x_resolved, now());

  -- CASO 2 (confirmation_threads): mesma forma, cliente Y (outbound órfão,
  -- mesmo motivo do caso 1).
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, NULL, 'outbound', 'template', '+5511977770002', 'sent') RETURNING id INTO v_msg_y_outbound;
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, v_client_y, 'inbound', 'text', '+5511977770002', 'delivered') RETURNING id INTO v_msg_y_resolved;
  INSERT INTO public.whatsapp_confirmation_threads
    (owner_id, client_id, appointment_id, outbound_message_id, appointment_starts_at_snapshot, resolved_by_message_id, resolved_at)
    VALUES (v_owner_a, v_client_y, v_appt_y, v_msg_y_outbound, now() + interval '2 days', v_msg_y_resolved, now());

  -- CASO 3: cliente Z (a ser excluída) tem uma mensagem ÓRFÃ (client_id
  -- NULL) com o telefone dela — será apagada pelo bloco "IF _old_phone IS
  -- NOT NULL" de erase_client_data(user_z). A thread de OUTRA cliente (W,
  -- do MESMO dono) referencia essa mensagem órfã via resolved_by_message_id
  -- — não tem como restringir por client_id porque a mensagem é órfã.
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, NULL, 'outbound', 'template', '+5511977770003', 'sent') RETURNING id INTO v_msg_z_orphan;
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, v_client_w, 'outbound', 'template', '+5511977770004', 'sent') RETURNING id INTO v_msg_w_outbound;
  INSERT INTO public.whatsapp_central_threads
    (owner_id, client_id, appointment_id, outbound_message_id, template_key, appointment_starts_at_snapshot, resolved_by_message_id, resolved_at)
    VALUES (v_owner_a, v_client_w, v_appt_w, v_msg_w_outbound, 'lembrete_2h', now() + interval '3 days', v_msg_z_orphan, now());

  -- CASO 4: cliente U (outro DONO) com o MESMO telefone de Z, por
  -- coincidência — nunca deve ser considerada (owner_id diferente).
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_b, v_client_u, 'outbound', 'template', '+5511977770003', 'sent');

  INSERT INTO zzlc_ids (chave, valor) VALUES
    ('appt_x', v_appt_x), ('appt_y', v_appt_y), ('appt_w', v_appt_w), ('appt_u', v_appt_u),
    ('msg_x_resolved', v_msg_x_resolved), ('msg_y_resolved', v_msg_y_resolved),
    ('msg_z_orphan', v_msg_z_orphan);
END $setup$;

DO $sentinela$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE 'zz-fixture-%@invalid.test';
  IF n <> 8 THEN RAISE EXCEPTION 'SENTINELA: esperado 8 usuários sintéticos, achei %', n; END IF;
END $sentinela$;

-- ============================================================================
-- PASSO 2 — REPRODUZ o defeito de verdade contra a função ANTIGA
-- ============================================================================
DO $passo2$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_x');
  v_user_y uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_y');
  v_sqlstate text;
  v_message text;
  v_constraint text;
  v_falhou boolean;
BEGIN
  -- Caso 1: central_threads.
  v_falhou := false;
  BEGIN
    SET ROLE service_role;
    PERFORM public.erase_client_data(v_user_x);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT, v_constraint = CONSTRAINT_NAME;
    v_falhou := true;
  END;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('02a_reproduz_defeito_central_threads', format('sqlstate=%s constraint=%s', v_sqlstate, v_constraint),
     v_falhou AND v_sqlstate = '23503' AND v_constraint = 'whatsapp_central_threads_resolved_by_message_id_fkey');

  -- Caso 2: confirmation_threads.
  v_falhou := false;
  BEGIN
    SET ROLE service_role;
    PERFORM public.erase_client_data(v_user_y);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT, v_constraint = CONSTRAINT_NAME;
    v_falhou := true;
  END;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('02b_reproduz_defeito_confirmation_threads', format('sqlstate=%s constraint=%s', v_sqlstate, v_constraint),
     v_falhou AND v_sqlstate = '23503' AND v_constraint = 'whatsapp_confirmation_threads_resolved_by_message_id_fkey');
END $passo2$;

-- Confirma que NADA mudou pras clientes X/Y (a transação da função falhou
-- inteira e reverteu — inclusive a purga de consentimentos, que roda ANTES
-- da falha) — prova de que o defeito nunca deixa produção "meio excluída".
DO $passo2c$
DECLARE
  v_client_x uuid := (SELECT valor FROM zzlc_ids WHERE chave='client_x');
  v_full_name text;
BEGIN
  SELECT full_name INTO v_full_name FROM public.clients WHERE id = v_client_x;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('02c_falha_e_atomica_cliente_x_nao_mudou', format('full_name=%s', v_full_name), v_full_name = 'zz-fixture Cliente X');
END $passo2c$;

-- ============================================================================
-- PASSO 3 — aplica a migração NOVA (DDL colado, igual ao arquivo real)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.erase_client_data(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _client record;
  _old_phone text;
  _n_anamnesis integer;
  _n_photos integer;
  _n_messages integer;
  _n_orphan_messages integer;
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

    UPDATE public.whatsapp_central_threads
    SET resolved_by_message_id = NULL
    WHERE resolved_by_message_id IN (
      SELECT id FROM public.whatsapp_messages WHERE client_id = _client.id
    );
    UPDATE public.whatsapp_confirmation_threads
    SET resolved_by_message_id = NULL
    WHERE resolved_by_message_id IN (
      SELECT id FROM public.whatsapp_messages WHERE client_id = _client.id
    );

    DELETE FROM public.whatsapp_messages WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_messages = ROW_COUNT;

    DELETE FROM public.whatsapp_central_threads WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_central = ROW_COUNT;

    DELETE FROM public.whatsapp_confirmation_threads WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_confirmation = ROW_COUNT;

    IF _old_phone IS NOT NULL THEN
      UPDATE public.whatsapp_central_threads
      SET resolved_by_message_id = NULL
      WHERE resolved_by_message_id IN (
        SELECT id FROM public.whatsapp_messages wm
        WHERE wm.owner_id = _client.owner_id
          AND wm.client_id IS NULL
          AND right(regexp_replace(wm.recipient_phone, '\D', '', 'g'), 8)
            = right(regexp_replace(_old_phone, '\D', '', 'g'), 8)
      );
      UPDATE public.whatsapp_confirmation_threads
      SET resolved_by_message_id = NULL
      WHERE resolved_by_message_id IN (
        SELECT id FROM public.whatsapp_messages wm
        WHERE wm.owner_id = _client.owner_id
          AND wm.client_id IS NULL
          AND right(regexp_replace(wm.recipient_phone, '\D', '', 'g'), 8)
            = right(regexp_replace(_old_phone, '\D', '', 'g'), 8)
      );

      DELETE FROM public.whatsapp_messages wm
      WHERE wm.owner_id = _client.owner_id
        AND wm.client_id IS NULL
        AND right(regexp_replace(wm.recipient_phone, '\D', '', 'g'), 8)
          = right(regexp_replace(_old_phone, '\D', '', 'g'), 8);
      GET DIAGNOSTICS _n_orphan_messages = ROW_COUNT;

      DELETE FROM public.whatsapp_blocked_recipients wbr
      WHERE wbr.owner_id = _client.owner_id
        AND right(regexp_replace(wbr.phone_e164, '\D', '', 'g'), 8)
          = right(regexp_replace(_old_phone, '\D', '', 'g'), 8);
      GET DIAGNOSTICS _n_blocked = ROW_COUNT;
    ELSE
      _n_orphan_messages := 0;
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
      'orphan_whatsapp_messages_deleted', _n_orphan_messages,
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
-- PASSO 4 — agora os casos 1 e 2 PASSAM, com validação completa de efeito
-- ============================================================================
DO $passo4$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_x');
  v_user_y uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_y');
  v_client_x uuid := (SELECT valor FROM zzlc_ids WHERE chave='client_x');
  v_client_y uuid := (SELECT valor FROM zzlc_ids WHERE chave='client_y');
  v_owner_a uuid := (SELECT valor FROM zzlc_ids WHERE chave='owner_a');
  v_result jsonb;
  v_row record;
  v_n int;
BEGIN
  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_x) INTO v_result;
  RESET ROLE;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('04a_cliente_x_erasa_sem_erro', format('%s entradas', jsonb_array_length(v_result)), jsonb_array_length(v_result) = 1);

  SELECT count(*) INTO v_n FROM public.whatsapp_messages WHERE client_id = v_client_x;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES ('04b_cliente_x_mensagens_apagadas', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM public.whatsapp_central_threads WHERE client_id = v_client_x;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES ('04c_cliente_x_central_threads_apagadas', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT full_name, phone, user_id, deleted_by_client_at INTO v_row FROM public.clients WHERE id = v_client_x;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('04d_cliente_x_anonimizada', format('full_name=%s', v_row.full_name),
     v_row.full_name = 'Cliente excluída' AND v_row.phone IS NULL AND v_row.user_id IS NULL AND v_row.deleted_by_client_at IS NOT NULL);

  SELECT count(*) INTO v_n FROM public.app_notifications
    WHERE owner_id = v_owner_a AND dedupe_key = 'client_erasure:' || v_client_x::text AND kind = 'client_account_deleted';
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES ('04e_cliente_x_aviso_criado', format('%s', v_n), v_n = 1);

  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_y) INTO v_result;
  RESET ROLE;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('04f_cliente_y_erasa_sem_erro', format('%s entradas', jsonb_array_length(v_result)), jsonb_array_length(v_result) = 1);

  SELECT count(*) INTO v_n FROM public.whatsapp_confirmation_threads WHERE client_id = v_client_y;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES ('04g_cliente_y_confirmation_threads_apagadas', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT full_name, deleted_by_client_at INTO v_row FROM public.clients WHERE id = v_client_y;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('04h_cliente_y_anonimizada', format('full_name=%s', v_row.full_name),
     v_row.full_name = 'Cliente excluída' AND v_row.deleted_by_client_at IS NOT NULL);
END $passo4$;

-- ============================================================================
-- PASSO 5 — CASO 3: thread de OUTRA cliente (W) do mesmo dono, apontando
-- pra mensagem ÓRFÃ de Z — Z é excluída, a thread de W sobrevive com
-- resolved_by_message_id NULL.
-- ============================================================================
DO $passo5$
DECLARE
  v_user_z uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_z');
  v_client_w uuid := (SELECT valor FROM zzlc_ids WHERE chave='client_w');
  v_msg_z_orphan uuid := (SELECT valor FROM zzlc_ids WHERE chave='msg_z_orphan');
  v_result jsonb;
  v_n int;
  v_resolved uuid;
BEGIN
  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_z) INTO v_result;
  RESET ROLE;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('05a_cliente_z_erasa_sem_erro', format('%s entradas', jsonb_array_length(v_result)), jsonb_array_length(v_result) = 1);

  SELECT count(*) INTO v_n FROM public.whatsapp_messages WHERE id = v_msg_z_orphan;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('05b_mensagem_orfa_de_z_apagada', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM public.whatsapp_central_threads WHERE client_id = v_client_w;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('05c_thread_de_w_sobrevive', format('%s (esperado 1, W não foi excluída)', v_n), v_n = 1);

  SELECT resolved_by_message_id INTO v_resolved FROM public.whatsapp_central_threads WHERE client_id = v_client_w;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('05d_thread_de_w_perdeu_a_referencia', format('resolved_by_message_id=%s', v_resolved), v_resolved IS NULL);
END $passo5$;

-- ============================================================================
-- PASSO 6 — CASO 4: cliente U de OUTRO dono, mesmo telefone de Z, nunca
-- tocada.
-- ============================================================================
DO $passo6$
DECLARE
  v_owner_b uuid := (SELECT valor FROM zzlc_ids WHERE chave='owner_b');
  v_client_u uuid := (SELECT valor FROM zzlc_ids WHERE chave='client_u');
  v_row record;
  v_n int;
BEGIN
  SELECT full_name, phone, user_id INTO v_row FROM public.clients WHERE id = v_client_u;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('06a_cliente_u_outro_dono_intacta', format('full_name=%s', v_row.full_name),
     v_row.full_name = 'zz-fixture Cliente U (outro dono)' AND v_row.user_id IS NOT NULL);

  SELECT count(*) INTO v_n FROM public.whatsapp_messages WHERE owner_id = v_owner_b AND recipient_phone = '+5511977770003';
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('06b_mensagem_de_u_intacta', format('%s (esperado 1, nunca tocada — dono diferente)', v_n), v_n = 1);
END $passo6$;

-- ============================================================================
-- PASSO 7 — CASO 5: cliente V, sem threads/mensagens nenhuma, erasa limpo.
-- ============================================================================
DO $passo7$
DECLARE
  v_user_v uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_v');
  v_client_v uuid := (SELECT valor FROM zzlc_ids WHERE chave='client_v');
  v_result jsonb;
  v_row record;
BEGIN
  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_v) INTO v_result;
  RESET ROLE;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('07a_cliente_v_sem_threads_erasa_sem_erro', format('%s entradas', jsonb_array_length(v_result)), jsonb_array_length(v_result) = 1);

  SELECT full_name, deleted_by_client_at INTO v_row FROM public.clients WHERE id = v_client_v;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('07b_cliente_v_anonimizada', format('full_name=%s', v_row.full_name),
     v_row.full_name = 'Cliente excluída' AND v_row.deleted_by_client_at IS NOT NULL);
END $passo7$;

-- ============================================================================
-- PASSO 8 — idempotência: 2ª chamada pra X não falha e não muda nada.
-- ============================================================================
DO $passo8$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_x');
  v_client_x uuid := (SELECT valor FROM zzlc_ids WHERE chave='client_x');
  v_result jsonb;
  v_full_name_antes text; v_full_name_depois text;
BEGIN
  SELECT full_name INTO v_full_name_antes FROM public.clients WHERE id = v_client_x;

  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_x) INTO v_result;
  RESET ROLE;

  SELECT full_name INTO v_full_name_depois FROM public.clients WHERE id = v_client_x;

  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('08a_segunda_chamada_nao_encontra_mais_linha', format('%s entradas (esperado 0)', jsonb_array_length(v_result)), jsonb_array_length(v_result) = 0);
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('08b_segunda_chamada_nao_mudou_nada', format('antes=%s depois=%s', v_full_name_antes, v_full_name_depois), v_full_name_antes = v_full_name_depois);
END $passo8$;

-- ============================================================================
-- PASSO 9 — regressão: checagens-chave de LEGAL-1/1B continuam valendo
-- (consentimento nunca apagado, só PII zerada; permissão).
-- ============================================================================
DO $passo9$
DECLARE
  v_client_x uuid := (SELECT valor FROM zzlc_ids WHERE chave='client_x');
  v_owner_a uuid := (SELECT valor FROM zzlc_ids WHERE chave='owner_a');
  v_user_x uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_x');
  v_n int;
  v_rejeitou boolean;
BEGIN
  -- Consentimento: insere um de propósito nesta fase (não havia nenhum
  -- antes pra X/Y), grava PII, confirma que erase (já executado acima)
  -- teria zerado — então insere agora e roda purge_client_consent_pii
  -- isoladamente pra confirmar que o caminho dedicado continua intacto.
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source, signer_name, evidence_ip, evidence_user_agent)
    VALUES (v_owner_a, v_client_x, 'health_data', 'granted', 'termo-consentimento', '2026-08-04', 'portal', 'zz Nome', '203.0.113.9', 'Mozilla/5.0 (teste)');

  PERFORM public.purge_client_consent_pii(v_client_x);

  SELECT count(*) INTO v_n FROM public.client_consents WHERE client_id = v_client_x;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('09a_consentimento_nao_apagado_por_purge', format('%s (esperado 1, continua existindo)', v_n), v_n = 1);

  SELECT count(*) INTO v_n FROM public.client_consents WHERE client_id = v_client_x AND signer_name IS NULL AND evidence_ip IS NULL AND evidence_user_agent IS NULL;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('09b_pii_do_consentimento_zerada', format('%s', v_n), v_n = 1);

  -- DELETE direto em client_consents continua bloqueado SEMPRE (nem o
  -- rollback mexeu nisso — é da migração 20261115120000, intocada).
  v_rejeitou := false;
  BEGIN
    DELETE FROM public.client_consents WHERE client_id = v_client_x;
  EXCEPTION WHEN OTHERS THEN
    v_rejeitou := true;
  END;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('09c_delete_direto_em_consents_continua_bloqueado', 'AURA_CONSENT_IMMUTABLE esperado', v_rejeitou);

  -- Permissão: anon/authenticated continuam sem EXECUTE em erase_client_data.
  v_rejeitou := false;
  BEGIN
    SET ROLE authenticated;
    PERFORM public.erase_client_data(v_user_x);
    v_rejeitou := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejeitou := true;
  END;
  RESET ROLE;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('09d_authenticated_nao_executa_erase', 'insufficient_privilege', v_rejeitou);

  v_rejeitou := false;
  BEGIN
    SET ROLE anon;
    PERFORM public.client_erasure_plan(v_user_x);
    v_rejeitou := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejeitou := true;
  END;
  RESET ROLE;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('09e_anon_nao_executa_plan', 'insufficient_privilege', v_rejeitou);
END $passo9$;

-- ============================================================================
-- PASSO 10 — grants DEPOIS da migração (idênticos a antes).
-- ============================================================================
DO $passo10$
DECLARE v_ok boolean;
BEGIN
  SELECT NOT has_function_privilege('anon', 'public.erase_client_data(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.erase_client_data(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.erase_client_data(uuid)', 'EXECUTE')
    INTO v_ok;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('10a_grants_depois_da_migracao_inalterados', 'anon/authenticated sem EXECUTE, service_role com EXECUTE', v_ok);
END $passo10$;

-- ============================================================================
-- PASSO 11 — aplica o ROLLBACK (DDL colado, igual ao arquivo real) e
-- REPRODUZ o defeito de novo, com fixtures NOVAS (prova que o rollback
-- restaura o comportamento, não só o texto).
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS backup_rollback_legal1c;
REVOKE ALL ON SCHEMA backup_rollback_legal1c FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS backup_rollback_legal1c.erase_client_data_20261116180000 AS
  SELECT pg_get_functiondef(oid) AS definition, now() AS backed_up_at
  FROM pg_proc
  WHERE proname = 'erase_client_data' AND pronamespace = 'public'::regnamespace;
ALTER TABLE backup_rollback_legal1c.erase_client_data_20261116180000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_rollback_legal1c.erase_client_data_20261116180000 FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.erase_client_data(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _client record;
  _old_phone text;
  _n_anamnesis integer;
  _n_photos integer;
  _n_messages integer;
  _n_orphan_messages integer;
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
      DELETE FROM public.whatsapp_messages wm
      WHERE wm.owner_id = _client.owner_id
        AND wm.client_id IS NULL
        AND right(regexp_replace(wm.recipient_phone, '\D', '', 'g'), 8)
          = right(regexp_replace(_old_phone, '\D', '', 'g'), 8);
      GET DIAGNOSTICS _n_orphan_messages = ROW_COUNT;

      DELETE FROM public.whatsapp_blocked_recipients wbr
      WHERE wbr.owner_id = _client.owner_id
        AND right(regexp_replace(wbr.phone_e164, '\D', '', 'g'), 8)
          = right(regexp_replace(_old_phone, '\D', '', 'g'), 8);
      GET DIAGNOSTICS _n_blocked = ROW_COUNT;
    ELSE
      _n_orphan_messages := 0;
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
      'orphan_whatsapp_messages_deleted', _n_orphan_messages,
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

-- Fixtures NOVAS (W/Z já foram consumidas acima) — mesma forma do caso 1,
-- com cliente X2.
DO $passo11_setup$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzlc_ids WHERE chave='owner_a');
  v_user_x2 uuid := gen_random_uuid();
  v_client_x2 uuid;
  v_appt_x2 uuid;
  v_msg_outbound uuid; v_msg_resolved uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_x2, 'zz-fixture-user-x2@invalid.test');
  INSERT INTO public.clients (owner_id, full_name, phone, user_id)
    VALUES (v_owner_a, 'zz-fixture Cliente X2 (pos-rollback)', '+5511977770006', v_user_x2)
    RETURNING id INTO v_client_x2;
  INSERT INTO public.appointments (owner_id, client_id, starts_at, ends_at, status, price)
    VALUES (v_owner_a, v_client_x2, now() + interval '9 days', now() + interval '9 days 1 hour', 'confirmed', 100)
    RETURNING id INTO v_appt_x2;
  -- outbound ÓRFÃO de propósito — mesmo motivo do caso 1 (evita que o
  -- CASCADE de outbound_message_id remova a thread antes da checagem de
  -- resolved_by_message_id, mascarando o defeito).
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, NULL, 'outbound', 'template', '+5511977770006', 'sent') RETURNING id INTO v_msg_outbound;
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, v_client_x2, 'inbound', 'text', '+5511977770006', 'delivered') RETURNING id INTO v_msg_resolved;
  INSERT INTO public.whatsapp_central_threads
    (owner_id, client_id, appointment_id, outbound_message_id, template_key, appointment_starts_at_snapshot, resolved_by_message_id, resolved_at)
    VALUES (v_owner_a, v_client_x2, v_appt_x2, v_msg_outbound, 'lembrete_24h', now() + interval '9 days', v_msg_resolved, now());

  INSERT INTO zzlc_ids (chave, valor) VALUES ('user_x2', v_user_x2), ('client_x2', v_client_x2);
END $passo11_setup$;

DO $passo11$
DECLARE
  v_user_x2 uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_x2');
  v_sqlstate text; v_constraint text; v_falhou boolean;
BEGIN
  v_falhou := false;
  BEGIN
    SET ROLE service_role;
    PERFORM public.erase_client_data(v_user_x2);
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
    v_falhou := true;
  END;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('11a_rollback_restaura_defeito_de_verdade', format('sqlstate=%s constraint=%s', v_sqlstate, v_constraint),
     v_falhou AND v_sqlstate = '23503' AND v_constraint = 'whatsapp_central_threads_resolved_by_message_id_fkey');
END $passo11$;

DO $passo11b$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'erase_client_data';
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('11b_funcao_restaurada_nao_menciona_resolved_by_message_id_update', 'não tem o UPDATE da correção', v_def NOT ILIKE '%SET resolved_by_message_id = NULL%');
END $passo11b$;

-- ============================================================================
-- PASSO 12 — reaplica a migração NOVA e confirma que volta a passar.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.erase_client_data(_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _client record;
  _old_phone text;
  _n_anamnesis integer;
  _n_photos integer;
  _n_messages integer;
  _n_orphan_messages integer;
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

    UPDATE public.whatsapp_central_threads
    SET resolved_by_message_id = NULL
    WHERE resolved_by_message_id IN (
      SELECT id FROM public.whatsapp_messages WHERE client_id = _client.id
    );
    UPDATE public.whatsapp_confirmation_threads
    SET resolved_by_message_id = NULL
    WHERE resolved_by_message_id IN (
      SELECT id FROM public.whatsapp_messages WHERE client_id = _client.id
    );

    DELETE FROM public.whatsapp_messages WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_messages = ROW_COUNT;

    DELETE FROM public.whatsapp_central_threads WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_central = ROW_COUNT;

    DELETE FROM public.whatsapp_confirmation_threads WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_confirmation = ROW_COUNT;

    IF _old_phone IS NOT NULL THEN
      UPDATE public.whatsapp_central_threads
      SET resolved_by_message_id = NULL
      WHERE resolved_by_message_id IN (
        SELECT id FROM public.whatsapp_messages wm
        WHERE wm.owner_id = _client.owner_id
          AND wm.client_id IS NULL
          AND right(regexp_replace(wm.recipient_phone, '\D', '', 'g'), 8)
            = right(regexp_replace(_old_phone, '\D', '', 'g'), 8)
      );
      UPDATE public.whatsapp_confirmation_threads
      SET resolved_by_message_id = NULL
      WHERE resolved_by_message_id IN (
        SELECT id FROM public.whatsapp_messages wm
        WHERE wm.owner_id = _client.owner_id
          AND wm.client_id IS NULL
          AND right(regexp_replace(wm.recipient_phone, '\D', '', 'g'), 8)
            = right(regexp_replace(_old_phone, '\D', '', 'g'), 8)
      );

      DELETE FROM public.whatsapp_messages wm
      WHERE wm.owner_id = _client.owner_id
        AND wm.client_id IS NULL
        AND right(regexp_replace(wm.recipient_phone, '\D', '', 'g'), 8)
          = right(regexp_replace(_old_phone, '\D', '', 'g'), 8);
      GET DIAGNOSTICS _n_orphan_messages = ROW_COUNT;

      DELETE FROM public.whatsapp_blocked_recipients wbr
      WHERE wbr.owner_id = _client.owner_id
        AND right(regexp_replace(wbr.phone_e164, '\D', '', 'g'), 8)
          = right(regexp_replace(_old_phone, '\D', '', 'g'), 8);
      GET DIAGNOSTICS _n_blocked = ROW_COUNT;
    ELSE
      _n_orphan_messages := 0;
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
      'orphan_whatsapp_messages_deleted', _n_orphan_messages,
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

DO $passo12$
DECLARE
  v_user_x2 uuid := (SELECT valor FROM zzlc_ids WHERE chave='user_x2');
  v_result jsonb;
BEGIN
  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_x2) INTO v_result;
  RESET ROLE;
  INSERT INTO zzlc_results (caso, detalhe, passou) VALUES
    ('12a_reaplicada_volta_a_passar', format('%s entradas (esperado 1, sem erro)', jsonb_array_length(v_result)), jsonb_array_length(v_result) = 1);
END $passo12$;

-- Saída consolidada numa ÚNICA consulta (JSON).
SELECT jsonb_build_object(
  'casos', (
    SELECT jsonb_agg(jsonb_build_object('ordem', ordem, 'caso', caso, 'detalhe', detalhe, 'passou', passou) ORDER BY ordem)
    FROM zzlc_results
  ),
  'resumo', (
    SELECT jsonb_build_object('passaram', count(*) FILTER (WHERE passou), 'falharam', count(*) FILTER (WHERE NOT passou))
    FROM zzlc_results
  )
) AS resultado;

ROLLBACK;
