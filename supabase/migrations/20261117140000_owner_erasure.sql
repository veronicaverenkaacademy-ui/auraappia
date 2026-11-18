-- FASE LEGAL-2 — exclusão ATÔMICA da conta da PROFISSIONAL (dona), espelhando
-- o padrão de client_erasure_plan/erase_client_data (LEGAL-1/1B/1C), mas com
-- a política OPOSTA por decisão explícita da dona (D1, 17/11/2026), que
-- reflete a Política de Privacidade aprovada pela advogada
-- (src/routes/politica-de-privacidade.tsx, seção 7): "Quando a Profissional
-- exclui a conta, os dados do estúdio e de suas clientes são apagados, salvo
-- o que a lei exigir guardar." Logo, ao contrário de erase_client_data (que
-- ANONIMIZA e preserva o ledger de consentimentos via purge_client_consent_pii):
-- esta função APAGA client_consents, client_anamnesis, client_photos,
-- mensagens, agenda e clients por completo. erase_client_data e
-- purge_client_consent_pii NÃO SÃO TOCADAS — o caminho de exclusão da
-- CLIENTE continua anonimizando, sem mudança nenhuma.
--
-- ESTA MIGRAÇÃO NÃO FOI APLICADA EM PRODUÇÃO NESTA FASE — só branch nova +
-- PR em DRAFT. A aplicação real (e a suíte supabase/tests/owner_erasure.sql,
-- que não foi executada nesta fase) só ocorrem com autorização explícita
-- posterior ("AUTORIZO APLICAR MIGRAÇÃO FASE LEGAL-2").
--
-- INTROSPECÇÃO REAL DE PRODUÇÃO QUE GUIOU ESTE DESENHO (somente SELECT,
-- 17/11/2026, sem nenhuma alteração):
--   - QUASE toda tabela com owner_id tem FK direta pra auth.users(id) ON
--     DELETE CASCADE (confirmado via pg_constraint, não information_schema —
--     este último, por alguma particularidade de visibilidade cross-schema
--     deste projeto, não lista nenhuma FK contra auth.users mesmo quando ela
--     existe; pg_constraint com confrelid = 'auth.users'::regclass é a fonte
--     confiável usada aqui). Isso inclui client_consents.owner_id e
--     clients.owner_id — ou seja, hoje, só chamar auth.admin.deleteUser já
--     dispara uma cascata que apaga o ledger de consentimentos e a ficha
--     inteira, sem meio-termo de anonimização (a função antiga em TS tentava
--     anonimizar clients/appointments antes, mas isso não sobrevivia à
--     cascata de qualquer forma). Com D1, isso deixou de ser um problema —
--     é exatamente o comportamento desejado agora — mas esta função faz a
--     limpeza de forma EXPLÍCITA, ordenada e numa ÚNICA transação, em vez de
--     depender da ordem de resolução interna da cascata do Postgres (que,
--     mesmo quando funciona, não dá contagem nem controle de falha parcial).
--   - trg_10_client_consents_block_mutation (migração 20261115120000):
--     bloqueia DELETE direto em client_consents, EXCETO quando a linha de
--     `clients` (via client_id) OU a linha de `auth.users` (via owner_id) já
--     não existem mais — carve-out desenhado exatamente para isto. Como o
--     owner (auth.users) só é apagado pelo ORQUESTRADOR, depois desta
--     função, a função apaga `clients` ANTES de apagar `client_consents` —
--     cada um como sua própria instrução DELETE, nunca dependendo de uma
--     cascata entre elas: a instrução que apaga `clients` roda e É
--     CONCLUÍDA primeiro (dentro da mesma transação); só então a instrução
--     seguinte apaga `client_consents`, e a checagem "NOT EXISTS clients"
--     do trigger já vê a linha-pai como removida. Confirmado empiricamente
--     na suíte (2.1(d)/2.4(iii)) — não é só leitura de código.
--   - whatsapp_central_threads.resolved_by_message_id e
--     whatsapp_confirmation_threads.resolved_by_message_id → ambas sem ON
--     DELETE (NO ACTION) pra whatsapp_messages(id), igual ao defeito já
--     corrigido em erase_client_data (FASE LEGAL-1C) — mesma correção
--     aplicada aqui: zera as duas colunas ANTES de apagar whatsapp_messages.
--   - team_members.access_level_id → access_levels(id) ON DELETE RESTRICT;
--     team_members.owner_id não tem FK pra auth.users; team_members.user_id
--     tem FK pra auth.users, mas ON DELETE SET NULL (confirmado via
--     pg_constraint — confdeltype='n', não 'a'/NO ACTION). Isso significa:
--     uma colaboradora 'terminated' (que não bloqueia a exclusão) nunca
--     seria limpa pela cascata nem pela rotina antiga — e, se ainda
--     referenciasse um access_level, bloquearia a cascata de access_levels
--     (CASCADE de auth.users) com RESTRICT, fazendo o auth.admin.deleteUser
--     final falhar.
--     FASE LEGAL-2C (18/11/2026) — correção da correção: a primeira versão
--     desta função zerava team_members.access_level_id via UPDATE antes do
--     DELETE. Descoberto (empiricamente, contra produção, dentro de
--     BEGIN...ROLLBACK, nada aplicado) que isso quebra de verdade: existe um
--     trigger `trg_protect_access_level_id_update` (BEFORE UPDATE em
--     team_members, função protect_access_level_id_update) que só libera a
--     troca de access_level_id quando auth.uid() = owner_id OU
--     staff_can(...) — SEM bypass pra service_role (ao contrário de
--     automations_protect_system_delete, que usa aura_system_bypass() e por
--     isso não bloqueia). Chamado como service_role (como erase_owner_data
--     sempre é), auth.uid() é NULL e staff_can() devolve false — o UPDATE
--     sempre falhava com "Você não tem permissão para alterar o nível de
--     acesso desta colaboradora." (P0001), pra QUALQUER owner real que já
--     teve colaboradora com access_level_id preenchido (o caso comum, não
--     uma exceção). RESOLVIDO sem o UPDATE: basta apagar team_members (o
--     FILHO) ANTES de access_levels (o PAI, mais abaixo) — quando a linha
--     de access_levels for apagada, zero linhas de team_members ainda a
--     referenciam, então o RESTRICT nunca dispara. Confirmado empiricamente
--     (mesmo ambiente, mesma técnica) que esta ordem, sem UPDATE nenhum,
--     passa sem erro.
--   - portal_configurations.owner_id → company_profiles(owner_id) ON DELETE
--     CASCADE (não é FK direta pra auth.users); published_by/updated_by →
--     auth.users(id) SEM ON DELETE. Como esta função apaga
--     portal_configurations explicitamente (não depende da cascata via
--     company_profiles), published_by/updated_by nunca chegam a ser
--     checados contra um owner ainda vivo nem contra um owner já removido
--     por outra via — a própria linha já não existe mais quando
--     auth.admin.deleteUser rodar depois.
--   - company_profiles.portal_media_key (uuid, default gen_random_uuid()) —
--     NÃO é o owner_id. É a chave real usada como prefixo de pasta no bucket
--     portal-media (ver buildMediaPath em src/lib/portal/portal-media.ts:
--     "{mediaKey}/{kind}/{fileId}.{ext}"). O plano devolve esse valor
--     explicitamente — limpar o bucket portal-media usando owner_id como
--     prefixo (engano fácil) não apagaria nada de verdade.
--   - client_photos.storage_path (text, not null) já guarda o caminho real
--     de cada foto no bucket client-photos — o plano usa isso direto, sem
--     precisar listar pastas do Storage (mais simples e mais confiável que
--     a função antiga, que listava subpastas na hora).
--   - finance_transactions.owner_id NÃO tem FK declarada pra auth.users (não
--     apareceu na consulta de pg_constraint) — a linha sobrevive à cascata
--     por padrão. D1 não menciona finance_transactions explicitamente (só
--     cita client_consents/anamnesis/photos/mensagens/agenda/clientes) e o
--     comentário original do código já citava motivo fiscal — mantido o
--     comportamento ATUAL (description zerada, linha preservada), sem
--     mudança de política aqui; só centralizado nesta função por
--     atomicidade.
--
-- GRANTS/SECURITY: erase_owner_data segue o mesmo padrão de
-- erase_client_data/purge_client_consent_pii — SEM SECURITY DEFINER
-- (service_role já tem ALL grant em todas as tabelas que ela toca,
-- confirmado por information_schema.role_table_grants), só
-- SET search_path = public + REVOKE ALL FROM PUBLIC, anon, authenticated +
-- GRANT EXECUTE TO service_role. owner_erasure_plan é a ÚNICA exceção
-- (ver comentário dela): é SECURITY DEFINER porque precisa ler auth.users,
-- onde service_role não tem GRANT de tabela nesta base — com guarda
-- explícita via aura_private.aura_system_bypass().
--
-- IDEMPOTENTE: toda condição é "WHERE owner_id = _owner_id" (ou equivalente)
-- — reexecutar depois de já ter concluído tudo encontra zero linhas em toda
-- parte e devolve contagens zero, nunca erro (necessário pra retry quando
-- Storage ou auth.admin.deleteUser falham DEPOIS desta função, no
-- orquestrador TS). NÃO apaga profiles nem auth.users — isso é
-- responsabilidade do orquestrador (auth.admin.deleteUser cuida da cascata
-- restante, que a essa altura já está vazia).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===================== SEÇÃO A — plano somente leitura =====================
-- FASE LEGAL-2C (18/11/2026): esta função PRECISA ler auth.users (para
-- 'owner_exists') — confirmado empiricamente, contra produção, dentro de
-- BEGIN...ROLLBACK, que service_role NÃO tem GRANT de tabela em auth.users
-- neste projeto (information_schema.role_table_grants só lista 'postgres';
-- erro real reproduzido: "permission denied for table users", com o HINT do
-- próprio Postgres confirmando a ausência do GRANT). Sem isso, TODA chamada
-- do orquestrador (sempre via service_role) falharia já no primeiro passo,
-- antes de tocar em qualquer dado — pior que o bug do passo 4, que só afeta
-- quem tem colaboradora com access_level. Por isso, diferente de
-- erase_owner_data (que nunca toca auth.users e continua sem
-- SECURITY DEFINER, como client_erasure_plan/erase_client_data), esta
-- função é SECURITY DEFINER — mesmo padrão já usado no projeto pra tocar
-- auth.users (handle_new_user, grant_admin_on_new_user,
-- seed_access_levels_on_new_admin, seed_system_automations_on_new_admin,
-- todas SECURITY DEFINER) — com guarda explícita reaproveitando
-- aura_private.aura_system_bypass() (mesma função que já protege
-- automations_protect_system_delete): só passa quando chamada como
-- service_role sem JWT de usuário (auth.uid() IS NULL) — a mesma condição
-- que o GRANT EXECUTE abaixo já deveria garantir, mas a guarda fica como
-- defesa em profundidade caso o GRANT seja alterado por engano no futuro.
CREATE OR REPLACE FUNCTION public.owner_erasure_plan(_owner_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _result jsonb;
BEGIN
  IF NOT aura_private.aura_system_bypass() THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'AURA_OWNER_ERASURE_PLAN_FORBIDDEN: só service_role pode chamar esta função.';
  END IF;

  SELECT jsonb_build_object(
    'owner_exists', EXISTS (SELECT 1 FROM auth.users WHERE id = _owner_id),
    'active_team_count', (
      SELECT count(*) FROM public.team_members
      WHERE owner_id = _owner_id AND status <> 'terminated'
    ),
    'counts', jsonb_build_object(
      'clients', (SELECT count(*) FROM public.clients WHERE owner_id = _owner_id),
      'appointments', (SELECT count(*) FROM public.appointments WHERE owner_id = _owner_id),
      'client_anamnesis', (SELECT count(*) FROM public.client_anamnesis WHERE owner_id = _owner_id),
      'client_photos', (SELECT count(*) FROM public.client_photos WHERE owner_id = _owner_id),
      'client_consents', (SELECT count(*) FROM public.client_consents WHERE owner_id = _owner_id),
      'whatsapp_messages', (SELECT count(*) FROM public.whatsapp_messages WHERE owner_id = _owner_id),
      'whatsapp_central_threads', (SELECT count(*) FROM public.whatsapp_central_threads WHERE owner_id = _owner_id),
      'whatsapp_confirmation_threads', (SELECT count(*) FROM public.whatsapp_confirmation_threads WHERE owner_id = _owner_id),
      'whatsapp_blocked_recipients', (SELECT count(*) FROM public.whatsapp_blocked_recipients WHERE owner_id = _owner_id),
      'whatsapp_instances', (SELECT count(*) FROM public.whatsapp_instances WHERE owner_id = _owner_id),
      'conversations', (SELECT count(*) FROM public.conversations WHERE owner_id = _owner_id),
      'notification_jobs', (SELECT count(*) FROM public.notification_jobs WHERE owner_id = _owner_id),
      'marketing_sends', (SELECT count(*) FROM public.marketing_sends WHERE owner_id = _owner_id),
      'team_members', (SELECT count(*) FROM public.team_members WHERE owner_id = _owner_id),
      'access_levels', (SELECT count(*) FROM public.access_levels WHERE owner_id = _owner_id),
      'portal_configurations', (SELECT count(*) FROM public.portal_configurations WHERE owner_id = _owner_id),
      'portal_service_categories', (SELECT count(*) FROM public.portal_service_categories WHERE owner_id = _owner_id),
      'services', (SELECT count(*) FROM public.services WHERE owner_id = _owner_id),
      'app_notifications', (SELECT count(*) FROM public.app_notifications WHERE owner_id = _owner_id),
      'company_profiles', (SELECT count(*) FROM public.company_profiles WHERE owner_id = _owner_id)
    ),
    'storage', jsonb_build_object(
      'company_assets_paths', jsonb_build_array(_owner_id::text || '/logo', _owner_id::text || '/cover'),
      'client_photos_paths', COALESCE(
        (SELECT jsonb_agg(storage_path) FROM public.client_photos WHERE owner_id = _owner_id),
        '[]'::jsonb
      ),
      'portal_media_key', (SELECT to_jsonb(portal_media_key) FROM public.company_profiles WHERE owner_id = _owner_id)
    ),
    'portal_account_candidates', COALESCE(
      (SELECT jsonb_agg(user_id) FROM public.clients WHERE owner_id = _owner_id AND user_id IS NOT NULL),
      '[]'::jsonb
    )
  )
  INTO _result;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_erasure_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owner_erasure_plan(uuid) TO service_role;

-- ===================== SEÇÃO B — erasure transacional =====================
CREATE OR REPLACE FUNCTION public.erase_owner_data(_owner_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _active_team_count integer;
  _n jsonb := '{}'::jsonb;
  _c integer;
BEGIN
  -- Passo 0 — guarda: equipe ativa bloqueia (mesma regra de
  -- checkAccountDeletionEligibility/deleteOwnerAccount hoje; 'terminated'
  -- não bloqueia).
  SELECT count(*) INTO _active_team_count
  FROM public.team_members WHERE owner_id = _owner_id AND status <> 'terminated';
  IF _active_team_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UC010',
      MESSAGE = 'AURA_OWNER_ERASURE_ACTIVE_TEAM: existem colaboradoras com vínculo ativo.';
  END IF;

  -- Passo 1 — zera resolved_by_message_id (as DUAS tabelas de thread) ANTES
  -- de apagar whatsapp_messages — mesma correção de FASE LEGAL-1C, aqui
  -- escopada por owner_id (não por client_id: esta função apaga TUDO do
  -- estúdio, não uma cliente por vez).
  UPDATE public.whatsapp_central_threads
  SET resolved_by_message_id = NULL
  WHERE resolved_by_message_id IN (SELECT id FROM public.whatsapp_messages WHERE owner_id = _owner_id);
  UPDATE public.whatsapp_confirmation_threads
  SET resolved_by_message_id = NULL
  WHERE resolved_by_message_id IN (SELECT id FROM public.whatsapp_messages WHERE owner_id = _owner_id);

  -- Passo 2 — WhatsApp (mensagens, as duas tabelas de thread, bloqueios,
  -- instância — o token já foi revogado pelo orquestrador ANTES desta
  -- chamada, melhor esforço, fora da transação SQL).
  DELETE FROM public.whatsapp_messages WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('whatsapp_messages_deleted', _c);

  DELETE FROM public.whatsapp_central_threads WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('whatsapp_central_threads_deleted', _c);

  DELETE FROM public.whatsapp_confirmation_threads WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('whatsapp_confirmation_threads_deleted', _c);

  DELETE FROM public.whatsapp_blocked_recipients WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('whatsapp_blocked_recipients_deleted', _c);

  DELETE FROM public.whatsapp_instances WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('whatsapp_instances_deleted', _c);

  -- Passo 3 — demais tabelas operacionais já cobertas hoje (as mesmas que
  -- deleteByOwner em account-deletion.functions.ts já apagava, agora dentro
  -- da transação) + conversations/messages (chat legado).
  DELETE FROM public.client_anamnesis WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('client_anamnesis_deleted', _c);

  DELETE FROM public.client_photos WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('client_photos_deleted', _c);

  DELETE FROM public.messages msg
  WHERE msg.conversation_id IN (SELECT id FROM public.conversations WHERE owner_id = _owner_id);
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('conversation_messages_deleted', _c);

  DELETE FROM public.conversations WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('conversations_deleted', _c);

  DELETE FROM public.notification_jobs WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('notification_jobs_deleted', _c);

  DELETE FROM public.marketing_sends WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('marketing_sends_deleted', _c);

  DELETE FROM public.service_materials WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('service_materials_deleted', _c);

  DELETE FROM public.stock_movements WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('stock_movements_deleted', _c);

  DELETE FROM public.products WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('products_deleted', _c);

  DELETE FROM public.product_batches WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('product_batches_deleted', _c);

  DELETE FROM public.suppliers WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('suppliers_deleted', _c);

  DELETE FROM public.agenda_blocks WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('agenda_blocks_deleted', _c);

  DELETE FROM public.finance_goals WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('finance_goals_deleted', _c);

  DELETE FROM public.finance_settings WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('finance_settings_deleted', _c);

  DELETE FROM public.automations WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('automations_deleted', _c);

  DELETE FROM public.journeys WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('journeys_deleted', _c);

  DELETE FROM public.message_templates WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('message_templates_deleted', _c);

  DELETE FROM public.communication_provider_config WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('communication_provider_config_deleted', _c);

  -- Passo 4 — equipe (inclui 'terminated', que não bloqueou o passo 0) ANTES
  -- de access_levels (passo 7) — team_members.access_level_id é ON DELETE
  -- RESTRICT, mas isso só importa enquanto a linha-filha existir: apagando
  -- TODO team_members do owner aqui, antes de chegar em access_levels mais
  -- abaixo, zero linhas restam referenciando qualquer access_level deste
  -- owner — o RESTRICT nunca dispara. NUNCA fazer UPDATE SET access_level_id
  -- = NULL aqui (ver comentário do topo do arquivo, FASE LEGAL-2C): esse
  -- UPDATE é bloqueado pelo trigger protect_access_level_id_update mesmo
  -- como service_role, pra qualquer owner real com colaboradora já
  -- vinculada a um access_level.
  DELETE FROM public.team_members WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('team_members_deleted', _c);

  -- Passo 5 — portal_configurations/portal_service_categories/services (sem
  -- depender da cascata via company_profiles).
  DELETE FROM public.portal_configurations WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('portal_configurations_deleted', _c);

  DELETE FROM public.portal_service_categories WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('portal_service_categories_deleted', _c);

  DELETE FROM public.services WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('services_deleted', _c);

  -- Passo 6 — appointments e clients (D1: apagar de verdade, nunca
  -- anonimizar). Cada DELETE é sua própria instrução, concluída antes da
  -- próxima — client_consents (passo 6b) depende de `clients` já estar
  -- fisicamente removida quando ELA rodar (ver carve-out do trigger no
  -- comentário do topo do arquivo).
  DELETE FROM public.appointments WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('appointments_deleted', _c);

  -- Contagem ANTES de apagar `clients`: client_consents.client_id é ON
  -- DELETE CASCADE a partir de clients — confirmado empiricamente (suíte
  -- local) que o DELETE FROM clients abaixo já remove essas linhas na MESMA
  -- instrução, então um GET DIAGNOSTICS depois dele veria sempre 0 (não é
  -- bug, é só o CASCADE chegando primeiro). Conta aqui pra reportar o
  -- número real apagado, não "0 porque já tinha ido".
  SELECT count(*) INTO _c FROM public.client_consents WHERE owner_id = _owner_id;
  _n := _n || jsonb_build_object('client_consents_deleted', _c);

  DELETE FROM public.clients WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('clients_deleted', _c);

  -- Passo 6b — defensivo: se por algum motivo sobrar alguma linha de
  -- client_consents deste owner (ex.: client_id que não tinha mais
  -- `clients` pai por algum outro caminho), apaga explicitamente aqui.
  -- Pelo carve-out do trigger de imutabilidade, isso só é permitido porque
  -- o DELETE FROM clients acima já concluiu (nunca na mesma instrução).
  -- Normalmente 0 linhas (o CASCADE do passo anterior já cobre o caso
  -- comum) — mantido por defesa em profundidade, não por necessidade hoje.
  DELETE FROM public.client_consents WHERE owner_id = _owner_id;

  -- Passo 7 — access_levels (agora seguro: nenhum team_members restante
  -- referencia nenhum access_level deste owner).
  DELETE FROM public.access_levels WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('access_levels_deleted', _c);

  -- user_roles, app_notifications, company_profiles — já seriam apagadas
  -- pela cascata de auth.users de qualquer forma (confirmado via
  -- pg_constraint), mas apagadas aqui explicitamente também, pra esta
  -- função sozinha já deixar ZERO linhas deste owner em toda tabela com
  -- owner_id/user_id, sem depender da ordem de resolução da cascata.
  DELETE FROM public.user_roles WHERE user_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('user_roles_deleted', _c);

  DELETE FROM public.app_notifications WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('app_notifications_deleted', _c);

  DELETE FROM public.company_profiles WHERE owner_id = _owner_id;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('company_profiles_deleted', _c);

  -- finance_transactions: comportamento INALTERADO (description zerada,
  -- linha preservada por entendimento de retenção fiscal — D1 não cita esta
  -- tabela; só centralizado aqui por atomicidade, nenhuma mudança de
  -- política).
  UPDATE public.finance_transactions SET description = NULL
  WHERE owner_id = _owner_id AND description IS NOT NULL;
  GET DIAGNOSTICS _c = ROW_COUNT; _n := _n || jsonb_build_object('finance_transactions_scrubbed', _c);

  -- audit_log: NUNCA apagado (D1) — 1 linha genérica registrando a
  -- exclusão, sem nenhum dado pessoal (contagens já são agregadas, nunca
  -- client_id/user_id/telefone/nome).
  INSERT INTO public.audit_log (owner_id, actor_id, action, resource, details)
  VALUES (_owner_id, _owner_id, 'account_deleted', 'professional_account', _n);

  RETURN _n;
END;
$$;

REVOKE ALL ON FUNCTION public.erase_owner_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_owner_data(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
