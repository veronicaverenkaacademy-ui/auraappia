-- FASE K2c — suíte da migração 20261111191342_portal_k2c_logo_wide.sql.
-- NÃO EXECUTADA contra produção nesta sessão (banco só leitura nesta fase,
-- sem ambiente/branch de teste seguro disponível — mesmo motivo do K2a).
-- Preparada pra rodar quando houver onde rodar com segurança, ou no
-- momento da aplicação real.
--
-- Mesmo padrão de supabase/tests/team_members_avatar_url_check_k1a2.sql e
-- portal_k2_public_service_media.sql: uma transação, NUNCA COMMIT, dados
-- sintéticos zz-fixture-/zzfx-. auth.uid() é simulado via
-- set_config('request.jwt.claim.sub', ..., true) — é como auth.uid() lê o
-- usuário autenticado de verdade (confirmado lendo auth.uid() no banco).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TEMP TABLE zzfx_k2c_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;

DO $run$
DECLARE
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_media_a uuid := gen_random_uuid();
  v_media_b uuid := gen_random_uuid();
  v_path_logo_wide_a text;
  v_path_logo_a text;
  v_result text;
  v_row public.portal_configurations;
  v_bool boolean;
  v_val text;
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

  INSERT INTO public.portal_configurations (owner_id) VALUES (v_owner_a), (v_owner_b);

  v_path_logo_wide_a := v_media_a || '/logo-wide/' || gen_random_uuid() || '.png';
  v_path_logo_a := v_media_a || '/logo/' || gen_random_uuid() || '.png';
  INSERT INTO storage.objects (bucket_id, name) VALUES ('portal-media', v_path_logo_wide_a), ('portal-media', v_path_logo_a);

  -- ===== 1: tipos de imagem ANTIGOS continuam válidos (nada regrediu) =====
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('1_tipos_antigos_continuam_validos', 'logo/logo-light/cover/banner/services/professionals/categories',
     public.portal_media_path_valid(v_media_a || '/logo/11111111-1111-1111-1111-111111111111.png')
     AND public.portal_media_path_valid(v_media_a || '/logo-light/11111111-1111-1111-1111-111111111111.png')
     AND public.portal_media_path_valid(v_media_a || '/cover/11111111-1111-1111-1111-111111111111.jpg')
     AND public.portal_media_path_valid(v_media_a || '/banner/11111111-1111-1111-1111-111111111111.webp')
     AND public.portal_media_path_valid(v_media_a || '/services/11111111-1111-1111-1111-111111111111.jpeg')
     AND public.portal_media_path_valid(v_media_a || '/professionals/11111111-1111-1111-1111-111111111111.png')
     AND public.portal_media_path_valid(v_media_a || '/categories/11111111-1111-1111-1111-111111111111.png'));

  -- ===== 2: "logo-wide" é um tipo válido novo =====
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('2_logo_wide_valido', v_path_logo_wide_a, public.portal_media_path_valid(v_path_logo_wide_a));

  -- ===== 3: caminhos inválidos continuam recusados (tipo inventado,
  -- extensão errada, UUID malformado) =====
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('3_caminho_invalido_recusado',
     'tipo inventado / extensão errada / uuid malformado',
     NOT public.portal_media_path_valid(v_media_a || '/logo-wide-fake/11111111-1111-1111-1111-111111111111.png')
     AND NOT public.portal_media_path_valid(v_media_a || '/logo-wide/11111111-1111-1111-1111-111111111111.gif')
     AND NOT public.portal_media_path_valid('nao-e-uuid/logo-wide/11111111-1111-1111-1111-111111111111.png'));

  -- ===== simula a dona A autenticada =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);

  -- ===== 4: salvar rascunho com logo_wide_path válido =====
  SELECT version INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_salvar_rascunho(
    jsonb_build_object('logo_wide_path', v_path_logo_wide_a), v_row.version
  ) INTO v_result;
  SELECT draft_logo_wide_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('4_salvar_rascunho_logo_wide_valido', format('resultado=%s draft_logo_wide_path=%s', v_result, v_val),
     v_result = 'ok' AND v_val = v_path_logo_wide_a);

  -- ===== 5: salvar rascunho com logo_wide_path de OUTRA empresa é recusado
  -- (portal_validate_owned_path — mesma checagem dos outros 4 campos) =====
  SELECT version INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_salvar_rascunho(
    jsonb_build_object('logo_wide_path', v_media_b || '/logo-wide/' || gen_random_uuid() || '.png'), v_row.version
  ) INTO v_result;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('5_logo_wide_de_outra_empresa_recusado', format('resultado=%s', v_result), v_result = 'caminho_invalido');

  -- ===== 6: salvar rascunho com logo_wide_path de arquivo que não existe
  -- no storage é recusado =====
  SELECT version INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_salvar_rascunho(
    jsonb_build_object('logo_wide_path', v_media_a || '/logo-wide/' || gen_random_uuid() || '.png'), v_row.version
  ) INTO v_result;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('6_logo_wide_arquivo_inexistente_recusado', format('resultado=%s', v_result), v_result = 'arquivo_inexistente');

  -- ===== 7: publicar com logo_wide_path preenchido =====
  SELECT version INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_publicar(v_row.version) INTO v_result;
  SELECT published_logo_wide_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('7_publicar_com_logo_wide', format('resultado=%s published_logo_wide_path=%s', v_result, v_val),
     v_result = 'ok' AND v_val = v_path_logo_wide_a);

  -- ===== 8: publicar de novo (agora com logo_wide_path DIFERENTE) grava a
  -- "foto" anterior em previous_published, incluindo logo_wide_path =====
  SELECT version INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_salvar_rascunho(
    jsonb_build_object('logo_wide_path', v_path_logo_a), v_row.version
  ) INTO v_result; -- reaproveita um path já existente no storage só pra variar o valor, não representa um logo-wide de verdade; é só pra confirmar a troca de valor
  SELECT version INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_a;
  SELECT public.portal_publicar(v_row.version) INTO v_result;
  SELECT previous_published ->> 'logo_wide_path' INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('8_previous_published_guarda_logo_wide_anterior', format('previous.logo_wide_path=%s', v_val),
     v_val = v_path_logo_wide_a);

  -- ===== 9: desfazer publicação restaura o logo_wide_path anterior =====
  SELECT public.portal_desfazer_publicacao() INTO v_result;
  SELECT published_logo_wide_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('9_desfazer_restaura_logo_wide_anterior', format('resultado=%s published_logo_wide_path=%s', v_result, v_val),
     v_result = 'ok' AND v_val = v_path_logo_wide_a);

  -- ===== 10: campo opcional — salvar/publicar SEM nunca tocar em
  -- logo_wide_path continua funcionando (empresa B, nunca usou o campo) =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_b::text, true);
  SELECT version INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_b;
  SELECT public.portal_salvar_rascunho(jsonb_build_object('welcome_message', 'Oi, sem logo largo'), v_row.version) INTO v_result;
  SELECT version INTO v_row FROM public.portal_configurations WHERE owner_id = v_owner_b;
  SELECT public.portal_publicar(v_row.version) INTO v_result;
  SELECT published_logo_wide_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_b;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('10_campo_opcional_salvar_publicar_sem_logo_wide_funciona',
     format('resultado=%s published_logo_wide_path=%s', v_result, v_val),
     v_result = 'ok' AND v_val IS NULL);

  -- ===== 11: empresa B não conseguiu tocar nos dados da empresa A (cada
  -- função só afeta owner_id = auth.uid(), e a tentativa do caso 5 usando a
  -- pasta da B foi recusada antes de gravar nada) =====
  SELECT published_logo_wide_path INTO v_val FROM public.portal_configurations WHERE owner_id = v_owner_a;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('11_empresa_b_nao_alterou_dados_da_a', format('A.published_logo_wide_path=%s (esperado=%s)', v_val, v_path_logo_wide_a),
     v_val = v_path_logo_wide_a);

  -- ===== 12: anon só lê pelo portal_obter_publico(), e o jsonb já inclui
  -- logo_wide_path =====
  RESET request.jwt.claim.sub;
  SET LOCAL ROLE anon;
  SELECT (public.portal_obter_publico('zzfx-k2c-empresa-a') ->> 'logo_wide_path') INTO v_val;
  INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
    ('12_anon_le_logo_wide_via_portal_obter_publico', format('logo_wide_path=%s', v_val), v_val = v_path_logo_wide_a);

  -- ===== 13: anon NÃO lê portal_configurations direto (RLS intacta —
  -- continua exigindo owner_id = auth.uid(), e anon não tem auth.uid()) =====
  BEGIN
    PERFORM 1 FROM public.portal_configurations WHERE owner_id = v_owner_a;
    INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
      ('13_anon_sem_select_direto_em_portal_configurations', 'SELECT retornou linha (RLS não bloqueou!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
      ('13_anon_sem_select_direto_em_portal_configurations', 'erro:insufficient_privilege (esperado)', true);
  END;
  RESET ROLE;

  -- ===== 14 (controle): CHECK de formato continua rejeitando um
  -- logo_wide_path inválido escrito direto (sem passar pela função) — se
  -- este caso "passar" sem erro, o CHECK não cobre mais o campo novo =====
  BEGIN
    UPDATE public.portal_configurations SET draft_logo_wide_path = 'nao-e-caminho-valido' WHERE owner_id = v_owner_a;
    INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
      ('14_controle_check_logo_wide_existe', 'PERMITIDO (CHECK não cobre logo_wide_path!)', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO zzfx_k2c_results (caso, detalhe, passou) VALUES
      ('14_controle_check_logo_wide_existe', 'erro:check_violation (esperado)', true);
  END;
END $run$;

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
