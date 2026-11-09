-- K1a-1 — Suíte completa das tabelas/funções de 20261109020000_portal_personalization.sql
-- (portal_configurations, portal_service_categories, bucket portal-media,
-- portal_salvar_rascunho/publicar/descartar_rascunho/desfazer_publicacao/
-- obter_publico). Mesmo padrão de agenda_removed_and_reactivate.sql e
-- whatsapp_central_reply_confirm_status.sql: uma transação, NUNCA COMMIT,
-- fixtures sintéticas ZZFX_/zz-fixture-...@invalid.test, auth.uid()
-- simulado via SET LOCAL ROLE + set_config('request.jwt.claim.sub', ...).
--
-- PRESSUPÕE QUE A MIGRAÇÃO JÁ FOI APLICADA (schema real) — não recria
-- tabelas/funções aqui, só os dados de teste.
--
-- Verificador de padrões proibidos (antes de rodar): este arquivo não
-- contém COMMIT nenhum, não contém DROP/TRUNCATE em tabela real, não
-- altera policy/trigger/grant de nenhum objeto fora do que está sob teste,
-- e todo dado sintético usa prefixo ZZFX_/zz-fixture- (nunca toca linha
-- real). Confirmar visualmente antes de colar.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE zzfx_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;

-- ===== Setup: 2 empresas (A, B) + 1 staff de A com permissão TOTAL em agenda/services =====
DO $setup$
DECLARE
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_staff_full_user uuid := gen_random_uuid();
  v_al_gerente uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_a||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_b||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_staff_full_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_staff_full_user||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb);

  -- Só owner_a/owner_b viram 'admin' — staff_full nunca recebe o papel,
  -- mesmo tendo permissão total em agenda/services via access_level.
  INSERT INTO public.user_roles (user_id, role) VALUES (v_owner_a, 'admin'), (v_owner_b, 'admin');

  INSERT INTO public.company_profiles (owner_id, slug, display_name) VALUES
    (v_owner_a, 'zzfx-portal-a', 'ZZFX Portal A'),
    (v_owner_b, 'zzfx-portal-b', 'ZZFX Portal B');
  -- portal_configurations_auto_create (trigger) já criou 1 linha pra cada.

  PERFORM public.seed_default_access_levels(v_owner_a);
  SELECT id INTO v_al_gerente FROM public.access_levels WHERE owner_id = v_owner_a AND name = 'Gerente';
  INSERT INTO public.team_members (owner_id, user_id, access_level_id, status, full_name) VALUES
    (v_owner_a, v_staff_full_user, v_al_gerente, 'active', 'ZZFX_Staff_Full');

  INSERT INTO zzfx_ids (k, v) VALUES
    ('owner_a', v_owner_a), ('owner_b', v_owner_b), ('staff_full_user', v_staff_full_user);
END $setup$;

DO $sentinel$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE 'zz-fixture-%@invalid.test';
  IF n <> 3 THEN RAISE EXCEPTION 'SENTINELA: esperado 3 usuários sintéticos, achei %', n; END IF;
END $sentinel$;

-- Schema temp só dá USAGE pra quem criou — sem isto, SET LOCAL ROLE
-- anon/authenticated não conseguiria ler/escrever nas tabelas TEMP.
DO $grant$
DECLARE v_schema text := (SELECT pg_my_temp_schema()::regnamespace::text);
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %s TO anon, authenticated', v_schema);
  EXECUTE format('GRANT ALL ON %s.zzfx_results, %s.zzfx_ids TO anon, authenticated', v_schema, v_schema);
  EXECUTE format('GRANT USAGE, SELECT ON %s.zzfx_results_ordem_seq TO anon, authenticated', v_schema);
END $grant$;

-- Marcador pré-existente (fora do escopo desta migração) — usado só no
-- caso 33 (rollback preserva dado de outra tabela) pra provar que nada
-- desta suíte/migração altera dado alheio.
DO $marker$
DECLARE v_owner_a uuid := (SELECT v FROM zzfx_ids WHERE k = 'owner_a');
BEGIN
  UPDATE public.company_profiles SET category = 'ZZFX_MARCADOR_INTACTO' WHERE owner_id = v_owner_a;
