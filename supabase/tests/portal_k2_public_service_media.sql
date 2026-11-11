-- FASE K2a — suíte da migração 20261111173000_portal_k2_public_service_media.sql.
-- NÃO EXECUTADA contra produção nesta sessão (sem ambiente/branch de teste
-- seguro disponível e a instrução desta fase pede banco SOMENTE LEITURA —
-- nem em transação com ROLLBACK). Preparada pra rodar quando houver onde
-- rodar com segurança, ou no momento da aplicação real.
--
-- Mesmo padrão de supabase/tests/team_members_avatar_url_check_k1a2.sql:
-- uma transação, NUNCA COMMIT, dados sintéticos zz-fixture-/zzfx-.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TEMP TABLE zzfx_k2a_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;

DO $run$
DECLARE
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_cat_a uuid;
  v_svc_sem_foto_sem_cat uuid;
  v_svc_com_foto_com_cat uuid;
  v_svc_inativo uuid;
  v_svc_b uuid;
  v_row record;
  v_count int;
  v_cols_ok boolean;
  v_description text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_a||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_b||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb);

  INSERT INTO public.company_profiles (owner_id, slug, display_name)
  VALUES
    (v_owner_a, 'zzfx-k2a-empresa-a', 'ZZFX Empresa A'),
    (v_owner_b, 'zzfx-k2a-empresa-b', 'ZZFX Empresa B');

  INSERT INTO public.portal_service_categories (owner_id, name, image_path, sort_order)
  VALUES (v_owner_a, 'ZZFX Categoria A', NULL, 0)
  RETURNING id INTO v_cat_a;

  INSERT INTO public.services (owner_id, name, description, price, duration_min, active)
  VALUES (v_owner_a, 'ZZFX Serviço sem foto sem categoria', 'Descrição A', 100, 30, true)
  RETURNING id INTO v_svc_sem_foto_sem_cat;

  INSERT INTO public.services (owner_id, name, description, price, duration_min, active, category_id, image_path)
  VALUES (
    v_owner_a, 'ZZFX Serviço com foto & categoria', 'Descrição <b>especial</b> & "aspas"', 250.50, 90, true,
    v_cat_a, v_owner_a || '/services/' || gen_random_uuid() || '.jpg'
  )
  RETURNING id INTO v_svc_com_foto_com_cat;

  INSERT INTO public.services (owner_id, name, price, duration_min, active)
  VALUES (v_owner_a, 'ZZFX Serviço inativo', 50, 15, false)
  RETURNING id INTO v_svc_inativo;

  INSERT INTO public.services (owner_id, name, price, duration_min, active)
  VALUES (v_owner_b, 'ZZFX Serviço da empresa B', 70, 20, true)
  RETURNING id INTO v_svc_b;

  -- ===== 1: colunas antigas inalteradas, na mesma ordem (1ª-7ª posição) =====
  SELECT array_agg(column_name ORDER BY ordinal_position) = ARRAY['id','owner_id','name','description','price','duration_min','color']
  INTO v_cols_ok FROM (
    SELECT column_name, ordinal_position FROM information_schema.columns
    WHERE table_schema='public' AND table_name='public_services' AND ordinal_position <= 7
  ) s;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('1_colunas_antigas_inalteradas_na_mesma_ordem', format('ok=%s', v_cols_ok), v_cols_ok);

  -- ===== 2: colunas novas aparecem corretas pro serviço com foto/categoria =====
  SELECT * INTO v_row FROM public.public_services WHERE id = v_svc_com_foto_com_cat;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('2_colunas_novas_corretas', format('image_path=%s category_id=%s', v_row.image_path, v_row.category_id),
     v_row.image_path IS NOT NULL AND v_row.category_id = v_cat_a);

  -- ===== 3: serviço sem foto/sem categoria -> NULL sem quebrar =====
  SELECT * INTO v_row FROM public.public_services WHERE id = v_svc_sem_foto_sem_cat;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('3_sem_foto_sem_categoria_null_sem_quebrar', format('image_path=%s category_id=%s', v_row.image_path, v_row.category_id),
     v_row.image_path IS NULL AND v_row.category_id IS NULL);

  -- ===== 4: só serviços ativos aparecem (inativo não aparece) =====
  SELECT count(*) INTO v_count FROM public.public_services WHERE id = v_svc_inativo;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('4_servico_inativo_nao_aparece', format('linhas=%s', v_count), v_count = 0);

  -- ===== 5: anon lê a view (SET ROLE) e não quebra =====
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.public_services WHERE id = v_svc_com_foto_com_cat;
  RESET ROLE;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('5_anon_le_public_services_com_colunas_novas', format('linhas=%s', v_count), v_count = 1);

  -- ===== 6: anon NÃO lê campos privados (coluna não existe na view) =====
  PERFORM 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='public_services'
    AND column_name IN ('active','created_at','updated_at');
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('6_anon_nao_le_campos_privados_de_services', 'nenhuma coluna privada na view', NOT FOUND);

  -- ===== 7: anon sem escrita na view (REVOKE continua valendo) =====
  BEGIN
    SET LOCAL ROLE anon;
    UPDATE public.public_services SET name = 'hackeado' WHERE id = v_svc_com_foto_com_cat;
    RESET ROLE;
    INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
      ('7_anon_sem_escrita_em_public_services', 'UPDATE PERMITIDO (deveria ter sido negado!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
      ('7_anon_sem_escrita_em_public_services', 'erro:insufficient_privilege (esperado)', true);
  END;

  -- ===== 8: empresa A não vê dados da B (app sempre filtra por owner_id —
  -- a view não filtra, igual ao padrão já existente; o teste é da consulta
  -- típica do app, não da view isolada) =====
  SELECT count(*) INTO v_count FROM public.public_services WHERE owner_id = v_owner_a AND id = v_svc_b;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('8_filtro_por_owner_id_isola_empresa_a_de_b', format('linhas=%s', v_count), v_count = 0);

  -- ===== 9: public_portal_categories — colunas corretas, ordem e nome =====
  SELECT * INTO v_row FROM public.public_portal_categories WHERE id = v_cat_a;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('9_public_portal_categories_colunas_corretas', format('name=%s sort_order=%s', v_row.name, v_row.sort_order),
     v_row.name = 'ZZFX Categoria A' AND v_row.sort_order = 0 AND v_row.owner_id = v_owner_a);

  -- ===== 10: anon lê public_portal_categories =====
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.public_portal_categories WHERE id = v_cat_a;
  RESET ROLE;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('10_anon_le_public_portal_categories', format('linhas=%s', v_count), v_count = 1);

  -- ===== 11: anon sem escrita em public_portal_categories =====
  BEGIN
    SET LOCAL ROLE anon;
    DELETE FROM public.public_portal_categories WHERE id = v_cat_a;
    RESET ROLE;
    INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
      ('11_anon_sem_escrita_em_public_portal_categories', 'DELETE PERMITIDO (deveria ter sido negado!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
      ('11_anon_sem_escrita_em_public_portal_categories', 'erro:insufficient_privilege (esperado)', true);
  END;

  -- ===== 12: descrição com texto longo/caracteres especiais sobrevive sem quebrar =====
  SELECT description INTO v_description FROM public.public_services WHERE id = v_svc_com_foto_com_cat;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('12_descricao_com_html_e_aspas_preservada', format('description=%s', v_description),
     v_description = 'Descrição <b>especial</b> & "aspas"');
END $run$;

SELECT caso, detalhe, passou FROM zzfx_k2a_results ORDER BY ordem;

DO $final_check$
DECLARE v_falhas int;
BEGIN
  SELECT count(*) INTO v_falhas FROM zzfx_k2a_results WHERE passou IS NOT TRUE;
  IF v_falhas > 0 THEN
    RAISE EXCEPTION 'SUÍTE FALHOU: % caso(s) não passou(aram) — ver SELECT acima', v_falhas;
  END IF;
END $final_check$;

ROLLBACK;
