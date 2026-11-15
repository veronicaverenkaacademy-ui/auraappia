-- Rollback de 20261115160000_client_erasure_orphan_messages.sql (FASE
-- LEGAL-1B).
--
-- Diferente dos rollbacks anteriores desta série (que dropavam o que a
-- migração tinha criado), esta migração só TROCA o corpo de 2 funções que
-- já existiam — então "desfazer" aqui significa recriar a versão ANTERIOR
-- exata dessas 2 funções, não dropar nada. O texto abaixo foi colado
-- byte-a-byte a partir de pg_get_functiondef(), lido em produção nesta
-- mesma fase (ou seja, exatamente o que 20261115140000_client_erasure.sql
-- deixou lá, antes desta migração) — nunca "reconstruído de memória".
-- GRANT/REVOKE idênticos aos já aplicados (repetidos por clareza/segurança).
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

COMMIT;
