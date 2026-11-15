-- FASE CONSENT-1A — suíte da migração 20261115120000_client_consents.sql.
--
-- NÃO EXECUTADA contra produção nesta fase (branch nova + PR em DRAFT, por
-- instrução explícita da dona — "a migração NÃO é aplicada nesta fase").
-- Rodada LOCALMENTE (Postgres 16 deste ambiente, banco descartável
-- `consent_1a_test`, NUNCA o banco de produção da dona) — ver saída colada
-- no relatório final da fase. Pressupõe que auth.users, public.clients e
-- staff_can()/team_members/team_permissions/access_level_permissions já
-- existem (verdade em produção; localmente, um bootstrap fora deste
-- arquivo — nunca committed — recria versões mínimas e fiéis dessas
-- mesmas peças antes de rodar esta suíte).
--
-- Mesmo padrão de supabase/tests/whatsapp_otp_send_log.sql: fixtures
-- sintéticas zzfx_, tudo dentro de BEGIN...ROLLBACK, DDL colado na
-- íntegra (migração e rollback, exatamente como os arquivos reais), lógica
-- de teste em blocos DO $$ separados, resultados agregados numa tabela
-- temporária e impressos com um SELECT final (JSON). Nunca COMMIT.
--
-- Ciclo cobrado pela fase: 0) confirma que client_consents NÃO existe
-- ainda; 1) fixtures (2 owners/salões, 1 colaboradora SEM permissão, 1
-- colaboradora COM permissão, 2 clientes — um por salão); 2) aplica a
-- migração; 3) verificação estrutural (RLS, GRANT/REVOKE, CHECKs, FK,
-- índices); 4) RLS funcional (authenticated sem INSERT/UPDATE/DELETE
-- mesmo tendo staff_can=true; dona vê os próprios registros; colaboradora
-- sem permissão NÃO vê; colaboradora com permissão VÊ; salão A nunca vê
-- nada do salão B); 5) CHECKs de domínio (consent_type/choice/
-- document_key/source inválidos rejeitados; granted_no_face fora de
-- image_use rejeitado; granted_no_face dentro de image_use aceito;
-- evidence_user_agent > 300 chars rejeitado); 6) imutabilidade (UPDATE
-- comum bloqueado p/ authenticated E p/ service_role; DELETE bloqueado
-- para QUALQUER papel, inclusive service_role); 7) caminho de limpeza
-- (purge_client_consent_pii só authenticated/anon não podem executar;
-- service_role consegue; zera só as 3 colunas de PII; tipo/escolha/
-- versão/data/fonte sobrevivem intactos; tentar, DENTRO do mesmo caminho,
-- tocar outra coluna continua bloqueado); 8) ON DELETE CASCADE
-- (excluir o client_id apaga os consents dele; excluir o owner_id —
-- "a dona exclui a própria conta" — apaga em cascata clients +
-- client_consents do salão, exatamente como já acontece hoje com
-- client_anamnesis/client_photos); 9) aplica o rollback; 10) confirma que
-- a tabela/funções somem (com backup preservado); 11) reaplica a migração
-- e confirma que volta a funcionar. Nunca COMMIT.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

CREATE TEMP TABLE zzfx_cc_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_cc_ids (chave text PRIMARY KEY, valor uuid) ON COMMIT DROP;
-- Passo 4 faz SET ROLE authenticated/anon pra provar a RLS de verdade (não
-- só checar GRANT/policy estruturalmente) — essas tabelas TEMP precisam
-- continuar legíveis/graváveis por qualquer papel durante a troca.
GRANT ALL ON zzfx_cc_results TO PUBLIC;
GRANT ALL ON zzfx_cc_ids TO PUBLIC;
GRANT ALL ON SEQUENCE zzfx_cc_results_ordem_seq TO PUBLIC;

