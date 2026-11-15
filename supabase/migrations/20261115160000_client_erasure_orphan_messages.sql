-- FASE LEGAL-1B — completa a exclusão de dados da cliente: mensagens de
-- WhatsApp "órfãs" (whatsapp_messages.client_id IS NULL) do MESMO estúdio
-- com o MESMO telefone da cliente escapavam de erase_client_data, porque
-- ele só apagava whatsapp_messages por client_id. Achado em produção na
-- verificação da FASE LEGAL-1 (aplicação do PR #121): 3 linhas reais (todas
-- outbound) nessa condição.
--
-- ESTA MIGRAÇÃO NÃO FOI APLICADA EM PRODUÇÃO NESTA FASE — só branch nova +
-- PR em DRAFT, por instrução explícita da dona. Ela só TROCA o corpo das
-- duas funções (client_erasure_plan/erase_client_data) — nenhuma linha
-- real é apagada por esta migração em si; o apagamento só acontece quando
-- uma cliente de verdade excluir a própria conta (daí pra frente).
--
-- DESENHO (por que cada decisão):
--   - Critério de casamento: MESMO de whatsapp_blocked_recipients, já em
--     produção desde 20261115140000 — (owner_id = o da cliente) AND
--     (últimos 8 dígitos do telefone normalizado, dos dois lados, iguais).
--     Decisão consciente de MANTER esse critério (não trocar por igualdade
--     exata do número completo): números de WhatsApp no Brasil chegam de
--     fontes diferentes (payload do provedor, digitação manual) com/sem
--     "+55", com/sem o 9º dígito, com/sem espaço/hífen — é exatamente por
--     isso que phoneMatchesByLast8() (central-phone-match.ts, já usada em
--     TODO o resto do app pra decidir "é o mesmo telefone?") nunca compara
--     string completa. Pra um número de celular BR real, os últimos 8
--     dígitos SÃO o número de linha (DDD + 9º dígito são tudo que pode
--     variar) — ou seja, dentro do MESMO DDD, bater os últimos 8 dígitos é
--     equivalente a ser o MESMO número; o único jeito de dar falso
--     positivo é dois números de DDDs DIFERENTES que, por coincidência,
--     têm os mesmos 8 dígitos finais — risco real, mas pequeno, já
--     aceito (sem comentário explícito) pelo desenho original de
--     whatsapp_blocked_recipients; usar comparação exata aqui, em vez
--     disso, arriscaria o oposto — um FALSO NEGATIVO (o número é o mesmo,
--     mas o 9º dígito ou o "+55" não bate) deixando a mensagem órfã PARA
--     TRÁS depois da exclusão, que é pior numa função de apagamento de
--     dados do que um risco pequeno e já aceito de sobre-apagar. Mantido
--     por consistência com o resto do app, não decidido sozinho sem essa
--     análise.
--   - Escopo por owner_id (não troca o já existente): já é o mesmo
--     critério de whatsapp_blocked_recipients — uma cliente só tem suas
--     mensagens órfãs apagadas no(s) estúdio(s) em que ela de fato tem (ou
--     tinha) uma linha de clients.
--   - client_erasure_plan ganha 'orphan_whatsapp_messages_count' (contagem
--     somente leitura, pra a camada TS/relatório saber que existe algo a
--     apagar nessa categoria também).
--   - erase_client_data ganha a exclusão em si, dentro do MESMO bloco
--     "IF _old_phone IS NOT NULL" que já existia pra whatsapp_blocked_recipients
--     (mesma guarda: sem telefone antigo, não há o que casar) e um contador
--     novo 'orphan_whatsapp_messages_deleted' no JSON de retorno por
--     cliente. Nenhuma outra parte da função muda.
--   - Fora de escopo NESTA fase (relatado no relatório da fase, não
--     implementado sem consulta): client_otp_codes.phone (tabela de
--     códigos de login, sem owner_id/client_id, 10 linhas reais hoje) e
--     whatsapp_central_orphan_messages (retenção de mensagens que nem o
--     ESTÚDIO foi identificado — sem coluna owner_id nenhuma, 0 linhas
--     hoje).
--
-- Idempotente (CREATE OR REPLACE FUNCTION) — seguro reaplicar. GRANT/REVOKE
-- idênticos aos já aplicados em 20261115140000 (repetidos aqui só por
-- clareza e segurança — não mudam nada se já estiverem corretos).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

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

    -- Mensagens de WhatsApp ÓRFÃS (sem client_id) do MESMO estúdio com o
    -- MESMO telefone ANTIGO da cliente (lido acima, antes de clients.phone
    -- ser zerado) — mesmo critério de casamento de whatsapp_blocked_recipients
    -- abaixo, por isso no MESMO bloco "sem telefone antigo, nada a casar".
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

COMMIT;
