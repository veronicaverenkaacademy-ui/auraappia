-- FASE K2c — suíte da migração 20261111191342_portal_k2c_logo_wide.sql.
--
-- NÃO EXECUTADA contra produção (banco tratado como SOMENTE LEITURA nesta
-- fase — nenhuma escrita, nem dentro de uma transação que termina em
-- ROLLBACK). Preparada com o maior cuidado possível pra rodar quando houver
-- onde rodar com segurança, ou no momento da aplicação real autorizada.
--
-- Diferença desta versão em relação à suíte anterior (revisão pedida pela
-- dona): em vez de só testar o ESTADO final da migração já aplicada, esta
-- suíte simula o CICLO completo dentro de uma única transação que nunca é
-- commitada:
--   1) captura o estado ORIGINAL (assinatura/corpo/GRANTs/CHECKs das 6
--      funções, lido via pg_get_functiondef/pg_get_constraintdef — nunca de
--      memória) antes de qualquer mudança;
--   2) aplica a migração (DDL colado, igual ao arquivo real);
--   3) roda os 14 casos funcionais (logo-wide válido, salvar/publicar/
--      desfazer, isolamento entre empresas, anon só via portal_obter_publico,
--      campo opcional, CHECK cobre o campo novo);
--   4) aplica o rollback (DDL colado, igual ao arquivo real);
--   5) verifica que assinatura/corpo/GRANTs/CHECKs voltaram EXATAMENTE ao
--      que foi capturado no passo 1, que as 2 colunas novas sumiram, que
--      "logo-wide" volta a ser inválido, e que o dado da coluna ANTIGA
--      (logo_path, gravado ANTES de qualquer DDL desta migração) sobreviveu
--      ao ciclo inteiro sem alteração;
--   6) reaplica a migração (DDL colado de novo) e confirma que "logo-wide"
--      funciona de novo e que o dado antigo continua intacto.
--
-- Mesmo padrão de supabase/tests/team_members_avatar_url_check_k1a2.sql:
-- uma transação, NUNCA COMMIT, dados sintéticos zz-fixture-/zzfx-. auth.uid()
-- é simulado via set_config('request.jwt.claim.sub', ..., true) — é como
-- auth.uid() lê o usuário autenticado de verdade (confirmado lendo a
-- definição de auth.uid() no banco). O literal 'admin' sem cast explícito
-- pra user_roles.role (enum app_role) é o mesmo padrão já usado com sucesso
-- em outras migrações deste repositório (INSERT INTO user_roles ... VALUES
-- (NEW.id, 'admin') em funções de trigger) — Postgres infere o tipo do
-- literal a partir da coluna de destino em INSERT ... VALUES, sem precisar
-- de ::app_role explícito.
--
-- IMPORTANTE sobre PL/pgSQL: DDL (CREATE OR REPLACE FUNCTION, ALTER TABLE,
-- DROP) NÃO pode ficar dentro de um bloco DO $$ ... END $$ como comando
-- direto — só comandos de dados (SELECT/INSERT/UPDATE/DELETE) e controle de
-- fluxo são nativos do PL/pgSQL ali; DDL exigiria EXECUTE de SQL dinâmico.
-- Por isso todo o DDL abaixo (migração e rollback, colados na íntegra) fica
-- como instruções de nível superior do script, FORA de qualquer DO $$ — e a
-- lógica de teste (que precisa de variáveis/IF/LOOP) fica em blocos DO $$
-- separados, trocando dados entre si via as tabelas temporárias
-- zzfx_k2c_ids/zzfx_k2c_originais_* (variável de um bloco DO não é visível
-- em outro).

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TEMP TABLE zzfx_k2c_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_k2c_ids (chave text PRIMARY KEY, valor text) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_k2c_originais_funcoes (nome text PRIMARY KEY, def text, args text, result_type text) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_k2c_originais_grants (nome text PRIMARY KEY, anon_execute boolean, authenticated_execute boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_k2c_originais_checks (nome text PRIMARY KEY, def text) ON COMMIT DROP;

-- ============================================================================
-- PASSO 1 — captura do estado ORIGINAL, antes de qualquer alteração desta
-- suíte (lido agora, não reaproveitado de memória/sessão anterior).
-- ============================================================================
INSERT INTO zzfx_k2c_originais_funcoes
SELECT p.proname, pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('portal_media_path_valid','portal_salvar_rascunho','portal_publicar','portal_desfazer_publicacao','portal_descartar_rascunho','portal_obter_publico');

INSERT INTO zzfx_k2c_originais_grants
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('portal_media_path_valid','portal_salvar_rascunho','portal_publicar','portal_desfazer_publicacao','portal_descartar_rascunho','portal_obter_publico');

INSERT INTO zzfx_k2c_originais_checks
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('portal_configurations_draft_paths_check','portal_configurations_published_paths_check');

DO $check_captura$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM zzfx_k2c_originais_funcoes;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('00_captura_estado_original_6_funcoes', format('%s funções capturadas (esperado 6)', v_n), v_n = 6);
  SELECT count(*) INTO v_n FROM zzfx_k2c_originais_checks;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('00_captura_estado_original_2_checks', format('%s CHECKs capturados (esperado 2)', v_n), v_n = 2);
END $check_captura$;

-- ============================================================================
-- PASSO 2 — fixtures de teste, incluindo dado de coluna ANTIGA
-- (draft_logo_path/published_logo_path) gravado ANTES de qualquer DDL desta
-- migração — é o que o ciclo inteiro (aplicar→desfazer→reaplicar) tem que
-- preservar sem alteração.
-- ============================================================================
DO $fixtures$
DECLARE
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_media_a uuid := gen_random_uuid();
  v_media_b uuid := gen_random_uuid();
  v_path_logo_a text;
  v_version int;
  v_result text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_a||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_b||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb);

  INSERT INTO public.user_roles (user_id, role) VALUES (v_owner_a, 'admin'), (v_owner_b, 'admin');

  INSERT INTO public.company_profiles (owner_id, slug, display_name, portal_media_key)
  VALUES
    (v_owner_a, 'zzfx-k2c-empresa-a', 'ZZFX Empresa A', v_media_a),
    (v_owner_b, 'zzfx-k2c-empresa-b', 'ZZFX Empresa B', v_media_b);

  -- Não precisa (e não pode, sem ON CONFLICT) inserir aqui: o trigger
  -- portal_configurations_auto_create (AFTER INSERT em company_profiles,
  -- função portal_configurations_init) já cria esta linha automaticamente,
  -- com ON CONFLICT (owner_id) DO NOTHING — um INSERT explícito sem
  -- ON CONFLICT logo depois do INSERT em company_profiles colide sempre
  -- (defeito deste script de teste, não da migração: a suíte foi escrita
  -- antes desse trigger existir no esquema). Confirmado por leitura:
  -- information_schema.triggers mostra portal_configurations_auto_create
  -- em company_profiles chamando portal_configurations_init(), que faz
  -- exatamente esse INSERT ... ON CONFLICT (owner_id) DO NOTHING.

  v_path_logo_a := v_media_a || '/logo/' || gen_random_uuid() || '.png';
  INSERT INTO storage.objects (bucket_id, name) VALUES ('portal-media', v_path_logo_a);

  -- Dado de coluna ANTIGA, gravado com a função de PRODUÇÃO atual (ainda sem
  -- logo_wide_path, porque a migração ainda não foi aplicada nesta suíte) —
  -- representa um registro real que já existia antes da FASE K2c.
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  SELECT version INTO v_version FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_salvar_rascunho(jsonb_build_object('logo_path', v_path_logo_a), v_version) INTO v_result;
  RESET request.jwt.claim.sub;

  INSERT INTO zzfx_k2c_ids (chave, valor) VALUES
    ('owner_a', v_owner_a::text), ('owner_b', v_owner_b::text),
    ('media_a', v_media_a::text), ('media_b', v_media_b::text),
    ('path_logo_a', v_path_logo_a);

  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('01_fixtures_e_dado_antigo_logo_path_gravado',
     format('salvar_rascunho(logo_path)=%s caminho=%s', v_result, v_path_logo_a),
     v_result = 'ok');
END $fixtures$;

-- ============================================================================
-- PASSO 3 — APLICAR a migração (DDL colado na íntegra, igual ao arquivo
-- supabase/migrations/20261111191342_portal_k2c_logo_wide.sql).
-- ============================================================================

-- 3.1 — portal_media_path_valid(): acrescenta "logo-wide".
CREATE OR REPLACE FUNCTION public.portal_media_path_valid(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo|logo-light|logo-wide|cover|banner|services|professionals|categories)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$';
$$;

-- 3.2 — colunas novas + CHECKs recriadas incluindo o campo novo.
ALTER TABLE public.portal_configurations
  ADD COLUMN IF NOT EXISTS draft_logo_wide_path text,
  ADD COLUMN IF NOT EXISTS published_logo_wide_path text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_configurations_draft_paths_check') THEN
    ALTER TABLE public.portal_configurations DROP CONSTRAINT portal_configurations_draft_paths_check;
  END IF;
  ALTER TABLE public.portal_configurations ADD CONSTRAINT portal_configurations_draft_paths_check CHECK (
    (draft_logo_path IS NULL OR public.portal_media_path_valid(draft_logo_path)) AND
    (draft_logo_light_path IS NULL OR public.portal_media_path_valid(draft_logo_light_path)) AND
    (draft_logo_wide_path IS NULL OR public.portal_media_path_valid(draft_logo_wide_path)) AND
    (draft_cover_path IS NULL OR public.portal_media_path_valid(draft_cover_path)) AND
    (draft_banner_path IS NULL OR public.portal_media_path_valid(draft_banner_path))
  );

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_configurations_published_paths_check') THEN
    ALTER TABLE public.portal_configurations DROP CONSTRAINT portal_configurations_published_paths_check;
  END IF;
  ALTER TABLE public.portal_configurations ADD CONSTRAINT portal_configurations_published_paths_check CHECK (
    (published_logo_path IS NULL OR public.portal_media_path_valid(published_logo_path)) AND
    (published_logo_light_path IS NULL OR public.portal_media_path_valid(published_logo_light_path)) AND
    (published_logo_wide_path IS NULL OR public.portal_media_path_valid(published_logo_wide_path)) AND
    (published_cover_path IS NULL OR public.portal_media_path_valid(published_cover_path)) AND
    (published_banner_path IS NULL OR public.portal_media_path_valid(published_banner_path))
  );