-- ============================================================================
-- PASSO 0 — confirma que nada disto existe ainda
-- ============================================================================
DO $passo0$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.tables
    WHERE table_schema='public' AND table_name = 'client_consents';
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('00_tabela_nao_existe_ainda', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'purge_client_consent_pii';
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('00_funcao_purge_nao_existe_ainda', format('%s (esperado 0)', v_n), v_n = 0);
END $passo0$;

-- ============================================================================
-- PASSO 1 — fixtures: 2 salões (owner_a, owner_b), 1 cliente por salão,
-- 1 colaboradora SEM permissão de 'clients'/'view' no salão A, 1
-- colaboradora COM permissão.
-- ============================================================================
INSERT INTO zzfx_cc_ids (chave, valor) VALUES
  ('owner_a', gen_random_uuid()),
  ('owner_b', gen_random_uuid()),
  ('staff_no_perm', gen_random_uuid()),
  ('staff_with_perm', gen_random_uuid());

DO $setup$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='owner_a');
  v_owner_b uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='owner_b');
  v_staff_no uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='staff_no_perm');
  v_staff_yes uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='staff_with_perm');
  v_member_yes uuid;
  v_client_a uuid;
  v_client_b uuid;
  v_client_purge uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner_a, 'zz-fixture-owner-a@invalid.test'),
    (v_owner_b, 'zz-fixture-owner-b@invalid.test'),
    (v_staff_no, 'zz-fixture-staff-no@invalid.test'),
    (v_staff_yes, 'zz-fixture-staff-yes@invalid.test');

  INSERT INTO public.clients (owner_id, full_name) VALUES (v_owner_a, 'zz-fixture-cliente-a') RETURNING id INTO v_client_a;
  INSERT INTO public.clients (owner_id, full_name) VALUES (v_owner_b, 'zz-fixture-cliente-b') RETURNING id INTO v_client_b;
  -- cliente DEDICADA ao teste do Passo 7 (purge) — isolada de client_a, que
  -- recebe várias linhas sem PII nos Passos 4/5 (uma delas, 05i, com
  -- evidence_user_agent de 300 chars só pra testar o CHECK de tamanho —
  -- usar client_a no Passo 7 contaria essa linha também).
  INSERT INTO public.clients (owner_id, full_name) VALUES (v_owner_a, 'zz-fixture-cliente-purge') RETURNING id INTO v_client_purge;
  INSERT INTO zzfx_cc_ids (chave, valor) VALUES
    ('client_a', v_client_a), ('client_b', v_client_b), ('client_purge', v_client_purge);

  -- colaboradora SEM permissão: vínculo ativo no salão A, mas SEM linha de
  -- team_permissions/access_level_permissions concedendo 'clients'/'view'.
  INSERT INTO public.team_members (owner_id, user_id, status) VALUES (v_owner_a, v_staff_no, 'active');

  -- colaboradora COM permissão: vínculo ativo no salão A, com exceção
  -- individual (team_permissions) concedendo 'clients'/'view'.
  INSERT INTO public.team_members (owner_id, user_id, status) VALUES (v_owner_a, v_staff_yes, 'active') RETURNING id INTO v_member_yes;
  INSERT INTO public.team_permissions (member_id, resource, action, allowed) VALUES (v_member_yes, 'clients', 'view', true);
END $setup$;

DO $sentinela$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE 'zz-fixture-%@invalid.test';
  IF n <> 4 THEN RAISE EXCEPTION 'SENTINELA: esperado 4 usuários sintéticos, achei %', n; END IF;
END $sentinela$;

-- ============================================================================
-- PASSO 2 — aplica a migração (DDL colado, igual ao arquivo real)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.client_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (
    consent_type IN ('terms_privacy', 'health_data', 'image_use', 'marketing', 'whatsapp_reminders')
  ),
  choice text NOT NULL CHECK (choice IN ('granted', 'denied', 'granted_no_face')),
  document_key text NOT NULL CHECK (
    document_key IN ('termo-consentimento', 'politica-de-privacidade', 'termos-de-uso')
  ),
  document_version text NOT NULL,
  source text NOT NULL CHECK (source IN ('portal', 'studio_device', 'professional_assisted')),
  collected_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  signer_name text NULL,
  evidence_ip text NULL,
  evidence_user_agent text NULL,
  CONSTRAINT client_consents_no_face_only_image_use
    CHECK (choice <> 'granted_no_face' OR consent_type = 'image_use'),
  CONSTRAINT client_consents_user_agent_len
    CHECK (evidence_user_agent IS NULL OR char_length(evidence_user_agent) <= 300)
);

CREATE INDEX IF NOT EXISTS client_consents_client_type_idx
  ON public.client_consents (client_id, consent_type, created_at DESC);
CREATE INDEX IF NOT EXISTS client_consents_owner_idx
  ON public.client_consents (owner_id);

ALTER TABLE public.client_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_consents TO authenticated;
GRANT ALL ON public.client_consents TO service_role;

DROP POLICY IF EXISTS client_consents_owner_select ON public.client_consents;
CREATE POLICY client_consents_owner_select ON public.client_consents FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS client_consents_staff_select ON public.client_consents;
CREATE POLICY client_consents_staff_select ON public.client_consents FOR SELECT TO authenticated
  USING (staff_can(owner_id, 'clients', 'view'));

