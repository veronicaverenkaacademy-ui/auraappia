-- FASE LEGAL-1B — suíte da migração
-- 20261115160000_client_erasure_orphan_messages.sql (mensagens de WhatsApp
-- "órfãs" — whatsapp_messages.client_id IS NULL — do mesmo estúdio e mesmo
-- telefone da cliente).
--
-- NÃO EXECUTADA contra produção nesta fase (branch nova + PR em DRAFT).
-- Rodada LOCALMENTE (Postgres 16 descartável) — ver saída colada no
-- relatório da fase. Pressupõe o MESMO bootstrap da FASE LEGAL-1 (auth.
-- users, clients com todas as colunas reais, whatsapp_messages,
-- whatsapp_blocked_recipients, client_consents+purge_client_consent_pii,
-- app_notifications, e as demais tabelas tocadas por erase_client_data) —
-- nenhuma tabela nova nesta fase, só o corpo de 2 funções muda, então o
-- mesmo bootstrap de 20261115140000 serve sem alteração.
--
-- Fixtures mínimas (sem agendamentos — esta fase não toca a lógica de
-- agendamentos, evita de propósito qualquer risco de colidir com
-- appointments_no_overlap): 2 estúdios (A/B); cliente X só em A (telefone
-- PHONE_X); "outra cliente" em A (telefone PHONE_Y, intocável, e dona de
-- uma mensagem COM client_id, usada pra provar que a exclusão nunca toca
-- mensagem que já tem client_id, mesmo que o telefone bata); cliente Z em
-- A com telefone NULO (prova "telefone nulo não apaga nada"). Mensagens
-- órfãs (client_id NULL): 1 em A com telefone de X (deve ser apagada), 1
-- em A com telefone de Y (deve ficar intacta — telefone diferente), 1 em B
-- com telefone de X (deve ficar intacta — outro estúdio; X não tem linha
-- de clients em B, então o laço de erase_client_data nem chega a olhar
-- pra B).
--
-- Ciclo: 0) confirma versão ANTERIOR das funções (sem a contagem/exclusão
-- nova); 1) fixtures; 2) aplica a migração; 3) client_erasure_plan conta
-- orphan_whatsapp_messages_count certo; 4) erase_client_data apaga só a
-- mensagem certa, preserva as outras 3 cenários (outro telefone, outro
-- estúdio, mensagem com client_id de outro cliente); 5) telefone nulo não
-- apaga nada; 6) idempotência; 7) permissão; 8) rollback restaura o
-- comportamento ANTERIOR (sem a exclusão nova); 9) reaplica e confirma que
-- volta. Nunca COMMIT.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

CREATE TEMP TABLE zzlb_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzlb_ids (chave text PRIMARY KEY, valor uuid) ON COMMIT DROP;
GRANT ALL ON zzlb_results TO PUBLIC;
GRANT ALL ON zzlb_ids TO PUBLIC;
GRANT ALL ON SEQUENCE zzlb_results_ordem_seq TO PUBLIC;

-- ============================================================================
-- PASSO -1 — recria o estado JÁ EM PRODUÇÃO (coluna + as 2 funções da
-- 20261115140000, DDL colado byte-a-byte via pg_get_functiondef lido nesta
-- fase) — o bootstrap local (fora deste arquivo) só tem as TABELAS-base;
-- a coluna deleted_by_client_at e as funções em si vieram da migração
-- 20261115140000, já aplicada e mergeada — aqui simulamos esse estado
-- "antes desta fase" pra então aplicar 20261115160000 por cima.
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
-- PASSO 0 — confirma a versão ANTERIOR (sem a contagem/exclusão de órfãs)
-- ============================================================================
DO $passo0$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'erase_client_data';
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('00_versao_anterior_nao_tem_orphan_messages', 'erase_client_data ainda não menciona orphan', v_def NOT ILIKE '%orphan%');

  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'client_erasure_plan';
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('00_plan_versao_anterior_nao_tem_orphan', 'client_erasure_plan ainda não menciona orphan', v_def NOT ILIKE '%orphan%');
END $passo0$;