END $marker$;

DO $run$
DECLARE
  v_owner_a uuid := (SELECT v FROM zzfx_ids WHERE k = 'owner_a');
  v_owner_b uuid := (SELECT v FROM zzfx_ids WHERE k = 'owner_b');
  v_staff_full uuid := (SELECT v FROM zzfx_ids WHERE k = 'staff_full_user');
  v_media_a text; v_media_b text;
  r text; r2 text; n int;
  v_version_a int; v_published_at timestamptz;
  v_cfg jsonb;
  v_text text; v_text2 text;
  v_category_mark text;
BEGIN
  SELECT portal_media_key::text INTO v_media_a FROM public.company_profiles WHERE owner_id = v_owner_a;
  SELECT portal_media_key::text INTO v_media_b FROM public.company_profiles WHERE owner_id = v_owner_b;

  -- Arquivos "enviados" sintéticos (insert direto em storage.objects — não
  -- passa pela API real de upload, só simula "o arquivo existe" pro que as
  -- funções conferem).
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('portal-media', v_media_a || '/logo/11111111-1111-1111-1111-111111111111.png', v_owner_a),
    ('portal-media', v_media_b || '/logo/22222222-2222-2222-2222-222222222222.png', v_owner_b);

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- ===== 1: owner_a salva rascunho válido com sucesso =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  r := public.portal_salvar_rascunho(
    jsonb_build_object('color_primary', '#55443b', 'color_text', '#211c1a', 'color_background', '#f8f5f0', 'font_key', 'serif_fine', 'welcome_message', 'ZZFX Bem-vinda!'),
    1);
  SELECT version INTO v_version_a FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('1_salvar_rascunho_ok',
    format('r=%s version=%s', r, v_version_a), r = 'ok' AND v_version_a = 2);

  -- ===== 2: conflito de versão (manda a versão antiga de novo) =====
  r := public.portal_salvar_rascunho(jsonb_build_object('welcome_message', 'ZZFX outra'), 1);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('2_conflito_versao', format('r=%s', r), r = 'conflito_versao');

  -- ===== 3: cor hex inválida recusada =====
  r := public.portal_salvar_rascunho(jsonb_build_object('color_primary', 'not-a-color'), v_version_a);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('3_cor_invalida_recusada', format('r=%s', r), r = 'config_invalida');

  -- ===== 4: fonte fora da lista fechada recusada =====
  r := public.portal_salvar_rascunho(jsonb_build_object('font_key', 'comic_sans'), v_version_a);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('4_fonte_invalida_recusada', format('r=%s', r), r = 'config_invalida');

  -- ===== 5: texto acima do limite (welcome_message > 300) recusado =====
  r := public.portal_salvar_rascunho(jsonb_build_object('welcome_message', repeat('A', 301)), v_version_a);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('5_texto_longo_recusado', format('r=%s', r), r = 'config_invalida');

  -- ===== 6: nenhum dos recusados acima mudou a versão (3,4,5 não avançaram) =====
  SELECT version INTO n FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('6_recusados_nao_mudam_versao',
    format('version=%s (esperado %s)', n, v_version_a), n = v_version_a);

  -- ===== 7: caminho de imagem bem formado mas de pasta de OUTRA empresa =====
  r := public.portal_salvar_rascunho(
    jsonb_build_object('logo_path', v_media_b || '/logo/22222222-2222-2222-2222-222222222222.png'), v_version_a);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('7_caminho_outra_empresa_recusado', format('r=%s', r), r = 'caminho_invalido');

  -- ===== 8: caminho com ".." (tentativa de escapar da pasta) =====
  r := public.portal_salvar_rascunho(jsonb_build_object('logo_path', '../../etc/passwd'), v_version_a);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('8_caminho_dotdot_recusado', format('r=%s', r), r = 'caminho_invalido');

  -- ===== 9: caminho bem formado, pasta própria, mas arquivo NUNCA enviado =====
  r := public.portal_salvar_rascunho(
    jsonb_build_object('cover_path', v_media_a || '/cover/99999999-9999-9999-9999-999999999999.jpg'), v_version_a);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('9_arquivo_inexistente_recusado', format('r=%s', r), r = 'arquivo_inexistente');

  -- ===== 10: caminho bem formado, pasta própria, arquivo existente — aceito =====
  r := public.portal_salvar_rascunho(
    jsonb_build_object('logo_path', v_media_a || '/logo/11111111-1111-1111-1111-111111111111.png'), v_version_a);
  SELECT version INTO v_version_a FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('10_caminho_proprio_existente_aceito', format('r=%s version=%s', r, v_version_a), r = 'ok');

  -- ===== 11: staff com permissão TOTAL (agenda+services edit) ainda assim NÃO consegue editar o portal =====
  PERFORM set_config('request.jwt.claim.sub', v_staff_full::text, true);
  r := public.portal_salvar_rascunho(jsonb_build_object('welcome_message', 'ZZFX staff tentando'), v_version_a);
  r2 := public.portal_publicar(v_version_a);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('11_staff_com_permissao_total_negado',
    format('salvar=%s publicar=%s', r, r2), r = 'sem_permissao' AND r2 = 'sem_permissao');

  -- ===== 12: staff não lê portal_configurations de ninguém (RLS, sem policy de staff) =====
  SELECT count(*) INTO n FROM public.portal_configurations;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('12_staff_nao_le_nenhuma_linha', format('linhas_visiveis=%s', n), n = 0);

  -- ===== 13: isolamento — owner_b chamando as funções nunca afeta a linha de owner_a =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_b::text, true);
  PERFORM public.portal_salvar_rascunho(jsonb_build_object('welcome_message', 'ZZFX de B, nunca deveria encostar em A'), 1);
  SELECT draft_welcome_message INTO v_text FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('13_isolamento_escrita_entre_empresas',
    format('welcome_a=%s (nao pode ser o texto de B)', v_text), v_text IS DISTINCT FROM 'ZZFX de B, nunca deveria encostar em A');

  -- ===== 14: isolamento de storage — owner_b não consegue inserir objeto na pasta de A (RLS de storage.objects) =====
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('portal-media', v_media_a || '/logo/33333333-3333-3333-3333-333333333333.png', v_owner_b);
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('14_storage_isolamento_insert_negado', 'PERMITIDO (BUG!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('14_storage_isolamento_insert_negado', 'erro:42501 (esperado)', true);
  END;

  -- ===== 15: owner_b consegue inserir na PRÓPRIA pasta normalmente =====
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('portal-media', v_media_b || '/cover/44444444-4444-4444-4444-444444444444.jpg', v_owner_b);
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('15_storage_propria_pasta_permitido', 'ok', true);

  -- ===== 16: publicar com sucesso — published_* = draft_*, published_at preenchido =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  r := public.portal_publicar(v_version_a);
  SELECT published_logo_path, published_at, version INTO v_text, v_published_at, n FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('16_publicar_ok',
    format('r=%s logo=%s published_at_preenchido=%s', r, v_text, v_published_at IS NOT NULL),
    r = 'ok' AND v_text = (v_media_a || '/logo/11111111-1111-1111-1111-111111111111.png') AND v_published_at IS NOT NULL);
  v_version_a := n;

  -- ===== 17: publicar com conflito de versão não muda nada =====
  r := public.portal_publicar(1);
  SELECT version INTO n FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('17_publicar_conflito_versao_nao_muda_nada',
    format('r=%s version=%s(esperado %s)', r, n, v_version_a), r = 'conflito_versao' AND n = v_version_a);

  -- ===== 18: publicar bloqueado por contraste insuficiente (texto quase igual ao fundo) =====
  r := public.portal_salvar_rascunho(jsonb_build_object('color_text', '#f8f5f0', 'color_background', '#f9f6f1'), v_version_a);
  SELECT version INTO v_version_a FROM public.portal_configurations WHERE owner_id = v_owner_a;
  r := public.portal_publicar(v_version_a);
  SELECT published_color_text INTO v_text FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('18_publicar_contraste_insuficiente_bloqueado',
    format('r=%s published_color_text=%s(nao pode ter mudado)', r, v_text), r = 'contraste_insuficiente' AND v_text = '#211c1a');

  -- Corrige o rascunho pra um contraste válido antes de seguir.
  r := public.portal_salvar_rascunho(jsonb_build_object('color_text', '#211c1a', 'color_background', '#f8f5f0'), v_version_a);
  SELECT version INTO v_version_a FROM public.portal_configurations WHERE owner_id = v_owner_a;

  -- ===== 19: desfazer sem nada anterior publicado (só 1 publicação até aqui) =====
  r := public.portal_desfazer_publicacao();
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('19_desfazer_sem_anterior', format('r=%s', r), r = 'nada_para_desfazer');

  -- ===== 20: 2ª publicação com welcome_message diferente, depois desfazer restaura a 1ª =====
  r := public.portal_salvar_rascunho(jsonb_build_object('welcome_message', 'ZZFX segunda versão publicada'), v_version_a);
  SELECT version INTO v_version_a FROM public.portal_configurations WHERE owner_id = v_owner_a;
  r := public.portal_publicar(v_version_a);
  SELECT version INTO v_version_a FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT published_welcome_message INTO v_text FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('20_segunda_publicacao_ok',
    format('r=%s welcome=%s', r, v_text), r = 'ok' AND v_text = 'ZZFX segunda versão publicada');

  r := public.portal_desfazer_publicacao();
  SELECT published_welcome_message INTO v_text FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('21_desfazer_restaura_anterior',
    format('r=%s welcome=%s(esperado ZZFX Bem-vinda!)', r, v_text), r = 'ok' AND v_text = 'ZZFX Bem-vinda!');

  -- ===== 22: desfazer de novo é um "refazer" (swap) — volta pra segunda versão =====
  r := public.portal_desfazer_publicacao();
  SELECT published_welcome_message INTO v_text FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('22_desfazer_de_novo_e_redo',
    format('r=%s welcome=%s(esperado segunda versão)', r, v_text), r = 'ok' AND v_text = 'ZZFX segunda versão publicada');

  -- ===== 23: descartar_rascunho volta o draft a bater com o published =====
  SELECT version INTO v_version_a FROM public.portal_configurations WHERE owner_id = v_owner_a;
  r := public.portal_salvar_rascunho(jsonb_build_object('welcome_message', 'ZZFX rascunho perdido de propósito'), v_version_a);
  r := public.portal_descartar_rascunho();
  SELECT draft_welcome_message, published_welcome_message INTO v_text, v_text2 FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('23_descartar_rascunho_restaura_publicado',
    format('r=%s draft=%s published=%s', r, v_text, v_text2), r = 'ok' AND v_text = v_text2);

  -- ===== 24: obter_publico com slug inexistente devolve NULL =====
  v_cfg := public.portal_obter_publico('zzfx-slug-que-nao-existe');
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('24_obter_publico_slug_inexistente_null', format('resultado=%s', v_cfg), v_cfg IS NULL);

  -- ===== 25: obter_publico de empresa que nunca publicou nada devolve NULL =====
  v_cfg := public.portal_obter_publico('zzfx-portal-b'); -- B nunca chamou portal_publicar nesta suíte
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('25_obter_publico_nunca_publicado_null', format('resultado=%s', v_cfg), v_cfg IS NULL);

  -- ===== 26: obter_publico de empresa publicada devolve os dados certos e NUNCA owner_id =====
  v_cfg := public.portal_obter_publico('zzfx-portal-a');
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('26_obter_publico_devolve_dados_publicados',
    format('welcome=%s', v_cfg->>'welcome_message'), v_cfg->>'welcome_message' = 'ZZFX segunda versão publicada');
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('27_obter_publico_nunca_inclui_owner_id',
    format('tem_owner_id=%s', v_cfg ? 'owner_id'), NOT (v_cfg ? 'owner_id'));

  -- ===== 28: anon chamando as 4 funções de escrita — todas negadas =====
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.portal_salvar_rascunho('{}'::jsonb, 1);
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('28a_anon_salvar_rascunho_negado', 'PERMITIDO (BUG!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('28a_anon_salvar_rascunho_negado', 'erro:42501 (esperado)', true);
  END;
  BEGIN
    PERFORM public.portal_publicar(1);
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('28b_anon_publicar_negado', 'PERMITIDO (BUG!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('28b_anon_publicar_negado', 'erro:42501 (esperado)', true);
  END;
  BEGIN
    PERFORM public.portal_descartar_rascunho();
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('28c_anon_descartar_negado', 'PERMITIDO (BUG!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('28c_anon_descartar_negado', 'erro:42501 (esperado)', true);
  END;
  BEGIN
    PERFORM public.portal_desfazer_publicacao();
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('28d_anon_desfazer_negado', 'PERMITIDO (BUG!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('28d_anon_desfazer_negado', 'erro:42501 (esperado)', true);
  END;

  -- ===== 29: anon NÃO lê portal_configurations direto (REVOKE ALL) =====
  BEGIN
    PERFORM count(*) FROM public.portal_configurations;
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('29_anon_nao_le_tabela_direto', 'PERMITIDO (BUG!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('29_anon_nao_le_tabela_direto', 'erro:42501 (esperado)', true);
  END;

  -- ===== 30: anon EXECUTA portal_obter_publico normalmente (é a função pública) =====
  v_cfg := public.portal_obter_publico('zzfx-portal-a');
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('30_anon_obter_publico_permitido',
    format('welcome=%s', v_cfg->>'welcome_message'), v_cfg->>'welcome_message' = 'ZZFX segunda versão publicada');

  RESET ROLE;

  -- ===== 31: permissões das funções batem com o esperado (GRANT/REVOKE da migração) =====
  DECLARE
    v_anon_salvar boolean; v_anon_publicar boolean; v_anon_obter boolean;
    v_auth_salvar boolean; v_auth_obter boolean;
  BEGIN
    v_anon_salvar := has_function_privilege('anon', 'public.portal_salvar_rascunho(jsonb,integer)', 'EXECUTE');
    v_anon_publicar := has_function_privilege('anon', 'public.portal_publicar(integer)', 'EXECUTE');
    v_anon_obter := has_function_privilege('anon', 'public.portal_obter_publico(text)', 'EXECUTE');
    v_auth_salvar := has_function_privilege('authenticated', 'public.portal_salvar_rascunho(jsonb,integer)', 'EXECUTE');
    v_auth_obter := has_function_privilege('authenticated', 'public.portal_obter_publico(text)', 'EXECUTE');
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('31_grants_das_funcoes_batem',
      format('anon_salvar=%s(esperado false) anon_publicar=%s(esperado false) anon_obter=%s(esperado true) auth_salvar=%s(esperado true) auth_obter=%s(esperado true)',
        v_anon_salvar, v_anon_publicar, v_anon_obter, v_auth_salvar, v_auth_obter),
      NOT v_anon_salvar AND NOT v_anon_publicar AND v_anon_obter AND v_auth_salvar AND v_auth_obter);
  END;

  -- ===== 32: bucket portal-media não aceita SVG (confirma a configuração; a
  -- rejeição em si acontece na API de Storage, não é testável por SQL puro) =====
  DECLARE v_allowed text[];
  BEGIN
    SELECT allowed_mime_types INTO v_allowed FROM storage.buckets WHERE id = 'portal-media';
    INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('32_bucket_nao_permite_svg_nem_gif',
      format('allowed=%s', v_allowed),
      NOT ('image/svg+xml' = ANY(v_allowed)) AND NOT ('image/gif' = ANY(v_allowed)) AND array_length(v_allowed, 1) = 3);
  END;

  -- ===== 33: marcador de outra tabela (fora do escopo desta migração) segue intacto =====
  SELECT category INTO v_category_mark FROM public.company_profiles WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_results (caso, detalhe, passou) VALUES ('33_dado_de_outra_tabela_intacto',
    format('category=%s', v_category_mark), v_category_mark = 'ZZFX_MARCADOR_INTACTO');
END $run$;

SELECT caso, detalhe, passou FROM zzfx_results ORDER BY ordem;

DO $final_check$
DECLARE v_falhas int;
BEGIN
  SELECT count(*) INTO v_falhas FROM zzfx_results WHERE passou IS NOT TRUE;
  IF v_falhas > 0 THEN
    RAISE EXCEPTION 'SUÍTE FALHOU: % caso(s) não passou(aram) — ver SELECT acima', v_falhas;
  END IF;
END $final_check$;

ROLLBACK;