CREATE OR REPLACE FUNCTION public.client_consents_block_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id)
       OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.owner_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = 'UC001',
      MESSAGE = 'AURA_CONSENT_IMMUTABLE: client_consents é somente-inserção; nenhum registro pode ser excluído diretamente.';
  END IF;

  IF current_setting('aura_consent.cleanup_active', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UC001',
      MESSAGE = 'AURA_CONSENT_IMMUTABLE: client_consents é somente-inserção; use purge_client_consent_pii para anonimizar por exclusão de conta.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.consent_type IS DISTINCT FROM OLD.consent_type
     OR NEW.choice IS DISTINCT FROM OLD.choice
     OR NEW.document_key IS DISTINCT FROM OLD.document_key
     OR NEW.document_version IS DISTINCT FROM OLD.document_version
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.collected_by_user_id IS DISTINCT FROM OLD.collected_by_user_id
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UC002',
      MESSAGE = 'AURA_CONSENT_CLEANUP_SCOPE: a limpeza por exclusão de conta só pode alterar signer_name, evidence_ip e evidence_user_agent.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.client_consents_block_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_10_client_consents_block_mutation ON public.client_consents;
CREATE TRIGGER trg_10_client_consents_block_mutation
  BEFORE UPDATE OR DELETE ON public.client_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.client_consents_block_mutation();

CREATE OR REPLACE FUNCTION public.purge_client_consent_pii(_client_id uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _affected integer;
BEGIN
  PERFORM set_config('aura_consent.cleanup_active', 'on', true);
  UPDATE public.client_consents
  SET signer_name = NULL,
      evidence_ip = NULL,
      evidence_user_agent = NULL
  WHERE client_id = _client_id
    AND (signer_name IS NOT NULL OR evidence_ip IS NOT NULL OR evidence_user_agent IS NOT NULL);
  GET DIAGNOSTICS _affected = ROW_COUNT;
  PERFORM set_config('aura_consent.cleanup_active', 'off', true);
  RETURN _affected;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_client_consent_pii(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_client_consent_pii(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PASSO 3 — verificação estrutural
-- ============================================================================
DO $passo3$
DECLARE v_ok boolean;
BEGIN
  SELECT count(*) = 1 INTO v_ok FROM information_schema.tables
    WHERE table_schema='public' AND table_name = 'client_consents';
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('03_tabela_criada', 'client_consents existe', v_ok);

  SELECT relrowsecurity INTO v_ok FROM pg_class WHERE oid = 'public.client_consents'::regclass;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('03_rls_ligada', 'RLS ligada', v_ok);

  SELECT NOT (
    has_table_privilege('anon', 'public.client_consents', 'SELECT')
    OR has_table_privilege('anon', 'public.client_consents', 'INSERT')
    OR has_table_privilege('anon', 'public.client_consents', 'UPDATE')
    OR has_table_privilege('anon', 'public.client_consents', 'DELETE')
  ) INTO v_ok;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('03_anon_sem_nenhum_privilegio', 'anon sem SELECT/INSERT/UPDATE/DELETE', v_ok);

  SELECT has_table_privilege('authenticated', 'public.client_consents', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.client_consents', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.client_consents', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.client_consents', 'DELETE')
    INTO v_ok;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('03_authenticated_so_select_grant', 'authenticated só tem GRANT de SELECT (sem INSERT/UPDATE/DELETE)', v_ok);

  SELECT has_table_privilege('service_role', 'public.client_consents', 'INSERT')
    AND has_table_privilege('service_role', 'public.client_consents', 'SELECT')
    AND has_table_privilege('service_role', 'public.client_consents', 'UPDATE')
    AND has_table_privilege('service_role', 'public.client_consents', 'DELETE')
    INTO v_ok;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('03_service_role_grant_total', 'service_role tem GRANT de tudo (o gatilho é quem bloqueia de fato)', v_ok);

  SELECT count(*) = 2 INTO v_ok FROM pg_policies
    WHERE schemaname='public' AND tablename='client_consents' AND cmd='SELECT';
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('03_duas_policies_select_owner_e_staff', '2 policies, ambas de SELECT (owner + staff_can)', v_ok);

  SELECT count(*) = 0 INTO v_ok FROM pg_policies
    WHERE schemaname='public' AND tablename='client_consents' AND cmd IN ('INSERT','UPDATE','DELETE');
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('03_nenhuma_policy_de_escrita', 'nenhuma policy de INSERT/UPDATE/DELETE', v_ok);

  SELECT count(*) = 3 INTO v_ok FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='client_consents' AND constraint_type='FOREIGN KEY';
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('03_tres_fks_no_total', '3 FKs no total (owner_id, client_id, collected_by_user_id)', v_ok);

  SELECT array_agg(column_name::text ORDER BY column_name) = ARRAY[
    'choice', 'client_id', 'collected_by_user_id', 'consent_type', 'created_at',
    'document_key', 'document_version', 'evidence_ip', 'evidence_user_agent',
    'id', 'owner_id', 'signer_name', 'source'
  ] INTO v_ok
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='client_consents';
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('03_conjunto_exato_de_colunas_sem_guardian_nem_signer_role', 'só as 13 colunas esperadas (sem guardian_name/guardian_document/signer_role)', v_ok);

  SELECT count(*) = 2 INTO v_ok FROM pg_indexes
    WHERE schemaname='public' AND tablename='client_consents' AND indexname != 'client_consents_pkey';
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('03_dois_indices_novos', 'client_consents_client_type_idx + client_consents_owner_idx', v_ok);

  SELECT count(*) = 1 INTO v_ok FROM pg_proc WHERE proname = 'purge_client_consent_pii';
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('03_funcao_purge_existe', 'purge_client_consent_pii existe', v_ok);

  SELECT NOT has_function_privilege('anon', 'public.purge_client_consent_pii(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.purge_client_consent_pii(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.purge_client_consent_pii(uuid)', 'EXECUTE')
    INTO v_ok;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('03_purge_so_service_role_executa', 'anon/authenticated SEM EXECUTE, service_role COM EXECUTE', v_ok);
END $passo3$;

-- ============================================================================
-- PASSO 4 — RLS funcional
-- ============================================================================
DO $passo4$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='owner_a');
  v_owner_b uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='owner_b');
  v_staff_no uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='staff_no_perm');
  v_staff_yes uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='staff_with_perm');
  v_client_a uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='client_a');
  v_client_b uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='client_b');
  v_id_a uuid;
  v_id_b uuid;
  v_n int;
  v_rejeitou boolean;