-- ============================================================================
-- PASSO 1 — fixtures
-- ============================================================================
INSERT INTO zzlb_ids (chave, valor) VALUES
  ('owner_a', gen_random_uuid()),
  ('owner_b', gen_random_uuid()),
  ('user_x', gen_random_uuid()),
  ('user_other_a', gen_random_uuid()),
  ('user_z', gen_random_uuid());

DO $setup$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzlb_ids WHERE chave='owner_a');
  v_owner_b uuid := (SELECT valor FROM zzlb_ids WHERE chave='owner_b');
  v_user_x uuid := (SELECT valor FROM zzlb_ids WHERE chave='user_x');
  v_user_other_a uuid := (SELECT valor FROM zzlb_ids WHERE chave='user_other_a');
  v_user_z uuid := (SELECT valor FROM zzlb_ids WHERE chave='user_z');
  v_client_x_a uuid; v_client_other_a uuid; v_client_z_a uuid;
  v_msg_orphan_match uuid; v_msg_orphan_other_phone uuid; v_msg_orphan_other_owner uuid; v_msg_with_client_id uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner_a, 'zz-fixture-owner-a@invalid.test'),
    (v_owner_b, 'zz-fixture-owner-b@invalid.test'),
    (v_user_x, 'zz-fixture-user-x@invalid.test'),
    (v_user_other_a, 'zz-fixture-user-other-a@invalid.test'),
    (v_user_z, 'zz-fixture-user-z@invalid.test');

  -- Cliente X: só em A, telefone PHONE_X (+5511988880001).
  INSERT INTO public.clients (owner_id, full_name, phone, user_id)
    VALUES (v_owner_a, 'zz-fixture Cliente X', '+5511988880001', v_user_x)
    RETURNING id INTO v_client_x_a;

  -- Outra cliente em A, telefone PHONE_Y (+5511988880002), intocável.
  INSERT INTO public.clients (owner_id, full_name, phone, user_id)
    VALUES (v_owner_a, 'zz-fixture Outra Cliente A', '+5511988880002', v_user_other_a)
    RETURNING id INTO v_client_other_a;

  -- Cliente Z em A, SEM telefone (NULL) — prova "telefone nulo não apaga nada".
  INSERT INTO public.clients (owner_id, full_name, phone, user_id)
    VALUES (v_owner_a, 'zz-fixture Cliente Z (sem telefone)', NULL, v_user_z)
    RETURNING id INTO v_client_z_a;

  INSERT INTO zzlb_ids (chave, valor) VALUES
    ('client_x_a', v_client_x_a), ('client_other_a', v_client_other_a), ('client_z_a', v_client_z_a);

  -- Mensagem ÓRFÃ (client_id NULL) em A com o MESMO telefone de X — deve
  -- ser apagada por erase_client_data(user_x).
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, NULL, 'outbound', 'template', '+5511988880001', 'sent')
    RETURNING id INTO v_msg_orphan_match;

  -- Mensagem ÓRFÃ em A com telefone DIFERENTE (o de Y) — nunca deve ser
  -- tocada ao apagar X.
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, NULL, 'inbound', 'text', '+5511988880002', 'delivered')
    RETURNING id INTO v_msg_orphan_other_phone;

  -- Mensagem ÓRFÃ no OUTRO estúdio (B) com o MESMO telefone de X — nunca
  -- deve ser tocada (X não tem linha de clients em B; o laço de
  -- erase_client_data nem chega a considerar B).
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_b, NULL, 'outbound', 'template', '+5511988880001', 'sent')
    RETURNING id INTO v_msg_orphan_other_owner;

  -- Mensagem em A COM client_id (da outra cliente), mas com o MESMO
  -- telefone de X (cenário sintético de propósito) — prova que o guard
  -- "client_id IS NULL" nunca deixa apagar uma mensagem que já pertence a
  -- outro cliente, mesmo que o telefone coincida.
  INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, status)
    VALUES (v_owner_a, v_client_other_a, 'outbound', 'template', '+5511988880001', 'sent')
    RETURNING id INTO v_msg_with_client_id;

  INSERT INTO zzlb_ids (chave, valor) VALUES
    ('msg_orphan_match', v_msg_orphan_match),
    ('msg_orphan_other_phone', v_msg_orphan_other_phone),
    ('msg_orphan_other_owner', v_msg_orphan_other_owner),
    ('msg_with_client_id', v_msg_with_client_id);
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
-- PASSO 3 — client_erasure_plan conta a mensagem órfã certa
-- ============================================================================
DO $passo3$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzlb_ids WHERE chave='user_x');
  v_plan jsonb;
  v_entry jsonb;
