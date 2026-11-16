-- Rollback de 20261116180000_client_erasure_fk_order.sql (FASE LEGAL-1C).
--
-- Mesmo padrão dos rollbacks anteriores desta série (só troca o corpo de
-- uma função que já existia — "desfazer" aqui é recriar a versão ANTERIOR
-- exata, não dropar nada). O texto restaurado abaixo é o de
-- 20261115160000_client_erasure_orphan_messages.sql, colado byte-a-byte
-- (nenhuma diferença de formatação em relação ao arquivo real).
--
-- IMPACTO de aplicar este rollback: erase_client_data volta a ter o
-- defeito de ordem encontrado na FASE DELETE-DIAG (apaga whatsapp_messages
-- antes de whatsapp_central_threads/whatsapp_confirmation_threads) — ou
-- seja, exclusão de conta volta a falhar com SQLSTATE 23503 pra qualquer
-- cliente cujas threads referenciem mensagens dela via
-- resolved_by_message_id. Nenhum dado é perdido ao aplicar ESTE rollback
-- em si (não há DROP COLUMN/TABLE aqui, só troca de corpo de função) —
-- mas, por segurança e pra nunca depender de "lembrar de cabeça" qual
-- versão estava rodando, guarda o texto da definição ATUAL (a corrigida)
-- em backup_rollback_legal1c antes de substituir, mesmo padrão já usado
-- em automations_soft_delete/client_consents/professional_terms_acceptance
-- pra preservar o que existia antes de qualquer alteração.
--
-- client_erasure_plan NÃO é tocada por este rollback — a migração
-- 20261116180000 nunca alterou essa função, só erase_client_data.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ---- Preservar o texto da definição ATUAL antes de substituir ----
CREATE SCHEMA IF NOT EXISTS backup_rollback_legal1c;
REVOKE ALL ON SCHEMA backup_rollback_legal1c FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_legal1c.erase_client_data_20261116180000 AS
  SELECT pg_get_functiondef(oid) AS definition, now() AS backed_up_at
  FROM pg_proc
  WHERE proname = 'erase_client_data' AND pronamespace = 'public'::regnamespace;
ALTER TABLE backup_rollback_legal1c.erase_client_data_20261116180000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_rollback_legal1c.erase_client_data_20261116180000 FROM PUBLIC, anon, authenticated;

-- ---- Restaura a versão anterior exata (20261115160000) ----
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

COMMIT;