BEGIN
  -- Gravação SEMPRE como service_role (nenhum INSERT direto por authenticated
  -- existe no desenho) — simula o que supabaseAdmin faz pelas server functions.
  SET ROLE service_role;
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
  VALUES (v_owner_a, v_client_a, 'health_data', 'granted', 'termo-consentimento', '2026-08-04', 'studio_device')
  RETURNING id INTO v_id_a;
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
  VALUES (v_owner_b, v_client_b, 'health_data', 'granted', 'termo-consentimento', '2026-08-04', 'portal')
  RETURNING id INTO v_id_b;
  RESET ROLE;

  -- Dona do salão A (auth.uid() = owner_a, role authenticated) vê o próprio.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  SELECT count(*) INTO v_n FROM public.client_consents WHERE id = v_id_a;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('04a_dona_ve_o_proprio_registro', format('count=%s', v_n), v_n = 1);

  -- Dona do salão A NUNCA vê o do salão B.
  SELECT count(*) INTO v_n FROM public.client_consents WHERE id = v_id_b;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('04b_dona_a_nunca_ve_registro_do_salao_b', format('count=%s (esperado 0)', v_n), v_n = 0);

  -- Colaboradora SEM permissão (vínculo ativo, mas sem 'clients'/'view') não vê.
  PERFORM set_config('request.jwt.claim.sub', v_staff_no::text, true);
  SELECT count(*) INTO v_n FROM public.client_consents WHERE id = v_id_a;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('04c_colaboradora_sem_permissao_nao_ve', format('count=%s (esperado 0)', v_n), v_n = 0);

  -- Colaboradora COM permissão ('clients'/'view' concedida) vê.
  PERFORM set_config('request.jwt.claim.sub', v_staff_yes::text, true);
  SELECT count(*) INTO v_n FROM public.client_consents WHERE id = v_id_a;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('04d_colaboradora_com_permissao_ve', format('count=%s', v_n), v_n = 1);

  -- authenticated (mesmo a própria dona, staff_can=true) NUNCA consegue INSERT.
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  BEGIN
    INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
    VALUES (v_owner_a, v_client_a, 'marketing', 'denied', 'termo-consentimento', '2026-08-04', 'studio_device');
    v_rejeitou := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejeitou := true;
  END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('04e_authenticated_nunca_insere_mesmo_sendo_a_dona', 'rejeitado por insufficient_privilege (sem GRANT de INSERT)', v_rejeitou);

  -- anon não vê nada (sem SELECT grant nenhum).
  RESET ROLE;
  SET ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.client_consents;
    v_rejeitou := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejeitou := true;
  END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('04f_anon_nem_consegue_consultar', 'rejeitado por insufficient_privilege (sem GRANT de SELECT)', v_rejeitou);
  RESET ROLE;
END $passo4$;

-- ============================================================================
-- PASSO 5 — CHECKs de domínio (como service_role, isolando só a validação)
-- ============================================================================
DO $passo5$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='owner_a');
  v_client_a uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='client_a');
  v_rejeitou boolean;
  v_id uuid;
