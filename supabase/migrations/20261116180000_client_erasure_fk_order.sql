-- FASE LEGAL-1C — corrige a ORDEM de exclusão em erase_client_data: ela
-- apagava public.whatsapp_messages ANTES de public.whatsapp_central_threads
-- e public.whatsapp_confirmation_threads, mas as duas colunas
-- resolved_by_message_id (em ambas as tabelas de thread) referenciam
-- whatsapp_messages(id) SEM "ON DELETE" (= NO ACTION) — qualquer thread
-- (da própria cliente, de OUTRA cliente do mesmo dono, ou sem cliente
-- nenhum ainda) que aponte pra uma mensagem prestes a ser apagada bloqueia
-- a exclusão com SQLSTATE 23503.
--
-- ACHADO EM PRODUÇÃO (FASE DELETE-DIAG, 2026-11-16, dentro de
-- BEGIN...ROLLBACK, nunca commitado): reproduzido de verdade contra a
-- única cliente real com user_id preenchido — 4 das 9 whatsapp_central_threads
-- dela referenciavam mensagens dela mesma via resolved_by_message_id;
-- erase_client_data falhou com exatamente essa constraint
-- (whatsapp_central_threads_resolved_by_message_id_fkey). A suíte de
-- LEGAL-1/1B passou porque os fixtures de lá nunca tinham uma thread com
-- resolved_by_message_id preenchido apontando pra uma mensagem que seria
-- apagada — por isso o defeito não apareceu antes.
--
-- Bug GÊMEO, ainda não disparado em produção só por falta de dado: a
-- mesma forma de FK existe em
-- whatsapp_confirmation_threads_resolved_by_message_id_fkey.
--
-- A falha é ATÔMICA — erase_client_data inteira roda numa única invocação
-- de função; quando falha no meio, TUDO dentro dela (inclusive a purga de
-- PII dos consentimentos, que roda antes) é desfeito junto. Ou seja:
-- produção nunca ficou "meio excluída" por causa deste defeito — só nunca
-- excluiu NADA quando esse caso aparecia. Confirmado em produção (mesma
-- fase DELETE-DIAG) que purge_client_consent_pii e o trigger de
-- imutabilidade do ledger (trg_10_client_consents_block_mutation)
-- funcionam corretamente e NÃO são a causa.
--
-- CORREÇÃO (mínima, só a ordem): antes de cada DELETE em whatsapp_messages
-- (tanto o por client_id quanto o de mensagens ÓRFÃS casadas por telefone,
-- da FASE LEGAL-1B), zera resolved_by_message_id em QUALQUER thread — de
-- QUALQUER cliente/dono, não só da cliente sendo excluída — que aponte pra
-- uma das mensagens que estão prestes a ser apagadas por aquele DELETE
-- específico. Isso cobre tanto "thread da própria cliente apontando pra
-- mensagem dela" quanto "thread de OUTRA cliente do mesmo dono apontando
-- pra uma mensagem órfã que está sendo apagada por casamento de telefone"
-- (as mensagens órfãs não têm client_id, então não há como saber de
-- antemão se uma thread de outra cliente/dono aponta pra uma delas — por
-- isso a busca é global, não restrita a _client.id). outbound_message_id
-- continua sem precisar de tratamento — já é ON DELETE CASCADE nas duas
-- tabelas de thread, nunca bloqueou nada.
--
-- Nenhuma outra parte do comportamento muda: mesma assinatura, mesmo tipo
-- de retorno, mesmas chaves no JSON por cliente, mesma ordem de
-- DELETE/UPDATE das demais tabelas, mesmo SECURITY/search_path, mesmos
-- GRANT/REVOKE (service_role só). client-erasure.server.ts não precisou
-- mudar — o tipo EraseClientDataEntry já bate com o retorno, que não
-- ganhou nem perdeu nenhuma chave.
--
-- Idempotente (CREATE OR REPLACE FUNCTION) — seguro reaplicar.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

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

    -- FASE LEGAL-1C: zera qualquer referência (de QUALQUER thread, não só
    -- da cliente) que aponte pra uma das mensagens dela ANTES de apagar as
    -- mensagens em si — resolved_by_message_id não tem ON DELETE, então a
    -- FK bloqueia o DELETE abaixo se não fizer isso primeiro.
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
      -- FASE LEGAL-1C: mesmo cuidado pras mensagens ÓRFÃS (sem client_id)
      -- casadas por telefone (FASE LEGAL-1B) — elas podem ter sido
      -- "resolvidas" por uma thread de QUALQUER cliente do mesmo dono (ou
      -- sem cliente nenhum), já que a mensagem em si nunca teve client_id
      -- pra restringir a busca.
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

COMMIT;