END $$;

-- 3.3 — portal_salvar_rascunho: inclui logo_wide_path.
CREATE OR REPLACE FUNCTION public.portal_salvar_rascunho(p_config jsonb, p_version_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.portal_configurations;
  v_media_key text;
  v_err text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.version <> p_version_esperada THEN
    RETURN 'conflito_versao';
  END IF;

  SELECT portal_media_key::text INTO v_media_key FROM public.company_profiles WHERE owner_id = auth.uid();

  FOR v_err IN
    SELECT public.portal_validate_owned_path(p_config ->> col, v_media_key)
    FROM unnest(ARRAY['logo_path', 'logo_light_path', 'logo_wide_path', 'cover_path', 'banner_path']) AS col
  LOOP
    IF v_err IS NOT NULL THEN
      RETURN v_err;
    END IF;
  END LOOP;

  BEGIN
    UPDATE public.portal_configurations SET
      draft_theme_key = CASE WHEN p_config ? 'theme_key' THEN NULLIF(p_config ->> 'theme_key', '') ELSE draft_theme_key END,
      draft_color_primary = CASE WHEN p_config ? 'color_primary' THEN NULLIF(p_config ->> 'color_primary', '') ELSE draft_color_primary END,
      draft_color_secondary = CASE WHEN p_config ? 'color_secondary' THEN NULLIF(p_config ->> 'color_secondary', '') ELSE draft_color_secondary END,
      draft_color_button = CASE WHEN p_config ? 'color_button' THEN NULLIF(p_config ->> 'color_button', '') ELSE draft_color_button END,
      draft_color_button_text = CASE WHEN p_config ? 'color_button_text' THEN NULLIF(p_config ->> 'color_button_text', '') ELSE draft_color_button_text END,
      draft_color_text = CASE WHEN p_config ? 'color_text' THEN NULLIF(p_config ->> 'color_text', '') ELSE draft_color_text END,
      draft_color_background = CASE WHEN p_config ? 'color_background' THEN NULLIF(p_config ->> 'color_background', '') ELSE draft_color_background END,
      draft_font_key = CASE WHEN p_config ? 'font_key' THEN COALESCE(NULLIF(p_config ->> 'font_key', ''), 'system') ELSE draft_font_key END,
      draft_cover_title = CASE WHEN p_config ? 'cover_title' THEN NULLIF(p_config ->> 'cover_title', '') ELSE draft_cover_title END,
      draft_cover_subtitle = CASE WHEN p_config ? 'cover_subtitle' THEN NULLIF(p_config ->> 'cover_subtitle', '') ELSE draft_cover_subtitle END,
      draft_banner_text = CASE WHEN p_config ? 'banner_text' THEN NULLIF(p_config ->> 'banner_text', '') ELSE draft_banner_text END,
      draft_important_title = CASE WHEN p_config ? 'important_title' THEN NULLIF(p_config ->> 'important_title', '') ELSE draft_important_title END,
      draft_important_text = CASE WHEN p_config ? 'important_text' THEN NULLIF(p_config ->> 'important_text', '') ELSE draft_important_text END,
      draft_welcome_message = CASE WHEN p_config ? 'welcome_message' THEN NULLIF(p_config ->> 'welcome_message', '') ELSE draft_welcome_message END,
      draft_show_shortcuts = COALESCE((p_config ->> 'show_shortcuts')::boolean, draft_show_shortcuts),
      draft_show_banner = COALESCE((p_config ->> 'show_banner')::boolean, draft_show_banner),
      draft_show_services = COALESCE((p_config ->> 'show_services')::boolean, draft_show_services),
      draft_show_important = COALESCE((p_config ->> 'show_important')::boolean, draft_show_important),
      draft_show_professionals = COALESCE((p_config ->> 'show_professionals')::boolean, draft_show_professionals),
      draft_show_location = COALESCE((p_config ->> 'show_location')::boolean, draft_show_location),
      draft_show_footer = COALESCE((p_config ->> 'show_footer')::boolean, draft_show_footer),
      draft_logo_path = CASE WHEN p_config ? 'logo_path' THEN NULLIF(p_config ->> 'logo_path', '') ELSE draft_logo_path END,
      draft_logo_light_path = CASE WHEN p_config ? 'logo_light_path' THEN NULLIF(p_config ->> 'logo_light_path', '') ELSE draft_logo_light_path END,
      draft_logo_wide_path = CASE WHEN p_config ? 'logo_wide_path' THEN NULLIF(p_config ->> 'logo_wide_path', '') ELSE draft_logo_wide_path END,
      draft_cover_path = CASE WHEN p_config ? 'cover_path' THEN NULLIF(p_config ->> 'cover_path', '') ELSE draft_cover_path END,
      draft_banner_path = CASE WHEN p_config ? 'banner_path' THEN NULLIF(p_config ->> 'banner_path', '') ELSE draft_banner_path END,
      version = version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE owner_id = auth.uid() AND version = p_version_esperada;
  EXCEPTION WHEN check_violation THEN
    RETURN 'config_invalida';
  END;

  RETURN 'ok';
END;
$$;

-- 3.4 — portal_publicar: espelha logo_wide_path e inclui na "foto" anterior.
CREATE OR REPLACE FUNCTION public.portal_publicar(p_version_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.portal_configurations;
  v_prev jsonb;
  v_text_color text;
  v_bg_color text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.version <> p_version_esperada THEN
    RETURN 'conflito_versao';
  END IF;

  v_text_color := COALESCE(v_row.draft_color_text, '#211c1a');
  v_bg_color := COALESCE(v_row.draft_color_background, '#f8f5f0');
  IF public.portal_contrast_ratio(v_text_color, v_bg_color) < 3.0 THEN
    RETURN 'contraste_insuficiente';
  END IF;

  v_prev := CASE WHEN v_row.published_at IS NULL THEN NULL ELSE jsonb_build_object(
    'theme_key', v_row.published_theme_key,
    'color_primary', v_row.published_color_primary,
    'color_secondary', v_row.published_color_secondary,
    'color_button', v_row.published_color_button,
    'color_button_text', v_row.published_color_button_text,
    'color_text', v_row.published_color_text,
    'color_background', v_row.published_color_background,
    'font_key', v_row.published_font_key,
    'cover_title', v_row.published_cover_title,
    'cover_subtitle', v_row.published_cover_subtitle,
    'banner_text', v_row.published_banner_text,
    'important_title', v_row.published_important_title,
    'important_text', v_row.published_important_text,
    'welcome_message', v_row.published_welcome_message,
    'show_shortcuts', v_row.published_show_shortcuts,
    'show_banner', v_row.published_show_banner,
    'show_services', v_row.published_show_services,
    'show_important', v_row.published_show_important,
    'show_professionals', v_row.published_show_professionals,
    'show_location', v_row.published_show_location,
    'show_footer', v_row.published_show_footer,
    'logo_path', v_row.published_logo_path,
    'logo_light_path', v_row.published_logo_light_path,
    'logo_wide_path', v_row.published_logo_wide_path,
    'cover_path', v_row.published_cover_path,
    'banner_path', v_row.published_banner_path
  ) END;

  UPDATE public.portal_configurations SET
    published_theme_key = draft_theme_key,
    published_color_primary = draft_color_primary,
    published_color_secondary = draft_color_secondary,
    published_color_button = draft_color_button,
    published_color_button_text = draft_color_button_text,
    published_color_text = draft_color_text,
    published_color_background = draft_color_background,
    published_font_key = draft_font_key,
    published_cover_title = draft_cover_title,
    published_cover_subtitle = draft_cover_subtitle,
    published_banner_text = draft_banner_text,
    published_important_title = draft_important_title,
    published_important_text = draft_important_text,
    published_welcome_message = draft_welcome_message,
    published_show_shortcuts = draft_show_shortcuts,
    published_show_banner = draft_show_banner,
    published_show_services = draft_show_services,
    published_show_important = draft_show_important,
    published_show_professionals = draft_show_professionals,
    published_show_location = draft_show_location,
    published_show_footer = draft_show_footer,
    published_logo_path = draft_logo_path,
    published_logo_light_path = draft_logo_light_path,
    published_logo_wide_path = draft_logo_wide_path,
    published_cover_path = draft_cover_path,
    published_banner_path = draft_banner_path,
    previous_published = v_prev,
    published_at = now(),
    published_by = auth.uid(),
    version = version + 1
  WHERE owner_id = auth.uid() AND version = p_version_esperada;

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (auth.uid(), auth.uid(), NULL, 'portal_published', 'portal_configurations', auth.uid()::text, NULL);

  RETURN 'ok';
END;
$$;

-- 3.5 — portal_desfazer_publicacao: inclui logo_wide_path na troca.
CREATE OR REPLACE FUNCTION public.portal_desfazer_publicacao()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.portal_configurations;
  v_current jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.previous_published IS NULL THEN
    RETURN 'nada_para_desfazer';
  END IF;

  v_current := jsonb_build_object(
    'theme_key', v_row.published_theme_key,
    'color_primary', v_row.published_color_primary,
    'color_secondary', v_row.published_color_secondary,
    'color_button', v_row.published_color_button,
    'color_button_text', v_row.published_color_button_text,
    'color_text', v_row.published_color_text,
    'color_background', v_row.published_color_background,
    'font_key', v_row.published_font_key,
    'cover_title', v_row.published_cover_title,
    'cover_subtitle', v_row.published_cover_subtitle,
    'banner_text', v_row.published_banner_text,
    'important_title', v_row.published_important_title,
    'important_text', v_row.published_important_text,
    'welcome_message', v_row.published_welcome_message,
    'show_shortcuts', v_row.published_show_shortcuts,
    'show_banner', v_row.published_show_banner,
    'show_services', v_row.published_show_services,
    'show_important', v_row.published_show_important,
    'show_professionals', v_row.published_show_professionals,
    'show_location', v_row.published_show_location,
    'show_footer', v_row.published_show_footer,
    'logo_path', v_row.published_logo_path,
    'logo_light_path', v_row.published_logo_light_path,
    'logo_wide_path', v_row.published_logo_wide_path,
    'cover_path', v_row.published_cover_path,
    'banner_path', v_row.published_banner_path
  );

  UPDATE public.portal_configurations SET
    published_theme_key = previous_published ->> 'theme_key',
    published_color_primary = previous_published ->> 'color_primary',
    published_color_secondary = previous_published ->> 'color_secondary',
    published_color_button = previous_published ->> 'color_button',
    published_color_button_text = previous_published ->> 'color_button_text',
    published_color_text = previous_published ->> 'color_text',
    published_color_background = previous_published ->> 'color_background',
    published_font_key = previous_published ->> 'font_key',
    published_cover_title = previous_published ->> 'cover_title',
    published_cover_subtitle = previous_published ->> 'cover_subtitle',
    published_banner_text = previous_published ->> 'banner_text',
    published_important_title = previous_published ->> 'important_title',
    published_important_text = previous_published ->> 'important_text',
    published_welcome_message = previous_published ->> 'welcome_message',
    published_show_shortcuts = (previous_published ->> 'show_shortcuts')::boolean,
    published_show_banner = (previous_published ->> 'show_banner')::boolean,
    published_show_services = (previous_published ->> 'show_services')::boolean,
    published_show_important = (previous_published ->> 'show_important')::boolean,
    published_show_professionals = (previous_published ->> 'show_professionals')::boolean,
    published_show_location = (previous_published ->> 'show_location')::boolean,
    published_show_footer = (previous_published ->> 'show_footer')::boolean,
    published_logo_path = previous_published ->> 'logo_path',
    published_logo_light_path = previous_published ->> 'logo_light_path',
    published_logo_wide_path = previous_published ->> 'logo_wide_path',
    published_cover_path = previous_published ->> 'cover_path',
    published_banner_path = previous_published ->> 'banner_path',
    previous_published = v_current,
    published_at = now(),
    published_by = auth.uid(),
    version = version + 1
  WHERE owner_id = auth.uid();

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (auth.uid(), auth.uid(), NULL, 'portal_publish_undone', 'portal_configurations', auth.uid()::text, NULL);

  RETURN 'ok';
END;
$$;

-- 3.6 — portal_descartar_rascunho: inclui logo_wide_path.
CREATE OR REPLACE FUNCTION public.portal_descartar_rascunho()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  UPDATE public.portal_configurations SET
    draft_theme_key = COALESCE(published_theme_key, 'system'),
    draft_color_primary = published_color_primary,
    draft_color_secondary = published_color_secondary,
    draft_color_button = published_color_button,
    draft_color_button_text = published_color_button_text,
    draft_color_text = published_color_text,
    draft_color_background = published_color_background,
    draft_font_key = COALESCE(published_font_key, 'system'),
    draft_cover_title = published_cover_title,
    draft_cover_subtitle = published_cover_subtitle,
    draft_banner_text = published_banner_text,
    draft_important_title = published_important_title,
    draft_important_text = published_important_text,
    draft_welcome_message = published_welcome_message,
    draft_show_shortcuts = COALESCE(published_show_shortcuts, true),
    draft_show_banner = COALESCE(published_show_banner, true),
    draft_show_services = COALESCE(published_show_services, true),
    draft_show_important = COALESCE(published_show_important, true),
    draft_show_professionals = COALESCE(published_show_professionals, true),
    draft_show_location = COALESCE(published_show_location, true),
    draft_show_footer = COALESCE(published_show_footer, true),
    draft_logo_path = published_logo_path,
    draft_logo_light_path = published_logo_light_path,
    draft_logo_wide_path = published_logo_wide_path,
    draft_cover_path = published_cover_path,
    draft_banner_path = published_banner_path,
    version = version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE owner_id = auth.uid();

  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  RETURN 'ok';
END;
$$;

-- 3.7 — portal_obter_publico: inclui logo_wide_path.
CREATE OR REPLACE FUNCTION public.portal_obter_publico(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'published_at', pc.published_at,
    'theme_key', pc.published_theme_key,
    'color_primary', pc.published_color_primary,
    'color_secondary', pc.published_color_secondary,
    'color_button', pc.published_color_button,
    'color_button_text', pc.published_color_button_text,
    'color_text', pc.published_color_text,
    'color_background', pc.published_color_background,
    'font_key', pc.published_font_key,
    'cover_title', pc.published_cover_title,
    'cover_subtitle', pc.published_cover_subtitle,
    'banner_text', pc.published_banner_text,
    'important_title', pc.published_important_title,
    'important_text', pc.published_important_text,
    'welcome_message', pc.published_welcome_message,
    'show_shortcuts', pc.published_show_shortcuts,
    'show_banner', pc.published_show_banner,
    'show_services', pc.published_show_services,
    'show_important', pc.published_show_important,
    'show_professionals', pc.published_show_professionals,
    'show_location', pc.published_show_location,
    'show_footer', pc.published_show_footer,
    'logo_path', pc.published_logo_path,
    'logo_light_path', pc.published_logo_light_path,
    'logo_wide_path', pc.published_logo_wide_path,
    'cover_path', pc.published_cover_path,
    'banner_path', pc.published_banner_path
  )
  FROM public.company_profiles cp
  JOIN public.portal_configurations pc ON pc.owner_id = cp.owner_id
  WHERE cp.slug = p_slug AND pc.published_at IS NOT NULL;
$$;

-- ============================================================================
-- PASSO 4 — VERIFICAR pós-aplicação: os 14 casos funcionais.
-- ============================================================================
DO $run_pos_aplicacao$
DECLARE
  v_owner_a uuid;
  v_owner_b uuid;
  v_media_a uuid;
  v_media_b uuid;
  v_path_logo_a text;
  v_path_logo_wide_a text;
  v_result text;
  v_row public.portal_configurations;
  v_val text;
  v_caso14_passou boolean;
  v_caso14_detalhe text;
BEGIN
  SELECT valor::uuid INTO v_owner_a FROM zzfx_k2c_ids WHERE chave = 'owner_a';
  SELECT valor::uuid INTO v_owner_b FROM zzfx_k2c_ids WHERE chave = 'owner_b';
  SELECT valor::uuid INTO v_media_a FROM zzfx_k2c_ids WHERE chave = 'media_a';
  SELECT valor::uuid INTO v_media_b FROM zzfx_k2c_ids WHERE chave = 'media_b';
  SELECT valor INTO v_path_logo_a FROM zzfx_k2c_ids WHERE chave = 'path_logo_a';

  v_path_logo_wide_a := v_media_a || '/logo-wide/' || gen_random_uuid() || '.png';
  INSERT INTO storage.objects (bucket_id, name) VALUES ('portal-media', v_path_logo_wide_a);
  INSERT INTO zzfx_k2c_ids (chave, valor) VALUES ('path_logo_wide_a', v_path_logo_wide_a);

  -- ===== 1: tipos de imagem ANTIGOS continuam válidos (nada regrediu) =====
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('02_tipos_antigos_continuam_validos', 'logo/logo-light/cover/banner/services/professionals/categories',
     public.portal_media_path_valid(v_media_a || '/logo/11111111-1111-1111-1111-111111111111.png')
     AND public.portal_media_path_valid(v_media_a || '/logo-light/11111111-1111-1111-1111-111111111111.png')
     AND public.portal_media_path_valid(v_media_a || '/cover/11111111-1111-1111-1111-111111111111.jpg')
     AND public.portal_media_path_valid(v_media_a || '/banner/11111111-1111-1111-1111-111111111111.webp')
     AND public.portal_media_path_valid(v_media_a || '/services/11111111-1111-1111-1111-111111111111.jpeg')
     AND public.portal_media_path_valid(v_media_a || '/professionals/11111111-1111-1111-1111-111111111111.png')
     AND public.portal_media_path_valid(v_media_a || '/categories/11111111-1111-1111-1111-111111111111.png'));

  -- ===== 2: "logo-wide" é um tipo válido novo =====
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('03_logo_wide_valido', v_path_logo_wide_a, public.portal_media_path_valid(v_path_logo_wide_a));

  -- ===== 3: caminhos inválidos continuam recusados =====
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('04_caminho_invalido_recusado',
     'tipo inventado / extensão errada / uuid malformado',
     NOT public.portal_media_path_valid(v_media_a || '/logo-wide-fake/11111111-1111-1111-1111-111111111111.png')
     AND NOT public.portal_media_path_valid(v_media_a || '/logo-wide/11111111-1111-1111-1111-111111111111.gif')
     AND NOT public.portal_media_path_valid('nao-e-uuid/logo-wide/11111111-1111-1111-1111-111111111111.png'));

  -- ===== simula a dona A autenticada =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);

  -- ===== 4: salvar rascunho com logo_wide_path válido =====
  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_salvar_rascunho(
    jsonb_build_object('logo_wide_path', v_path_logo_wide_a), v_row.version
  ) INTO v_result;
  SELECT draft_logo_wide_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('05_salvar_rascunho_logo_wide_valido', format('resultado=%s draft_logo_wide_path=%s', v_result, v_val),
     v_result = 'ok' AND v_val = v_path_logo_wide_a);

  -- ===== 5: logo_wide_path de OUTRA empresa é recusado =====
  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_salvar_rascunho(
    jsonb_build_object('logo_wide_path', v_media_b || '/logo-wide/' || gen_random_uuid() || '.png'), v_row.version
  ) INTO v_result;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('06_logo_wide_de_outra_empresa_recusado', format('resultado=%s', v_result), v_result = 'caminho_invalido');

  -- ===== 6: logo_wide_path de arquivo inexistente no storage é recusado =====
  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_salvar_rascunho(
    jsonb_build_object('logo_wide_path', v_media_a || '/logo-wide/' || gen_random_uuid() || '.png'), v_row.version
  ) INTO v_result;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('07_logo_wide_arquivo_inexistente_recusado', format('resultado=%s', v_result), v_result = 'arquivo_inexistente');

  -- ===== 7: publicar com logo_wide_path preenchido =====
  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_publicar(v_row.version) INTO v_result;
  SELECT published_logo_wide_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('08_publicar_com_logo_wide', format('resultado=%s published_logo_wide_path=%s', v_result, v_val),
     v_result = 'ok' AND v_val = v_path_logo_wide_a);

  -- ===== 8: publicar de novo com valor DIFERENTE grava a "foto" anterior em
  -- previous_published, incluindo logo_wide_path (reaproveita v_path_logo_a,
  -- já existente no storage, só pra variar o valor — não representa um
  -- logo-wide de verdade) =====
  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_salvar_rascunho(
    jsonb_build_object('logo_wide_path', v_path_logo_a), v_row.version
  ) INTO v_result;
  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_publicar(v_row.version) INTO v_result;
  SELECT previous_published ->> 'logo_wide_path' INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('09_previous_published_guarda_logo_wide_anterior', format('previous.logo_wide_path=%s', v_val),
     v_val = v_path_logo_wide_a);

  -- ===== 9: desfazer publicação restaura o logo_wide_path anterior =====
  SELECT public.portal_desfazer_publicacao() INTO v_result;
  SELECT published_logo_wide_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('10_desfazer_restaura_logo_wide_anterior', format('resultado=%s published_logo_wide_path=%s', v_result, v_val),
     v_result = 'ok' AND v_val = v_path_logo_wide_a);

  -- ===== 10: campo opcional — salvar/publicar SEM tocar em logo_wide_path
  -- continua funcionando (empresa B, nunca usou o campo) =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_b::text, true);
  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_b;
  SELECT public.portal_salvar_rascunho(jsonb_build_object('welcome_message', 'Oi, sem logo largo'), v_row.version) INTO v_result;
  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_b;
  SELECT public.portal_publicar(v_row.version) INTO v_result;
  SELECT published_logo_wide_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_b;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('11_campo_opcional_salvar_publicar_sem_logo_wide_funciona',
     format('resultado=%s published_logo_wide_path=%s', v_result, v_val),
     v_result = 'ok' AND v_val IS NULL);

  -- ===== 11: empresa B não alterou dados da empresa A =====
  SELECT published_logo_wide_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('12_empresa_b_nao_alterou_dados_da_a', format('A.published_logo_wide_path=%s (esperado=%s)', v_val, v_path_logo_wide_a),
     v_val = v_path_logo_wide_a);

  -- ===== 12: anon só lê pelo portal_obter_publico(), já incluindo logo_wide_path =====
  -- (grava o resultado SÓ depois do RESET ROLE: a tabela temp zzfx_k2c_results
  -- pertence ao role original da sessão, e anon não tem INSERT nela —
  -- gravar enquanto ainda impersonando anon dá "permission denied for table
  -- zzfx_k2c_results")
  RESET request.jwt.claim.sub;
  SET LOCAL ROLE anon;
  SELECT (public.portal_obter_publico('zzfx-k2c-empresa-a') ->> 'logo_wide_path') INTO v_val;

  -- ===== 13: anon NÃO lê portal_configurations direto (RLS intacta) =====
  BEGIN
    PERFORM 1 FROM public.portal_configurations WHERE owner_id = v_owner_a;
    v_caso14_passou := false;
    v_caso14_detalhe := 'SELECT retornou linha (RLS não bloqueou!)';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caso14_passou := true;
    v_caso14_detalhe := 'erro:insufficient_privilege (esperado)';
  END;
  RESET ROLE;

  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('13_anon_le_logo_wide_via_portal_obter_publico', format('logo_wide_path=%s', v_val), v_val = v_path_logo_wide_a);
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('14_anon_sem_select_direto_em_portal_configurations', v_caso14_detalhe, v_caso14_passou);

  -- ===== 14 (controle): CHECK de formato cobre logo_wide_path =====
  BEGIN
    UPDATE public.portal_configurations SET draft_logo_wide_path = 'nao-e-caminho-valido' WHERE owner_id = v_owner_a;
    INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
      ('15_controle_check_logo_wide_existe', 'PERMITIDO (CHECK não cobre logo_wide_path!)', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
      ('15_controle_check_logo_wide_existe', 'erro:check_violation (esperado)', true);
  END;
END $run_pos_aplicacao$;

-- ============================================================================
-- PASSO 5 — assinatura (argumentos/tipo de retorno) das 6 funções não mudou
-- em nenhuma delas — por isso CREATE OR REPLACE (não DROP+CREATE) é
-- suficiente em todas, e nenhum GRANT precisou ser refeito.
-- ============================================================================
DO $check_assinaturas$
DECLARE
  v_divergentes int;
BEGIN
  SELECT count(*) INTO v_divergentes
  FROM zzfx_k2c_originais_funcoes o
  JOIN pg_proc p ON p.proname = o.nome
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE pg_get_function_identity_arguments(p.oid) <> o.args
     OR pg_get_function_result(p.oid) <> o.result_type;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('16_assinatura_e_retorno_inalterados_nas_6_funcoes',
     format('%s função(ões) com assinatura/retorno diferente do original (esperado 0)', v_divergentes),
     v_divergentes = 0);
END $check_assinaturas$;

-- ============================================================================
-- PASSO 6 — DESFAZER (rollback, DDL colado na íntegra, igual ao arquivo
-- supabase/migrations_rollback/20261111191342_portal_k2c_logo_wide_rollback.sql).
-- ============================================================================

-- 6.1 — CHECKs de volta à forma sem logo_wide_path.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_configurations_draft_paths_check') THEN
    ALTER TABLE public.portal_configurations DROP CONSTRAINT portal_configurations_draft_paths_check;
  END IF;
  ALTER TABLE public.portal_configurations ADD CONSTRAINT portal_configurations_draft_paths_check CHECK (
    (draft_logo_path IS NULL OR public.portal_media_path_valid(draft_logo_path)) AND
    (draft_logo_light_path IS NULL OR public.portal_media_path_valid(draft_logo_light_path)) AND
    (draft_cover_path IS NULL OR public.portal_media_path_valid(draft_cover_path)) AND
    (draft_banner_path IS NULL OR public.portal_media_path_valid(draft_banner_path))
  );

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_configurations_published_paths_check') THEN
    ALTER TABLE public.portal_configurations DROP CONSTRAINT portal_configurations_published_paths_check;
  END IF;
  ALTER TABLE public.portal_configurations ADD CONSTRAINT portal_configurations_published_paths_check CHECK (
    (published_logo_path IS NULL OR public.portal_media_path_valid(published_logo_path)) AND
    (published_logo_light_path IS NULL OR public.portal_media_path_valid(published_logo_light_path)) AND
    (published_cover_path IS NULL OR public.portal_media_path_valid(published_cover_path)) AND
    (published_banner_path IS NULL OR public.portal_media_path_valid(published_banner_path))
  );
END $$;

-- 6.2 — colunas novas removidas.
ALTER TABLE public.portal_configurations
  DROP COLUMN IF EXISTS draft_logo_wide_path,
  DROP COLUMN IF EXISTS published_logo_wide_path;

-- 6.3 — portal_media_path_valid: regex sem "logo-wide".
CREATE OR REPLACE FUNCTION public.portal_media_path_valid(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo|logo-light|cover|banner|services|professionals|categories)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$';
$$;

-- 6.4 — portal_salvar_rascunho: forma anterior.
CREATE OR REPLACE FUNCTION public.portal_salvar_rascunho(p_config jsonb, p_version_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.portal_configurations;
  v_media_key text;
  v_err text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.version <> p_version_esperada THEN
    RETURN 'conflito_versao';
  END IF;

  SELECT portal_media_key::text INTO v_media_key FROM public.company_profiles WHERE owner_id = auth.uid();

  FOR v_err IN
    SELECT public.portal_validate_owned_path(p_config ->> col, v_media_key)
    FROM unnest(ARRAY['logo_path', 'logo_light_path', 'cover_path', 'banner_path']) AS col
  LOOP
    IF v_err IS NOT NULL THEN
      RETURN v_err;
    END IF;
  END LOOP;

  BEGIN
    UPDATE public.portal_configurations SET
      draft_theme_key = CASE WHEN p_config ? 'theme_key' THEN NULLIF(p_config ->> 'theme_key', '') ELSE draft_theme_key END,
      draft_color_primary = CASE WHEN p_config ? 'color_primary' THEN NULLIF(p_config ->> 'color_primary', '') ELSE draft_color_primary END,
      draft_color_secondary = CASE WHEN p_config ? 'color_secondary' THEN NULLIF(p_config ->> 'color_secondary', '') ELSE draft_color_secondary END,
      draft_color_button = CASE WHEN p_config ? 'color_button' THEN NULLIF(p_config ->> 'color_button', '') ELSE draft_color_button END,
      draft_color_button_text = CASE WHEN p_config ? 'color_button_text' THEN NULLIF(p_config ->> 'color_button_text', '') ELSE draft_color_button_text END,
      draft_color_text = CASE WHEN p_config ? 'color_text' THEN NULLIF(p_config ->> 'color_text', '') ELSE draft_color_text END,
      draft_color_background = CASE WHEN p_config ? 'color_background' THEN NULLIF(p_config ->> 'color_background', '') ELSE draft_color_background END,
      draft_font_key = CASE WHEN p_config ? 'font_key' THEN COALESCE(NULLIF(p_config ->> 'font_key', ''), 'system') ELSE draft_font_key END,
      draft_cover_title = CASE WHEN p_config ? 'cover_title' THEN NULLIF(p_config ->> 'cover_title', '') ELSE draft_cover_title END,
      draft_cover_subtitle = CASE WHEN p_config ? 'cover_subtitle' THEN NULLIF(p_config ->> 'cover_subtitle', '') ELSE draft_cover_subtitle END,
      draft_banner_text = CASE WHEN p_config ? 'banner_text' THEN NULLIF(p_config ->> 'banner_text', '') ELSE draft_banner_text END,
      draft_important_title = CASE WHEN p_config ? 'important_title' THEN NULLIF(p_config ->> 'important_title', '') ELSE draft_important_title END,
      draft_important_text = CASE WHEN p_config ? 'important_text' THEN NULLIF(p_config ->> 'important_text', '') ELSE draft_important_text END,
      draft_welcome_message = CASE WHEN p_config ? 'welcome_message' THEN NULLIF(p_config ->> 'welcome_message', '') ELSE draft_welcome_message END,
      draft_show_shortcuts = COALESCE((p_config ->> 'show_shortcuts')::boolean, draft_show_shortcuts),
      draft_show_banner = COALESCE((p_config ->> 'show_banner')::boolean, draft_show_banner),
      draft_show_services = COALESCE((p_config ->> 'show_services')::boolean, draft_show_services),
      draft_show_important = COALESCE((p_config ->> 'show_important')::boolean, draft_show_important),
      draft_show_professionals = COALESCE((p_config ->> 'show_professionals')::boolean, draft_show_professionals),
      draft_show_location = COALESCE((p_config ->> 'show_location')::boolean, draft_show_location),
      draft_show_footer = COALESCE((p_config ->> 'show_footer')::boolean, draft_show_footer),
      draft_logo_path = CASE WHEN p_config ? 'logo_path' THEN NULLIF(p_config ->> 'logo_path', '') ELSE draft_logo_path END,
      draft_logo_light_path = CASE WHEN p_config ? 'logo_light_path' THEN NULLIF(p_config ->> 'logo_light_path', '') ELSE draft_logo_light_path END,
      draft_cover_path = CASE WHEN p_config ? 'cover_path' THEN NULLIF(p_config ->> 'cover_path', '') ELSE draft_cover_path END,
      draft_banner_path = CASE WHEN p_config ? 'banner_path' THEN NULLIF(p_config ->> 'banner_path', '') ELSE draft_banner_path END,
      version = version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE owner_id = auth.uid() AND version = p_version_esperada;
  EXCEPTION WHEN check_violation THEN
    RETURN 'config_invalida';
  END;

  RETURN 'ok';
END;
$$;

-- 6.5 — portal_publicar: forma anterior.
CREATE OR REPLACE FUNCTION public.portal_publicar(p_version_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.portal_configurations;
  v_prev jsonb;
  v_text_color text;
  v_bg_color text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.version <> p_version_esperada THEN
    RETURN 'conflito_versao';
  END IF;

  v_text_color := COALESCE(v_row.draft_color_text, '#211c1a');
  v_bg_color := COALESCE(v_row.draft_color_background, '#f8f5f0');
  IF public.portal_contrast_ratio(v_text_color, v_bg_color) < 3.0 THEN
    RETURN 'contraste_insuficiente';
  END IF;

  v_prev := CASE WHEN v_row.published_at IS NULL THEN NULL ELSE jsonb_build_object(
    'theme_key', v_row.published_theme_key,
    'color_primary', v_row.published_color_primary,
    'color_secondary', v_row.published_color_secondary,
    'color_button', v_row.published_color_button,
    'color_button_text', v_row.published_color_button_text,
    'color_text', v_row.published_color_text,
    'color_background', v_row.published_color_background,
    'font_key', v_row.published_font_key,
    'cover_title', v_row.published_cover_title,
    'cover_subtitle', v_row.published_cover_subtitle,
    'banner_text', v_row.published_banner_text,
    'important_title', v_row.published_important_title,
    'important_text', v_row.published_important_text,
    'welcome_message', v_row.published_welcome_message,
    'show_shortcuts', v_row.published_show_shortcuts,
    'show_banner', v_row.published_show_banner,
    'show_services', v_row.published_show_services,
    'show_important', v_row.published_show_important,
    'show_professionals', v_row.published_show_professionals,
    'show_location', v_row.published_show_location,
    'show_footer', v_row.published_show_footer,
    'logo_path', v_row.published_logo_path,
    'logo_light_path', v_row.published_logo_light_path,
    'cover_path', v_row.published_cover_path,
    'banner_path', v_row.published_banner_path
  ) END;

  UPDATE public.portal_configurations SET
    published_theme_key = draft_theme_key,
    published_color_primary = draft_color_primary,
    published_color_secondary = draft_color_secondary,
    published_color_button = draft_color_button,
    published_color_button_text = draft_color_button_text,
    published_color_text = draft_color_text,
    published_color_background = draft_color_background,
    published_font_key = draft_font_key,
    published_cover_title = draft_cover_title,
    published_cover_subtitle = draft_cover_subtitle,
    published_banner_text = draft_banner_text,
    published_important_title = draft_important_title,
    published_important_text = draft_important_text,
    published_welcome_message = draft_welcome_message,
    published_show_shortcuts = draft_show_shortcuts,
    published_show_banner = draft_show_banner,
    published_show_services = draft_show_services,
    published_show_important = draft_show_important,
    published_show_professionals = draft_show_professionals,
    published_show_location = draft_show_location,
    published_show_footer = draft_show_footer,
    published_logo_path = draft_logo_path,
    published_logo_light_path = draft_logo_light_path,
    published_cover_path = draft_cover_path,
    published_banner_path = draft_banner_path,
    previous_published = v_prev,
    published_at = now(),
    published_by = auth.uid(),
    version = version + 1
  WHERE owner_id = auth.uid() AND version = p_version_esperada;

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (auth.uid(), auth.uid(), NULL, 'portal_published', 'portal_configurations', auth.uid()::text, NULL);

  RETURN 'ok';
END;
$$;

-- 6.6 — portal_desfazer_publicacao: forma anterior.
CREATE OR REPLACE FUNCTION public.portal_desfazer_publicacao()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.portal_configurations;
  v_current jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.previous_published IS NULL THEN
    RETURN 'nada_para_desfazer';
  END IF;

  v_current := jsonb_build_object(
    'theme_key', v_row.published_theme_key,
    'color_primary', v_row.published_color_primary,
    'color_secondary', v_row.published_color_secondary,
    'color_button', v_row.published_color_button,
    'color_button_text', v_row.published_color_button_text,
    'color_text', v_row.published_color_text,
    'color_background', v_row.published_color_background,
    'font_key', v_row.published_font_key,
    'cover_title', v_row.published_cover_title,
    'cover_subtitle', v_row.published_cover_subtitle,
    'banner_text', v_row.published_banner_text,
    'important_title', v_row.published_important_title,
    'important_text', v_row.published_important_text,
    'welcome_message', v_row.published_welcome_message,
    'show_shortcuts', v_row.published_show_shortcuts,
    'show_banner', v_row.published_show_banner,
    'show_services', v_row.published_show_services,
    'show_important', v_row.published_show_important,
    'show_professionals', v_row.published_show_professionals,
    'show_location', v_row.published_show_location,
    'show_footer', v_row.published_show_footer,
    'logo_path', v_row.published_logo_path,
    'logo_light_path', v_row.published_logo_light_path,
    'cover_path', v_row.published_cover_path,
    'banner_path', v_row.published_banner_path
  );

  UPDATE public.portal_configurations SET
    published_theme_key = previous_published ->> 'theme_key',
    published_color_primary = previous_published ->> 'color_primary',
    published_color_secondary = previous_published ->> 'color_secondary',
    published_color_button = previous_published ->> 'color_button',
    published_color_button_text = previous_published ->> 'color_button_text',
    published_color_text = previous_published ->> 'color_text',
    published_color_background = previous_published ->> 'color_background',
    published_font_key = previous_published ->> 'font_key',
    published_cover_title = previous_published ->> 'cover_title',
    published_cover_subtitle = previous_published ->> 'cover_subtitle',
    published_banner_text = previous_published ->> 'banner_text',
    published_important_title = previous_published ->> 'important_title',
    published_important_text = previous_published ->> 'important_text',
    published_welcome_message = previous_published ->> 'welcome_message',
    published_show_shortcuts = (previous_published ->> 'show_shortcuts')::boolean,
    published_show_banner = (previous_published ->> 'show_banner')::boolean,
    published_show_services = (previous_published ->> 'show_services')::boolean,
    published_show_important = (previous_published ->> 'show_important')::boolean,
    published_show_professionals = (previous_published ->> 'show_professionals')::boolean,
    published_show_location = (previous_published ->> 'show_location')::boolean,
    published_show_footer = (previous_published ->> 'show_footer')::boolean,
    published_logo_path = previous_published ->> 'logo_path',
    published_logo_light_path = previous_published ->> 'logo_light_path',
    published_cover_path = previous_published ->> 'cover_path',
    published_banner_path = previous_published ->> 'banner_path',
    previous_published = v_current,
    published_at = now(),
    published_by = auth.uid(),
    version = version + 1
  WHERE owner_id = auth.uid();

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (auth.uid(), auth.uid(), NULL, 'portal_publish_undone', 'portal_configurations', auth.uid()::text, NULL);

  RETURN 'ok';
END;
$$;

-- 6.7 — portal_descartar_rascunho: forma anterior.
CREATE OR REPLACE FUNCTION public.portal_descartar_rascunho()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  UPDATE public.portal_configurations SET
    draft_theme_key = COALESCE(published_theme_key, 'system'),
    draft_color_primary = published_color_primary,
    draft_color_secondary = published_color_secondary,
    draft_color_button = published_color_button,
    draft_color_button_text = published_color_button_text,
    draft_color_text = published_color_text,
    draft_color_background = published_color_background,
    draft_font_key = COALESCE(published_font_key, 'system'),
    draft_cover_title = published_cover_title,
    draft_cover_subtitle = published_cover_subtitle,
    draft_banner_text = published_banner_text,
    draft_important_title = published_important_title,
    draft_important_text = published_important_text,
    draft_welcome_message = published_welcome_message,
    draft_show_shortcuts = COALESCE(published_show_shortcuts, true),
    draft_show_banner = COALESCE(published_show_banner, true),
    draft_show_services = COALESCE(published_show_services, true),
    draft_show_important = COALESCE(published_show_important, true),
    draft_show_professionals = COALESCE(published_show_professionals, true),
    draft_show_location = COALESCE(published_show_location, true),
    draft_show_footer = COALESCE(published_show_footer, true),
    draft_logo_path = published_logo_path,
    draft_logo_light_path = published_logo_light_path,
    draft_cover_path = published_cover_path,
    draft_banner_path = published_banner_path,
    version = version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE owner_id = auth.uid();

  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  RETURN 'ok';
END;
$$;

-- 6.8 — portal_obter_publico: forma anterior.
CREATE OR REPLACE FUNCTION public.portal_obter_publico(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'published_at', pc.published_at,
    'theme_key', pc.published_theme_key,
    'color_primary', pc.published_color_primary,
    'color_secondary', pc.published_color_secondary,
    'color_button', pc.published_color_button,
    'color_button_text', pc.published_color_button_text,
    'color_text', pc.published_color_text,
    'color_background', pc.published_color_background,
    'font_key', pc.published_font_key,
    'cover_title', pc.published_cover_title,
    'cover_subtitle', pc.published_cover_subtitle,
    'banner_text', pc.published_banner_text,
    'important_title', pc.published_important_title,
    'important_text', pc.published_important_text,
    'welcome_message', pc.published_welcome_message,
    'show_shortcuts', pc.published_show_shortcuts,
    'show_banner', pc.published_show_banner,
    'show_services', pc.published_show_services,
    'show_important', pc.published_show_important,
    'show_professionals', pc.published_show_professionals,
    'show_location', pc.published_show_location,
    'show_footer', pc.published_show_footer,
    'logo_path', pc.published_logo_path,
    'logo_light_path', pc.published_logo_light_path,
    'cover_path', pc.published_cover_path,
    'banner_path', pc.published_banner_path
  )
  FROM public.company_profiles cp
  JOIN public.portal_configurations pc ON pc.owner_id = cp.owner_id
  WHERE cp.slug = p_slug AND pc.published_at IS NOT NULL;
$$;

-- ============================================================================
-- PASSO 7 — VERIFICAR pós-rollback: colunas sumiram, "logo-wide" volta a ser
-- inválido, as 6 funções/2 CHECKs/GRANTs voltaram EXATAMENTE ao capturado no
-- Passo 1, e o dado da coluna ANTIGA (logo_path) sobreviveu intacto.
-- ============================================================================
DO $run_pos_rollback$
DECLARE
  v_owner_a uuid;
  v_media_a uuid;
  v_path_logo_a text;
  v_n int;
  v_divergentes int;
  v_draft_logo_path text;
  v_published_logo_path text;
BEGIN
  SELECT valor::uuid INTO v_owner_a FROM zzfx_k2c_ids WHERE chave = 'owner_a';
  SELECT valor::uuid INTO v_media_a FROM zzfx_k2c_ids WHERE chave = 'media_a';
  SELECT valor INTO v_path_logo_a FROM zzfx_k2c_ids WHERE chave = 'path_logo_a';

  -- ===== 17: as 2 colunas novas sumiram =====
  SELECT count(*) INTO v_n FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'portal_configurations'
    AND column_name IN ('draft_logo_wide_path', 'published_logo_wide_path');
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('17_colunas_novas_sumiram_apos_rollback', format('%s coluna(s) ainda presente(s) (esperado 0)', v_n), v_n = 0);

  -- ===== 18: "logo-wide" volta a ser um tipo inválido =====
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('18_logo_wide_invalido_apos_rollback',
     v_media_a || '/logo-wide/11111111-1111-1111-1111-111111111111.png',
     NOT public.portal_media_path_valid(v_media_a || '/logo-wide/11111111-1111-1111-1111-111111111111.png'));

  -- ===== 19: as 6 funções voltaram EXATAMENTE ao corpo capturado no Passo 1 =====
  SELECT count(*) INTO v_divergentes
  FROM zzfx_k2c_originais_funcoes o
  JOIN pg_proc p ON p.proname = o.nome
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE pg_get_functiondef(p.oid) <> o.def;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('19_corpo_das_6_funcoes_identico_ao_original_pos_rollback',
     format('%s função(ões) com corpo diferente do original (esperado 0)', v_divergentes), v_divergentes = 0);

  -- ===== 20: GRANTs (anon/authenticated EXECUTE) idênticos ao original =====
  SELECT count(*) INTO v_divergentes
  FROM zzfx_k2c_originais_grants o
  JOIN pg_proc p ON p.proname = o.nome
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE has_function_privilege('anon', p.oid, 'EXECUTE') <> o.anon_execute
     OR has_function_privilege('authenticated', p.oid, 'EXECUTE') <> o.authenticated_execute;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('20_grants_identicos_ao_original_pos_rollback',
     format('%s função(ões) com GRANT diferente do original (esperado 0)', v_divergentes), v_divergentes = 0);

  -- ===== 21: as 2 CHECK constraints voltaram EXATAMENTE à definição original =====
  SELECT count(*) INTO v_divergentes
  FROM zzfx_k2c_originais_checks o
  JOIN pg_constraint c ON c.conname = o.nome
  WHERE pg_get_constraintdef(c.oid) <> o.def;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('21_checks_identicos_ao_original_pos_rollback',
     format('%s CHECK(s) diferente(s) do original (esperado 0)', v_divergentes), v_divergentes = 0);

  -- ===== 22: dado da coluna ANTIGA (logo_path) sobreviveu ao ciclo inteiro,
  -- sem alteração — tanto no draft quanto no published (o publicar do Passo 4
  -- copiou draft_logo_path pra published_logo_path, então os dois devem
  -- bater) =====
  SELECT draft_logo_path, published_logo_path INTO v_draft_logo_path, v_published_logo_path
  FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('22_dado_antigo_logo_path_sobrevive_ao_ciclo_completo',
     format('draft_logo_path=%s published_logo_path=%s (esperado=%s)', v_draft_logo_path, v_published_logo_path, v_path_logo_a),
     v_draft_logo_path = v_path_logo_a AND v_published_logo_path = v_path_logo_a);
END $run_pos_rollback$;

-- ============================================================================
-- PASSO 8 — REAPLICAR a migração (DDL colado de novo, idêntico ao Passo 3).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.portal_media_path_valid(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo|logo-light|logo-wide|cover|banner|services|professionals|categories)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$';
$$;

ALTER TABLE public.portal_configurations
  ADD COLUMN IF NOT EXISTS draft_logo_wide_path text,
  ADD COLUMN IF NOT EXISTS published_logo_wide_path text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_configurations_draft_paths_check') THEN
    ALTER TABLE public.portal_configurations DROP CONSTRAINT portal_configurations_draft_paths_check;
  END IF;
  ALTER TABLE public.portal_configurations ADD CONSTRAINT portal_configurations_draft_paths_check CHECK (
    (draft_logo_path IS NULL OR public.portal_media_path_valid(draft_logo_path)) AND
    (draft_logo_light_path IS NULL OR public.portal_media_path_valid(draft_logo_light_path)) AND
    (draft_logo_wide_path IS NULL OR public.portal_media_path_valid(draft_logo_wide_path)) AND
    (draft_cover_path IS NULL OR public.portal_media_path_valid(draft_cover_path)) AND
    (draft_banner_path IS NULL OR public.portal_media_path_valid(draft_banner_path))
  );

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_configurations_published_paths_check') THEN
    ALTER TABLE public.portal_configurations DROP CONSTRAINT portal_configurations_published_paths_check;
  END IF;
  ALTER TABLE public.portal_configurations ADD CONSTRAINT portal_configurations_published_paths_check CHECK (
    (published_logo_path IS NULL OR public.portal_media_path_valid(published_logo_path)) AND
    (published_logo_light_path IS NULL OR public.portal_media_path_valid(published_logo_light_path)) AND
    (published_logo_wide_path IS NULL OR public.portal_media_path_valid(published_logo_wide_path)) AND
    (published_cover_path IS NULL OR public.portal_media_path_valid(published_cover_path)) AND
    (published_banner_path IS NULL OR public.portal_media_path_valid(published_banner_path))
  );
END $$;

CREATE OR REPLACE FUNCTION public.portal_salvar_rascunho(p_config jsonb, p_version_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.portal_configurations;
  v_media_key text;
  v_err text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.version <> p_version_esperada THEN
    RETURN 'conflito_versao';
  END IF;

  SELECT portal_media_key::text INTO v_media_key FROM public.company_profiles WHERE owner_id = auth.uid();

  FOR v_err IN
    SELECT public.portal_validate_owned_path(p_config ->> col, v_media_key)
    FROM unnest(ARRAY['logo_path', 'logo_light_path', 'logo_wide_path', 'cover_path', 'banner_path']) AS col
  LOOP
    IF v_err IS NOT NULL THEN
      RETURN v_err;
    END IF;
  END LOOP;

  BEGIN
    UPDATE public.portal_configurations SET
      draft_theme_key = CASE WHEN p_config ? 'theme_key' THEN NULLIF(p_config ->> 'theme_key', '') ELSE draft_theme_key END,
      draft_color_primary = CASE WHEN p_config ? 'color_primary' THEN NULLIF(p_config ->> 'color_primary', '') ELSE draft_color_primary END,
      draft_color_secondary = CASE WHEN p_config ? 'color_secondary' THEN NULLIF(p_config ->> 'color_secondary', '') ELSE draft_color_secondary END,
      draft_color_button = CASE WHEN p_config ? 'color_button' THEN NULLIF(p_config ->> 'color_button', '') ELSE draft_color_button END,
      draft_color_button_text = CASE WHEN p_config ? 'color_button_text' THEN NULLIF(p_config ->> 'color_button_text', '') ELSE draft_color_button_text END,
      draft_color_text = CASE WHEN p_config ? 'color_text' THEN NULLIF(p_config ->> 'color_text', '') ELSE draft_color_text END,
      draft_color_background = CASE WHEN p_config ? 'color_background' THEN NULLIF(p_config ->> 'color_background', '') ELSE draft_color_background END,
      draft_font_key = CASE WHEN p_config ? 'font_key' THEN COALESCE(NULLIF(p_config ->> 'font_key', ''), 'system') ELSE draft_font_key END,
      draft_cover_title = CASE WHEN p_config ? 'cover_title' THEN NULLIF(p_config ->> 'cover_title', '') ELSE draft_cover_title END,
      draft_cover_subtitle = CASE WHEN p_config ? 'cover_subtitle' THEN NULLIF(p_config ->> 'cover_subtitle', '') ELSE draft_cover_subtitle END,
      draft_banner_text = CASE WHEN p_config ? 'banner_text' THEN NULLIF(p_config ->> 'banner_text', '') ELSE draft_banner_text END,
      draft_important_title = CASE WHEN p_config ? 'important_title' THEN NULLIF(p_config ->> 'important_title', '') ELSE draft_important_title END,
      draft_important_text = CASE WHEN p_config ? 'important_text' THEN NULLIF(p_config ->> 'important_text', '') ELSE draft_important_text END,
      draft_welcome_message = CASE WHEN p_config ? 'welcome_message' THEN NULLIF(p_config ->> 'welcome_message', '') ELSE draft_welcome_message END,
      draft_show_shortcuts = COALESCE((p_config ->> 'show_shortcuts')::boolean, draft_show_shortcuts),
      draft_show_banner = COALESCE((p_config ->> 'show_banner')::boolean, draft_show_banner),
      draft_show_services = COALESCE((p_config ->> 'show_services')::boolean, draft_show_services),
      draft_show_important = COALESCE((p_config ->> 'show_important')::boolean, draft_show_important),
      draft_show_professionals = COALESCE((p_config ->> 'show_professionals')::boolean, draft_show_professionals),
      draft_show_location = COALESCE((p_config ->> 'show_location')::boolean, draft_show_location),
      draft_show_footer = COALESCE((p_config ->> 'show_footer')::boolean, draft_show_footer),
      draft_logo_path = CASE WHEN p_config ? 'logo_path' THEN NULLIF(p_config ->> 'logo_path', '') ELSE draft_logo_path END,
      draft_logo_light_path = CASE WHEN p_config ? 'logo_light_path' THEN NULLIF(p_config ->> 'logo_light_path', '') ELSE draft_logo_light_path END,
      draft_logo_wide_path = CASE WHEN p_config ? 'logo_wide_path' THEN NULLIF(p_config ->> 'logo_wide_path', '') ELSE draft_logo_wide_path END,
      draft_cover_path = CASE WHEN p_config ? 'cover_path' THEN NULLIF(p_config ->> 'cover_path', '') ELSE draft_cover_path END,
      draft_banner_path = CASE WHEN p_config ? 'banner_path' THEN NULLIF(p_config ->> 'banner_path', '') ELSE draft_banner_path END,
      version = version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE owner_id = auth.uid() AND version = p_version_esperada;
  EXCEPTION WHEN check_violation THEN
    RETURN 'config_invalida';
  END;

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_publicar(p_version_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.portal_configurations;
  v_prev jsonb;
  v_text_color text;
  v_bg_color text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.version <> p_version_esperada THEN
    RETURN 'conflito_versao';
  END IF;

  v_text_color := COALESCE(v_row.draft_color_text, '#211c1a');
  v_bg_color := COALESCE(v_row.draft_color_background, '#f8f5f0');
  IF public.portal_contrast_ratio(v_text_color, v_bg_color) < 3.0 THEN
    RETURN 'contraste_insuficiente';
  END IF;

  v_prev := CASE WHEN v_row.published_at IS NULL THEN NULL ELSE jsonb_build_object(
    'theme_key', v_row.published_theme_key,
    'color_primary', v_row.published_color_primary,
    'color_secondary', v_row.published_color_secondary,
    'color_button', v_row.published_color_button,
    'color_button_text', v_row.published_color_button_text,
    'color_text', v_row.published_color_text,
    'color_background', v_row.published_color_background,
    'font_key', v_row.published_font_key,
    'cover_title', v_row.published_cover_title,
    'cover_subtitle', v_row.published_cover_subtitle,
    'banner_text', v_row.published_banner_text,
    'important_title', v_row.published_important_title,
    'important_text', v_row.published_important_text,
    'welcome_message', v_row.published_welcome_message,
    'show_shortcuts', v_row.published_show_shortcuts,
    'show_banner', v_row.published_show_banner,
    'show_services', v_row.published_show_services,
    'show_important', v_row.published_show_important,
    'show_professionals', v_row.published_show_professionals,
    'show_location', v_row.published_show_location,
    'show_footer', v_row.published_show_footer,
    'logo_path', v_row.published_logo_path,
    'logo_light_path', v_row.published_logo_light_path,
    'logo_wide_path', v_row.published_logo_wide_path,
    'cover_path', v_row.published_cover_path,
    'banner_path', v_row.published_banner_path
  ) END;

  UPDATE public.portal_configurations SET
    published_theme_key = draft_theme_key,
    published_color_primary = draft_color_primary,
    published_color_secondary = draft_color_secondary,
    published_color_button = draft_color_button,
    published_color_button_text = draft_color_button_text,
    published_color_text = draft_color_text,
    published_color_background = draft_color_background,
    published_font_key = draft_font_key,
    published_cover_title = draft_cover_title,
    published_cover_subtitle = draft_cover_subtitle,
    published_banner_text = draft_banner_text,
    published_important_title = draft_important_title,
    published_important_text = draft_important_text,
    published_welcome_message = draft_welcome_message,
    published_show_shortcuts = draft_show_shortcuts,
    published_show_banner = draft_show_banner,
    published_show_services = draft_show_services,
    published_show_important = draft_show_important,
    published_show_professionals = draft_show_professionals,
    published_show_location = draft_show_location,
    published_show_footer = draft_show_footer,
    published_logo_path = draft_logo_path,
    published_logo_light_path = draft_logo_light_path,
    published_logo_wide_path = draft_logo_wide_path,
    published_cover_path = draft_cover_path,
    published_banner_path = draft_banner_path,
    previous_published = v_prev,
    published_at = now(),
    published_by = auth.uid(),
    version = version + 1
  WHERE owner_id = auth.uid() AND version = p_version_esperada;

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (auth.uid(), auth.uid(), NULL, 'portal_published', 'portal_configurations', auth.uid()::text, NULL);

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_desfazer_publicacao()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_row public.portal_configurations;
  v_current jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.previous_published IS NULL THEN
    RETURN 'nada_para_desfazer';
  END IF;

  v_current := jsonb_build_object(
    'theme_key', v_row.published_theme_key,
    'color_primary', v_row.published_color_primary,
    'color_secondary', v_row.published_color_secondary,
    'color_button', v_row.published_color_button,
    'color_button_text', v_row.published_color_button_text,
    'color_text', v_row.published_color_text,
    'color_background', v_row.published_color_background,
    'font_key', v_row.published_font_key,
    'cover_title', v_row.published_cover_title,
    'cover_subtitle', v_row.published_cover_subtitle,
    'banner_text', v_row.published_banner_text,
    'important_title', v_row.published_important_title,
    'important_text', v_row.published_important_text,
    'welcome_message', v_row.published_welcome_message,
    'show_shortcuts', v_row.published_show_shortcuts,
    'show_banner', v_row.published_show_banner,
    'show_services', v_row.published_show_services,
    'show_important', v_row.published_show_important,
    'show_professionals', v_row.published_show_professionals,
    'show_location', v_row.published_show_location,
    'show_footer', v_row.published_show_footer,
    'logo_path', v_row.published_logo_path,
    'logo_light_path', v_row.published_logo_light_path,
    'logo_wide_path', v_row.published_logo_wide_path,
    'cover_path', v_row.published_cover_path,
    'banner_path', v_row.published_banner_path
  );

  UPDATE public.portal_configurations SET
    published_theme_key = previous_published ->> 'theme_key',
    published_color_primary = previous_published ->> 'color_primary',
    published_color_secondary = previous_published ->> 'color_secondary',
    published_color_button = previous_published ->> 'color_button',
    published_color_button_text = previous_published ->> 'color_button_text',
    published_color_text = previous_published ->> 'color_text',
    published_color_background = previous_published ->> 'color_background',
    published_font_key = previous_published ->> 'font_key',
    published_cover_title = previous_published ->> 'cover_title',
    published_cover_subtitle = previous_published ->> 'cover_subtitle',
    published_banner_text = previous_published ->> 'banner_text',
    published_important_title = previous_published ->> 'important_title',
    published_important_text = previous_published ->> 'important_text',
    published_welcome_message = previous_published ->> 'welcome_message',
    published_show_shortcuts = (previous_published ->> 'show_shortcuts')::boolean,
    published_show_banner = (previous_published ->> 'show_banner')::boolean,
    published_show_services = (previous_published ->> 'show_services')::boolean,
    published_show_important = (previous_published ->> 'show_important')::boolean,
    published_show_professionals = (previous_published ->> 'show_professionals')::boolean,
    published_show_location = (previous_published ->> 'show_location')::boolean,
    published_show_footer = (previous_published ->> 'show_footer')::boolean,
    published_logo_path = previous_published ->> 'logo_path',
    published_logo_light_path = previous_published ->> 'logo_light_path',
    published_logo_wide_path = previous_published ->> 'logo_wide_path',
    published_cover_path = previous_published ->> 'cover_path',
    published_banner_path = previous_published ->> 'banner_path',
    previous_published = v_current,
    published_at = now(),
    published_by = auth.uid(),
    version = version + 1
  WHERE owner_id = auth.uid();

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (auth.uid(), auth.uid(), NULL, 'portal_publish_undone', 'portal_configurations', auth.uid()::text, NULL);

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_descartar_rascunho()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  UPDATE public.portal_configurations SET
    draft_theme_key = COALESCE(published_theme_key, 'system'),
    draft_color_primary = published_color_primary,
    draft_color_secondary = published_color_secondary,
    draft_color_button = published_color_button,
    draft_color_button_text = published_color_button_text,
    draft_color_text = published_color_text,
    draft_color_background = published_color_background,
    draft_font_key = COALESCE(published_font_key, 'system'),
    draft_cover_title = published_cover_title,
    draft_cover_subtitle = published_cover_subtitle,
    draft_banner_text = published_banner_text,
    draft_important_title = published_important_title,
    draft_important_text = published_important_text,
    draft_welcome_message = published_welcome_message,
    draft_show_shortcuts = COALESCE(published_show_shortcuts, true),
    draft_show_banner = COALESCE(published_show_banner, true),
    draft_show_services = COALESCE(published_show_services, true),
    draft_show_important = COALESCE(published_show_important, true),
    draft_show_professionals = COALESCE(published_show_professionals, true),
    draft_show_location = COALESCE(published_show_location, true),
    draft_show_footer = COALESCE(published_show_footer, true),
    draft_logo_path = published_logo_path,
    draft_logo_light_path = published_logo_light_path,
    draft_logo_wide_path = published_logo_wide_path,
    draft_cover_path = published_cover_path,
    draft_banner_path = published_banner_path,
    version = version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE owner_id = auth.uid();

  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_obter_publico(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'published_at', pc.published_at,
    'theme_key', pc.published_theme_key,
    'color_primary', pc.published_color_primary,
    'color_secondary', pc.published_color_secondary,
    'color_button', pc.published_color_button,
    'color_button_text', pc.published_color_button_text,
    'color_text', pc.published_color_text,
    'color_background', pc.published_color_background,
    'font_key', pc.published_font_key,
    'cover_title', pc.published_cover_title,
    'cover_subtitle', pc.published_cover_subtitle,
    'banner_text', pc.published_banner_text,
    'important_title', pc.published_important_title,
    'important_text', pc.published_important_text,
    'welcome_message', pc.published_welcome_message,
    'show_shortcuts', pc.published_show_shortcuts,
    'show_banner', pc.published_show_banner,
    'show_services', pc.published_show_services,
    'show_important', pc.published_show_important,
    'show_professionals', pc.published_show_professionals,
    'show_location', pc.published_show_location,
    'show_footer', pc.published_show_footer,
    'logo_path', pc.published_logo_path,
    'logo_light_path', pc.published_logo_light_path,
    'logo_wide_path', pc.published_logo_wide_path,
    'cover_path', pc.published_cover_path,
    'banner_path', pc.published_banner_path
  )
  FROM public.company_profiles cp
  JOIN public.portal_configurations pc ON pc.owner_id = cp.owner_id
  WHERE cp.slug = p_slug AND pc.published_at IS NOT NULL;
$$;

-- ============================================================================
-- PASSO 9 — VERIFICAR pós-reaplicação: "logo-wide" funciona de novo, as
-- colunas voltaram (frescas, NULL — é esperado: o rollback as removeu, então
-- o dado de logo_wide_path criado DEPOIS da migração original, ao contrário
-- do logo_path do Passo 2, não deveria mesmo sobreviver a um DROP COLUMN),
-- e o dado ANTIGO (logo_path) continua intacto depois do ciclo inteiro.
-- ============================================================================
DO $run_pos_reaplicacao$
DECLARE
  v_owner_a uuid;
  v_media_a uuid;
  v_path_logo_a text;
  v_result text;
  v_row public.portal_configurations;
  v_val text;
  v_n int;
BEGIN
  SELECT valor::uuid INTO v_owner_a FROM zzfx_k2c_ids WHERE chave = 'owner_a';
  SELECT valor::uuid INTO v_media_a FROM zzfx_k2c_ids WHERE chave = 'media_a';
  SELECT valor INTO v_path_logo_a FROM zzfx_k2c_ids WHERE chave = 'path_logo_a';

  -- ===== 23: colunas voltaram a existir (frescas) =====
  SELECT count(*) INTO v_n FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'portal_configurations'
    AND column_name IN ('draft_logo_wide_path', 'published_logo_wide_path');
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('23_colunas_voltam_a_existir_apos_reaplicar', format('%s coluna(s) presente(s) (esperado 2)', v_n), v_n = 2);

  -- ===== 24: "logo-wide" é válido de novo =====
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('24_logo_wide_valido_de_novo_apos_reaplicar',
     v_media_a || '/logo-wide/11111111-1111-1111-1111-111111111111.png',
     public.portal_media_path_valid(v_media_a || '/logo-wide/11111111-1111-1111-1111-111111111111.png'));

  -- ===== 25: round-trip funcional completo de novo (salvar + publicar) =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_salvar_rascunho(
    jsonb_build_object('logo_wide_path', v_media_a || '/logo-wide/' || gen_random_uuid() || '.png'), v_row.version
  ) INTO v_result;
  -- "arquivo_inexistente" é o resultado ESPERADO aqui (não inserimos o novo
  -- caminho em storage.objects de propósito) — o que importa pra este caso é
  -- que a validação voltou a RECONHECER "logo-wide" como kind válido (não
  -- caiu em "caminho_invalido" por falta de suporte ao kind), prosseguindo
  -- até a checagem de existência do arquivo.
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('25_salvar_rascunho_reconhece_logo_wide_de_novo', format('resultado=%s', v_result), v_result = 'arquivo_inexistente');
  RESET request.jwt.claim.sub;

  -- ===== 26: dado ANTIGO (logo_path) continua intacto depois do ciclo
  -- aplicar->verificar->rollback->verificar->reaplicar inteiro =====
  SELECT draft_logo_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('26_dado_antigo_logo_path_intacto_apos_ciclo_completo',
     format('draft_logo_path=%s (esperado=%s)', v_val, v_path_logo_a), v_val = v_path_logo_a);
END $run_pos_reaplicacao$;

SELECT caso, detalhe, passou FROM zzfx_k2c_results ORDER BY ordem;

DO $final_check$
DECLARE v_falhas int;
BEGIN
  SELECT count(*) INTO v_falhas FROM zzfx_k2c_results WHERE passou IS NOT TRUE;
  IF v_falhas > 0 THEN
    RAISE EXCEPTION 'SUÍTE FALHOU: % caso(s) não passou(aram) — ver SELECT acima', v_falhas;
  END IF;
END $final_check$;

ROLLBACK;