BEGIN
  SET ROLE service_role;

  BEGIN
    INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
    VALUES (v_owner_a, v_client_a, 'tipo_invalido', 'granted', 'termo-consentimento', '2026-08-04', 'portal');
    v_rejeitou := false;
  EXCEPTION WHEN check_violation THEN v_rejeitou := true; END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('05a_consent_type_invalido_rejeitado', 'check_violation', v_rejeitou);

  BEGIN
    INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
    VALUES (v_owner_a, v_client_a, 'health_data', 'talvez', 'termo-consentimento', '2026-08-04', 'portal');
    v_rejeitou := false;
  EXCEPTION WHEN check_violation THEN v_rejeitou := true; END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('05b_choice_invalido_rejeitado', 'check_violation', v_rejeitou);

  BEGIN
    INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
    VALUES (v_owner_a, v_client_a, 'health_data', 'granted', 'documento_que_nao_existe', '2026-08-04', 'portal');
    v_rejeitou := false;
  EXCEPTION WHEN check_violation THEN v_rejeitou := true; END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('05c_document_key_invalido_rejeitado', 'check_violation', v_rejeitou);

  BEGIN
    INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
    VALUES (v_owner_a, v_client_a, 'health_data', 'granted', 'termo-consentimento', '2026-08-04', 'de_qualquer_jeito');
    v_rejeitou := false;
  EXCEPTION WHEN check_violation THEN v_rejeitou := true; END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('05d_source_invalido_rejeitado', 'check_violation', v_rejeitou);

  -- granted_no_face FORA de image_use é rejeitado.
  BEGIN
    INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
    VALUES (v_owner_a, v_client_a, 'marketing', 'granted_no_face', 'termo-consentimento', '2026-08-04', 'portal');
    v_rejeitou := false;
  EXCEPTION WHEN check_violation THEN v_rejeitou := true; END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('05e_granted_no_face_fora_de_image_use_rejeitado', 'check_violation', v_rejeitou);

  -- granted_no_face DENTRO de image_use é aceito.
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
  VALUES (v_owner_a, v_client_a, 'image_use', 'granted_no_face', 'termo-consentimento', '2026-08-04', 'portal')
  RETURNING id INTO v_id;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('05f_granted_no_face_dentro_de_image_use_aceito', format('id=%s', v_id), v_id IS NOT NULL);

  -- denied em image_use também é aceito (3ª situação distinta exigida pela dona).
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
  VALUES (v_owner_a, v_client_a, 'image_use', 'denied', 'termo-consentimento', '2026-08-04', 'portal')
  RETURNING id INTO v_id;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('05g_denied_em_image_use_aceito', format('id=%s', v_id), v_id IS NOT NULL);

  -- evidence_user_agent > 300 caracteres é rejeitado.
  BEGIN
    INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source, evidence_user_agent)
    VALUES (v_owner_a, v_client_a, 'health_data', 'granted', 'termo-consentimento', '2026-08-04', 'portal', repeat('x', 301));
    v_rejeitou := false;
  EXCEPTION WHEN check_violation THEN v_rejeitou := true; END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('05h_user_agent_acima_de_300_rejeitado', 'check_violation', v_rejeitou);

  -- exatamente 300 caracteres é aceito (limite inclusivo).
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source, evidence_user_agent)
  VALUES (v_owner_a, v_client_a, 'health_data', 'granted', 'termo-consentimento', '2026-08-04', 'portal', repeat('x', 300))
  RETURNING id INTO v_id;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('05i_user_agent_exatamente_300_aceito', format('id=%s', v_id), v_id IS NOT NULL);

  RESET ROLE;
END $passo5$;

-- ============================================================================
-- PASSO 6 — imutabilidade: UPDATE/DELETE comuns bloqueados para QUALQUER
-- papel, inclusive service_role (sem a GUC de limpeza setada).
-- ============================================================================
DO $passo6$
DECLARE
  v_id uuid := (SELECT id FROM public.client_consents LIMIT 1);
  v_rejeitou boolean;
  v_code text;
