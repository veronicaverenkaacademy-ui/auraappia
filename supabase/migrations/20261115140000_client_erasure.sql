-- FASE LEGAL-1 REDUZIDA — exclusão completa dos dados da cliente quando ela
-- exclui a própria conta no Portal (LGPD + exigência da Apple de exclusão de
-- conta de verdade). APPLE-1 (desconectar a conta Apple) é outra fase, não
-- implementada aqui.
--
-- ESTA MIGRAÇÃO NÃO FOI APLICADA EM PRODUÇÃO NESTA FASE — só branch nova +
-- PR em DRAFT, por instrução explícita da dona.
--
-- CONTEXTO (por que cada decisão):
--   - clients NUNCA é excluído fisicamente por esta rotina — só ANONIMIZADO
--     (full_name/phone/email/birthday/cpf/notes/how_found/avatar_url/tags
--     zerados, user_id posto a NULL). Dois motivos, os dois definitivos:
--     (1) appointments.client_id é ON DELETE CASCADE — excluir `clients`
--     apagaria todo o histórico financeiro/de atendimentos do estúdio; (2)
--     client_consents.client_id também é CASCADE e é a prova mínima de
--     consentimento (CONSENT-1A, migration 20261115120000) — ela só
--     sobrevive enquanto `clients` pai existir. A política "o que é
--     apagado" fica INTEIRA dentro desta função (está pendente resposta da
--     advogada sobre prazo legal de guarda da ficha — ajustar aqui no
--     futuro, não espalhado pelo app).
--   - Coluna nova clients.deleted_by_client_at (nullable, sem default):
--     marca que ESTA linha foi anonimizada pela própria cliente (distingue
--     de uma edição/anonimização feita pela profissional). Usada só para
--     diagnóstico/relatório nesta fase — nenhuma tela lê esta coluna.
--   - Não há UNIQUE em clients(owner_id, phone) hoje (confirmado via
--     pg_indexes) — o único UNIQUE relevante é
--     clients_owner_user_unique_idx em (owner_id, user_id) WHERE user_id IS
--     NOT NULL. Zerar user_id (comportamento que o código TS já tinha) é o
--     que libera esse slot para um novo cadastro futuro; zerar phone é só
--     política de privacidade, não é exigido por nenhuma constraint.
--   - whatsapp_otp_send_log: NENHUMA ação. A tabela (20261114120000) já foi
--     desenhada para nunca gravar telefone, client_id ou qualquer coisa que
--     identifique a cliente (só owner_id/template_name/outcome/códigos de
--     erro) — continua servindo de limitador de abuso sem guardar nada
--     dela.
--   - whatsapp_blocked_recipients não tem client_id — é limpa por
--     (owner_id, últimos 8 dígitos do telefone ANTIGO da cliente), lido
--     ANTES de clients.phone ser zerado, dentro da mesma transação.
--   - appointments: FUTUROS e ainda não concluídos (status NOT IN
--     ('completed','cancelled','no_show') AND starts_at > now()) são
--     cancelados por UPDATE DIRETO — nunca pelo fluxo de cancelamento da
--     cliente (cancelClientAppointment/agenda-cancelled-actions), que
--     dispara aviso no sino da profissional. Confirmado lendo as 5 triggers
--     reais de `appointments`: consume_appointment_materials,
--     record_appointment_revenue e record_commission_snapshot só agem em
--     transição PARA/DE 'completed' — nunca disparam aqui, pois só
--     cancelamos agendamentos que NUNCA chegaram a 'completed';
--     enqueue_appointment_whatsapp_jobs (BEFORE UPDATE) só zera os
--     reminder_*_sent_at e marca notification_jobs PENDENTES como
--     'cancelled' — nunca insere nem envia nada. Nenhuma trigger envia
--     WhatsApp ou notifica a profissional neste caminho. PASSADOS/
--     concluídos/já cancelados ficam intactos, ligados à linha anonimizada
--     (histórico financeiro do estúdio preservado, sem identificação).
--   - notification_jobs da cliente são SEMPRE apagados (todos, não só
--     pendentes) — toda linha tem recipient_phone (NOT NULL, identificante)
--     e a tabela não é registro financeiro; isso também garante "nenhum
--     job pendente" por construção.
--   - Aviso no sino: 1 linha em app_notifications por estúdio vinculado,
--     kind='client_account_deleted', sem nenhum dado pessoal, com
--     dedupe_key determinístico (usa o índice único
--     app_notifications_dedupe_idx já existente — idempotente, nunca
--     duplica em reexecução).
--   - conversations/messages (chat legado, sem referência em código vivo
--     hoje — grep confirmado) incluídas por completude: têm client_id
--     direto e colunas identificantes reais (contact_phone/contact_name/
--     content).
--
-- ORDEM/ATOMICIDADE (orquestrada pela camada TS, src/lib/client-erasure.server.ts):
--   1. client_erasure_plan(_user_id) — SOMENTE LEITURA, devolve contagens e
--      storage_paths; se a função não existir ainda (esta migração não
--      aplicada), a chamada falha com "function does not exist" e a camada
--      TS aborta ANTES de apagar qualquer coisa (modo seguro).
--   2. Apaga arquivos reais do bucket client-photos (melhor esforço, "não
--      encontrado" conta como sucesso — idempotente em retry).
--   3. erase_client_data(_user_id) — UMA transação, tudo ou nada.
--   4. auth.admin.deleteUser(userId) — por último, só se 1-3 deram certo.
-- IDEMPOTENTE: _user_id é resolvido para as linhas de `clients` em tempo
-- real DENTRO da própria função (nunca recebe uma lista de ids pronta) —
-- reexecutar depois de uma anonimização parcial só encontra o que falta
-- fazer; nada "já não existe" vira erro. Chamar de novo depois de já ter
-- concluído tudo encontra zero linhas (user_id já é NULL) e não faz nada.
--
-- Idempotente (CREATE OR REPLACE FUNCTION, ADD COLUMN IF NOT EXISTS) —
-- seguro reaplicar. Só adiciona (nenhuma coluna/tabela/política existente é
-- alterada, além do ADD COLUMN novo em clients). service_role já tem ALL
-- grant em todas as tabelas tocadas (confirmado via
-- information_schema.role_table_grants) — por isso nenhuma das duas
-- funções precisa de SECURITY DEFINER, mesmo padrão de
-- purge_client_consent_pii.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ===================== SEÇÃO A — coluna nova em clients =====================
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS deleted_by_client_at timestamptz NULL;

-- ===================== SEÇÃO B — plano somente leitura =====================
-- Nunca apaga nada; só lê. Serve de (a) checagem de existência da migração
-- pela camada TS e (b) fonte dos storage_path que a camada TS precisa
-- apagar do bucket ANTES de chamar erase_client_data.
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

-- ===================== SEÇÃO C — erasure transacional =====================
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

    -- Consentimentos: mantém só a prova mínima (nunca apaga a linha).
    SELECT public.purge_client_consent_pii(_client.id) INTO _n_consents_purged;

    DELETE FROM public.client_anamnesis WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_anamnesis = ROW_COUNT;

    -- Linhas de fotos: os arquivos reais no Storage já foram apagados pela
    -- camada TS ANTES desta chamada, usando os storage_path devolvidos por
    -- client_erasure_plan.
    DELETE FROM public.client_photos WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_photos = ROW_COUNT;

    DELETE FROM public.whatsapp_messages WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_messages = ROW_COUNT;

    DELETE FROM public.whatsapp_central_threads WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_central = ROW_COUNT;

    DELETE FROM public.whatsapp_confirmation_threads WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_confirmation = ROW_COUNT;

    -- Bloqueios de WhatsApp (sem client_id — casa por telefone ANTIGO,
    -- lido acima, antes de zerar clients.phone nesta mesma transação).
    IF _old_phone IS NOT NULL THEN
      DELETE FROM public.whatsapp_blocked_recipients wbr
      WHERE wbr.owner_id = _client.owner_id
        AND right(regexp_replace(wbr.phone_e164, '\D', '', 'g'), 8)
          = right(regexp_replace(_old_phone, '\D', '', 'g'), 8);
      GET DIAGNOSTICS _n_blocked = ROW_COUNT;
    ELSE
      _n_blocked := 0;
    END IF;

    -- Chat legado (conversations/messages) — por completude.
    DELETE FROM public.messages msg
    WHERE msg.conversation_id IN (SELECT id FROM public.conversations WHERE client_id = _client.id);
    GET DIAGNOSTICS _n_conv_messages = ROW_COUNT;
    DELETE FROM public.conversations WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_conversations = ROW_COUNT;

    -- Agendamentos futuros ainda não concluídos: cancela por UPDATE
    -- DIRETO — nunca envia WhatsApp nem notifica a profissional (ver
    -- comentário no topo do arquivo sobre as triggers reais de
    -- appointments). Passados/concluídos/já cancelados ficam intactos.
    UPDATE public.appointments
    SET status = 'cancelled'
    WHERE client_id = _client.id
      AND starts_at > now()
      AND status NOT IN ('completed', 'cancelled', 'no_show');
    GET DIAGNOSTICS _n_cancelled = ROW_COUNT;

    -- notification_jobs: apagados por completo (todos, não só pendentes) —
    -- toda linha tem recipient_phone identificante; garante por construção
    -- que nenhum job fica pendente para os agendamentos desta cliente.
    DELETE FROM public.notification_jobs WHERE client_id = _client.id;
    GET DIAGNOSTICS _n_jobs = ROW_COUNT;

    -- Anonimiza (nunca exclui) a linha de clients.
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

    -- Aviso discreto no sino da profissional — sem nenhum dado pessoal,
    -- idempotente via dedupe_key (índice único existente
    -- app_notifications_dedupe_idx em (owner_id, dedupe_key)).
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