BEGIN
  SET ROLE service_role;
  SELECT public.client_erasure_plan(v_user_x) INTO v_plan;
  RESET ROLE;

  SELECT e INTO v_entry FROM jsonb_array_elements(v_plan) e;
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('03a_plano_conta_1_mensagem_orfa', format('%s', v_entry->>'orphan_whatsapp_messages_count'), (v_entry->>'orphan_whatsapp_messages_count')::int = 1);
END $passo3$;

-- ============================================================================
-- PASSO 4 — erase_client_data apaga só a mensagem certa
-- ============================================================================
DO $passo4$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzlb_ids WHERE chave='user_x');
  v_msg_orphan_match uuid := (SELECT valor FROM zzlb_ids WHERE chave='msg_orphan_match');
  v_msg_orphan_other_phone uuid := (SELECT valor FROM zzlb_ids WHERE chave='msg_orphan_other_phone');
  v_msg_orphan_other_owner uuid := (SELECT valor FROM zzlb_ids WHERE chave='msg_orphan_other_owner');
  v_msg_with_client_id uuid := (SELECT valor FROM zzlb_ids WHERE chave='msg_with_client_id');
  v_result jsonb;
  v_entry jsonb;
  v_n int;
BEGIN
  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_x) INTO v_result;
  RESET ROLE;

  SELECT e INTO v_entry FROM jsonb_array_elements(v_result) e;
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('04a_contador_orphan_deleted_1', format('%s', v_entry->>'orphan_whatsapp_messages_deleted'), (v_entry->>'orphan_whatsapp_messages_deleted')::int = 1);

  SELECT count(*) INTO v_n FROM public.whatsapp_messages WHERE id = v_msg_orphan_match;
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('04b_mensagem_orfa_com_mesmo_telefone_apagada', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM public.whatsapp_messages WHERE id = v_msg_orphan_other_phone;
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('04c_mensagem_orfa_outro_telefone_intacta', format('%s (esperado 1)', v_n), v_n = 1);

  SELECT count(*) INTO v_n FROM public.whatsapp_messages WHERE id = v_msg_orphan_other_owner;
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('04d_mensagem_orfa_outro_estudio_intacta', format('%s (esperado 1)', v_n), v_n = 1);

  SELECT count(*) INTO v_n FROM public.whatsapp_messages WHERE id = v_msg_with_client_id;
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('04e_mensagem_com_client_id_de_outro_cliente_intacta', format('%s (esperado 1, nunca toca client_id preenchido)', v_n), v_n = 1);
END $passo4$;

-- ============================================================================
-- PASSO 5 — telefone nulo (cliente Z) não apaga nenhuma mensagem órfã
-- ============================================================================
DO $passo5$
DECLARE
  v_user_z uuid := (SELECT valor FROM zzlb_ids WHERE chave='user_z');
  v_msg_orphan_other_phone uuid := (SELECT valor FROM zzlb_ids WHERE chave='msg_orphan_other_phone');
  v_msg_orphan_other_owner uuid := (SELECT valor FROM zzlb_ids WHERE chave='msg_orphan_other_owner');
  v_result jsonb;
  v_entry jsonb;
  v_n int;
BEGIN
  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_z) INTO v_result;
  RESET ROLE;

  SELECT e INTO v_entry FROM jsonb_array_elements(v_result) e;
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('05a_cliente_sem_telefone_orphan_deleted_0', format('%s', v_entry->>'orphan_whatsapp_messages_deleted'), (v_entry->>'orphan_whatsapp_messages_deleted')::int = 0);

  SELECT count(*) INTO v_n FROM public.whatsapp_messages WHERE id IN (v_msg_orphan_other_phone, v_msg_orphan_other_owner);
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('05b_mensagens_restantes_continuam_intactas', format('%s (esperado 2)', v_n), v_n = 2);
END $passo5$;