BEGIN
  SET ROLE service_role;

  BEGIN
    UPDATE public.client_consents SET choice = 'denied' WHERE id = v_id;
    v_rejeitou := false;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    v_rejeitou := (v_code = 'UC001');
  END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('06a_update_comum_bloqueado_mesmo_para_service_role', format('sqlstate=%s', v_code), v_rejeitou);

  BEGIN
    DELETE FROM public.client_consents WHERE id = v_id;
    v_rejeitou := false;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    v_rejeitou := (v_code = 'UC001');
  END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('06b_delete_bloqueado_mesmo_para_service_role', format('sqlstate=%s', v_code), v_rejeitou);

  -- Nem postgres (superusuário, dono da tabela) escapa do gatilho — o
  -- gatilho não checa papel, só a GUC de sessão.
  RESET ROLE;
  BEGIN
    DELETE FROM public.client_consents WHERE id = v_id;
    v_rejeitou := false;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    v_rejeitou := (v_code = 'UC001');
  END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('06c_delete_bloqueado_mesmo_para_postgres_superuser', format('sqlstate=%s', v_code), v_rejeitou);

  -- Linha continua intacta depois das 3 tentativas.
  PERFORM 1 FROM public.client_consents WHERE id = v_id;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('06d_linha_continua_intacta', 'nenhuma das tentativas teve efeito', FOUND);
END $passo6$;

-- ============================================================================
-- PASSO 7 — caminho de limpeza (purge_client_consent_pii)
-- ============================================================================
DO $passo7$
DECLARE
  v_client_purge uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='client_purge');
  v_id uuid;
  v_affected int;
  v_signer text; v_ip text; v_ua text; v_choice text; v_type text; v_ver text;
  v_rejeitou boolean;
BEGIN
  -- grava uma linha com os 3 campos de PII preenchidos, pra provar que
  -- SÓ eles são zerados.
  SET ROLE service_role;
  INSERT INTO public.client_consents
    (owner_id, client_id, consent_type, choice, document_key, document_version, source, signer_name, evidence_ip, evidence_user_agent)
  VALUES
    ((SELECT valor FROM zzfx_cc_ids WHERE chave='owner_a'), v_client_purge, 'terms_privacy', 'granted', 'termos-de-uso', '2026-08-04', 'studio_device', 'Nome Teste', '203.0.113.9', 'Mozilla/5.0 (teste)')
  RETURNING id INTO v_id;

  -- anon/authenticated não conseguem executar a função.
  RESET ROLE;
  SET ROLE authenticated;
  BEGIN
    PERFORM public.purge_client_consent_pii(v_client_purge);
    v_rejeitou := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejeitou := true;
  END;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('07a_authenticated_nao_executa_purge', 'insufficient_privilege', v_rejeitou);
  RESET ROLE;

  -- service_role executa e zera só as 3 colunas de PII.
  SET ROLE service_role;
  SELECT public.purge_client_consent_pii(v_client_purge) INTO v_affected;
  RESET ROLE;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('07b_purge_afeta_a_linha_esperada', format('affected=%s', v_affected), v_affected = 1);

  SELECT signer_name, evidence_ip, evidence_user_agent, choice, consent_type, document_version
    INTO v_signer, v_ip, v_ua, v_choice, v_type, v_ver
    FROM public.client_consents WHERE id = v_id;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('07c_pii_zerada', format('signer=%s ip=%s ua=%s', v_signer, v_ip, v_ua), v_signer IS NULL AND v_ip IS NULL AND v_ua IS NULL);
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('07d_prova_minima_intacta', format('choice=%s type=%s version=%s', v_choice, v_type, v_ver),
     v_choice = 'granted' AND v_type = 'terms_privacy' AND v_ver = '2026-08-04');

  -- chamar de novo (idempotência): 0 linhas afetadas, nunca erro.
  SET ROLE service_role;
  SELECT public.purge_client_consent_pii(v_client_purge) INTO v_affected;
  RESET ROLE;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('07e_purge_idempotente_segunda_chamada', format('affected=%s (esperado 0, já estava zerado)', v_affected), v_affected = 0);

  -- Mesmo DENTRO do caminho de limpeza, tocar outra coluna continua bloqueado
  -- (a GUC estar 'on' não abre a porta pra tudo — só pras 3 colunas certas).
  SET ROLE service_role;
  PERFORM set_config('aura_consent.cleanup_active', 'on', true);
  BEGIN
    UPDATE public.client_consents SET choice = 'denied' WHERE id = v_id;
    v_rejeitou := false;
  EXCEPTION WHEN OTHERS THEN
    v_rejeitou := (SQLSTATE = 'UC002');
  END;
  PERFORM set_config('aura_consent.cleanup_active', 'off', true);
  RESET ROLE;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('07f_guc_de_limpeza_nao_libera_outras_colunas', 'sqlstate UC002 (AURA_CONSENT_CLEANUP_SCOPE)', v_rejeitou);
END $passo7$;

-- ============================================================================
-- PASSO 8 — ON DELETE CASCADE (client_id e owner_id)
-- ============================================================================
DO $passo8$
DECLARE
  v_owner_b uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='owner_b');
  v_client_b uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='client_b');
  v_n int;
BEGIN
  -- 8a) excluir o CLIENTE apaga os consents dele (igual a client_anamnesis/
  -- client_photos hoje — deleteClient em src/lib/clients.ts).
  SELECT count(*) INTO v_n FROM public.client_consents WHERE client_id = v_client_b;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('08a_antes_tem_pelo_menos_1_consent_do_cliente_b', format('count=%s', v_n), v_n >= 1);

  DELETE FROM public.clients WHERE id = v_client_b;

  SELECT count(*) INTO v_n FROM public.client_consents WHERE client_id = v_client_b;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('08b_excluir_cliente_apaga_os_consents_em_cascata', format('count=%s (esperado 0)', v_n), v_n = 0);

  -- 8c) excluir a CONTA DA DONA (auth.users) apaga em cascata clients +
  -- client_consents do salão (mesmo padrão que já existe hoje para
  -- client_anamnesis/client_photos) — simula account-deletion.functions.ts.
  SELECT count(*) INTO v_n FROM public.client_consents WHERE owner_id = v_owner_b;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('08c_antes_da_exclusao_de_conta_nao_sobrou_nada_do_cliente_b_mas_owner_b_ainda_existe',
     format('consents_restantes_do_owner_b=%s (0 é esperado, só o cliente b já foi excluído)', v_n), v_n = 0);

  DELETE FROM auth.users WHERE id = v_owner_b;

  SELECT count(*) INTO v_n FROM public.clients WHERE owner_id = v_owner_b;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('08d_excluir_a_conta_da_dona_apaga_os_clients_em_cascata', format('count=%s (esperado 0)', v_n), v_n = 0);
END $passo8$;

-- ============================================================================
-- PASSO 9 — aplica o rollback (DDL colado, igual ao arquivo real)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS backup_rollback_fase1;
REVOKE ALL ON SCHEMA backup_rollback_fase1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_fase1.client_consents_backup AS
  SELECT *, now() AS backed_up_at FROM public.client_consents WHERE false;
INSERT INTO backup_rollback_fase1.client_consents_backup
  SELECT *, now() FROM public.client_consents;

DO $passo9_contagem$
DECLARE v_antes int; v_depois int;
BEGIN
  SELECT count(*) INTO v_antes FROM public.client_consents;
  SELECT count(*) INTO v_depois FROM backup_rollback_fase1.client_consents_backup;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('09a_backup_preserva_todas_as_linhas_antes_do_drop', format('tabela=%s backup=%s', v_antes, v_depois), v_antes = v_depois AND v_antes > 0);
END $passo9_contagem$;

REVOKE ALL ON FUNCTION public.purge_client_consent_pii(uuid) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.purge_client_consent_pii(uuid);

DROP TRIGGER IF EXISTS trg_10_client_consents_block_mutation ON public.client_consents;
DROP FUNCTION IF EXISTS public.client_consents_block_mutation();

DROP POLICY IF EXISTS client_consents_owner_select ON public.client_consents;
DROP POLICY IF EXISTS client_consents_staff_select ON public.client_consents;

DROP TABLE IF EXISTS public.client_consents;
NOTIFY pgrst, 'reload schema';