-- ============================================================================
-- PASSO 6 — idempotência: reexecutar erase_client_data(user_x) não falha
-- ============================================================================
DO $passo6$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzlb_ids WHERE chave='user_x');
  v_result jsonb;
BEGIN
  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_x) INTO v_result;
  RESET ROLE;

  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('06a_segunda_chamada_nao_encontra_mais_linha', format('%s entradas (esperado 0, user_id já é NULL)', jsonb_array_length(v_result)), jsonb_array_length(v_result) = 0);
END $passo6$;

-- ============================================================================
-- PASSO 7 — permissão: anon/authenticated continuam sem EXECUTE
-- ============================================================================
DO $passo7$
DECLARE
  v_user_x uuid := (SELECT valor FROM zzlb_ids WHERE chave='user_x');
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
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('07a_authenticated_nao_executa_erase', 'insufficient_privilege', v_rejeitou);

  SET ROLE anon;
  BEGIN
    PERFORM public.client_erasure_plan(v_user_x);
    v_rejeitou := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejeitou := true;
  END;
  RESET ROLE;
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('07b_anon_nao_executa_plan', 'insufficient_privilege', v_rejeitou);
END $passo7$;

-- ============================================================================
-- PASSO 8 — aplica o rollback (DDL colado, igual ao arquivo real) e confirma
-- que a versão restaurada NÃO apaga mais órfãs
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

DO $passo8$
DECLARE
  v_user_other_a uuid := (SELECT valor FROM zzlb_ids WHERE chave='user_other_a');
  v_client_other_a uuid := (SELECT valor FROM zzlb_ids WHERE chave='client_other_a');
  v_msg_orphan_other_phone uuid := (SELECT valor FROM zzlb_ids WHERE chave='msg_orphan_other_phone');
  v_result jsonb;
  v_n int;
BEGIN
  -- Cliente "outra" (telefone PHONE_Y) ainda não foi excluída — usa ela
  -- agora pra provar que a versão RESTAURADA pelo rollback não tem mais a
  -- exclusão de órfãs: a mensagem órfã com telefone PHONE_Y deve
  -- SOBREVIVER mesmo depois de excluir a cliente dona desse telefone.
  SET ROLE service_role;
  SELECT public.erase_client_data(v_user_other_a) INTO v_result;
  RESET ROLE;

  SELECT count(*) INTO v_n FROM public.whatsapp_messages WHERE id = v_msg_orphan_other_phone;
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('08a_rollback_restaura_comportamento_anterior_sem_apagar_orfa', format('%s (esperado 1, rollback não tem mais a exclusão nova)', v_n), v_n = 1);
END $passo8$;

DO $passo8b$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid)::text INTO v_def FROM pg_proc WHERE proname = 'erase_client_data';
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('08b_funcao_restaurada_nao_menciona_orphan', 'erase_client_data voltou a não mencionar orphan', v_def NOT ILIKE '%orphan%');
END $passo8b$;

-- ============================================================================
-- PASSO 9 — reaplica a migração (DDL colado de novo, igual ao arquivo real)
-- e confirma que volta
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

DO $passo9$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(oid)::text INTO v_def FROM pg_proc WHERE proname = 'erase_client_data';
  INSERT INTO zzlb_results (caso, detalhe, passou) VALUES
    ('09a_reaplicada_volta_a_mencionar_orphan', 'erase_client_data volta a ter a lógica nova', v_def ILIKE '%orphan%');
END $passo9$;

-- Saída consolidada numa ÚNICA consulta (JSON).
SELECT jsonb_build_object(
  'casos', (
    SELECT jsonb_agg(jsonb_build_object('ordem', ordem, 'caso', caso, 'detalhe', detalhe, 'passou', passou) ORDER BY ordem)
    FROM zzlb_results
  ),
  'resumo', (
    SELECT jsonb_build_object('passaram', count(*) FILTER (WHERE passou), 'falharam', count(*) FILTER (WHERE NOT passou))
    FROM zzlb_results
  )
) AS resultado;

ROLLBACK;