DO $passo10$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.tables
    WHERE table_schema='public' AND table_name = 'client_consents';
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('10a_tabela_removida_pelo_rollback', format('%s ainda existe (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM pg_proc WHERE proname IN ('purge_client_consent_pii', 'client_consents_block_mutation');
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('10b_funcoes_removidas_pelo_rollback', format('%s ainda existem (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM backup_rollback_fase1.client_consents_backup;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('10c_backup_sobrevive_ao_drop', format('%s linha(s) no backup', v_n), v_n > 0);
END $passo10$;

-- ============================================================================
-- PASSO 11 — reaplica a migração (DDL colado de novo) e confirma que volta
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.client_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (
    consent_type IN ('terms_privacy', 'health_data', 'image_use', 'marketing', 'whatsapp_reminders')
  ),
  choice text NOT NULL CHECK (choice IN ('granted', 'denied', 'granted_no_face')),
  document_key text NOT NULL CHECK (
    document_key IN ('termo-consentimento', 'politica-de-privacidade', 'termos-de-uso')
  ),
  document_version text NOT NULL,
  source text NOT NULL CHECK (source IN ('portal', 'studio_device', 'professional_assisted')),
  collected_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  signer_name text NULL,
  evidence_ip text NULL,
  evidence_user_agent text NULL,
  CONSTRAINT client_consents_no_face_only_image_use
    CHECK (choice <> 'granted_no_face' OR consent_type = 'image_use'),
  CONSTRAINT client_consents_user_agent_len
    CHECK (evidence_user_agent IS NULL OR char_length(evidence_user_agent) <= 300)
);
CREATE INDEX IF NOT EXISTS client_consents_client_type_idx
  ON public.client_consents (client_id, consent_type, created_at DESC);
CREATE INDEX IF NOT EXISTS client_consents_owner_idx
  ON public.client_consents (owner_id);
ALTER TABLE public.client_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_consents TO authenticated;
GRANT ALL ON public.client_consents TO service_role;
DROP POLICY IF EXISTS client_consents_owner_select ON public.client_consents;
CREATE POLICY client_consents_owner_select ON public.client_consents FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS client_consents_staff_select ON public.client_consents;
CREATE POLICY client_consents_staff_select ON public.client_consents FOR SELECT TO authenticated
  USING (staff_can(owner_id, 'clients', 'view'));
CREATE OR REPLACE FUNCTION public.client_consents_block_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id)
       OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.owner_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'UC001', MESSAGE = 'AURA_CONSENT_IMMUTABLE: client_consents é somente-inserção; nenhum registro pode ser excluído diretamente.';
  END IF;
  IF current_setting('aura_consent.cleanup_active', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'UC001', MESSAGE = 'AURA_CONSENT_IMMUTABLE: client_consents é somente-inserção; use purge_client_consent_pii para anonimizar por exclusão de conta.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.consent_type IS DISTINCT FROM OLD.consent_type OR NEW.choice IS DISTINCT FROM OLD.choice
     OR NEW.document_key IS DISTINCT FROM OLD.document_key OR NEW.document_version IS DISTINCT FROM OLD.document_version
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.collected_by_user_id IS DISTINCT FROM OLD.collected_by_user_id
  THEN
    RAISE EXCEPTION USING ERRCODE = 'UC002', MESSAGE = 'AURA_CONSENT_CLEANUP_SCOPE: a limpeza por exclusão de conta só pode alterar signer_name, evidence_ip e evidence_user_agent.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.client_consents_block_mutation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_10_client_consents_block_mutation ON public.client_consents;
CREATE TRIGGER trg_10_client_consents_block_mutation
  BEFORE UPDATE OR DELETE ON public.client_consents
  FOR EACH ROW EXECUTE FUNCTION public.client_consents_block_mutation();
CREATE OR REPLACE FUNCTION public.purge_client_consent_pii(_client_id uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _affected integer;
BEGIN
  PERFORM set_config('aura_consent.cleanup_active', 'on', true);
  UPDATE public.client_consents SET signer_name = NULL, evidence_ip = NULL, evidence_user_agent = NULL
  WHERE client_id = _client_id AND (signer_name IS NOT NULL OR evidence_ip IS NOT NULL OR evidence_user_agent IS NOT NULL);
  GET DIAGNOSTICS _affected = ROW_COUNT;
  PERFORM set_config('aura_consent.cleanup_active', 'off', true);
  RETURN _affected;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_client_consent_pii(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_client_consent_pii(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';

DO $passo11$
DECLARE
  v_ok boolean; v_id uuid;
  v_owner_a uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='owner_a');
  v_client_a uuid := (SELECT valor FROM zzfx_cc_ids WHERE chave='client_a');
BEGIN
  SELECT count(*) = 1 INTO v_ok FROM information_schema.tables
    WHERE table_schema='public' AND table_name = 'client_consents';
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES ('11a_tabela_volta_depois_de_reaplicar', 'client_consents existe de novo', v_ok);

  SET ROLE service_role;
  INSERT INTO public.client_consents (owner_id, client_id, consent_type, choice, document_key, document_version, source)
  VALUES (v_owner_a, v_client_a, 'whatsapp_reminders', 'granted', 'termo-consentimento', '2026-08-04', 'professional_assisted')
  RETURNING id INTO v_id;
  RESET ROLE;
  INSERT INTO zzfx_cc_results (caso, detalhe, passou) VALUES
    ('11b_insert_funciona_normalmente_apos_reaplicar', format('id=%s', v_id), v_id IS NOT NULL);
END $passo11$;

-- Saída consolidada numa ÚNICA consulta (JSON) — ordem/caso/detalhe/passou
-- caso a caso, mais o resumo agregado.
SELECT jsonb_build_object(
  'casos', (
    SELECT jsonb_agg(
      jsonb_build_object('ordem', ordem, 'caso', caso, 'detalhe', detalhe, 'passou', passou)
      ORDER BY ordem
    )
    FROM zzfx_cc_results
  ),
  'resumo', (
    SELECT jsonb_build_object(
      'passaram', count(*) FILTER (WHERE passou),
      'falharam', count(*) FILTER (WHERE NOT passou)
    )
    FROM zzfx_cc_results
  )
) AS resultado;

ROLLBACK;
