-- FASE K2a — suíte da migração 20261111173000_portal_k2_public_service_media.sql.
--
-- NÃO EXECUTADA contra produção (banco tratado como SOMENTE LEITURA nesta
-- fase — nenhuma escrita, nem dentro de transação com ROLLBACK). Preparada
-- com o maior cuidado possível pra rodar quando houver onde rodar com
-- segurança, ou no momento da aplicação real autorizada.
--
-- Revisão pedida pela dona em relação à versão anterior desta suíte:
--   (a) o caminho de foto do fixture agora usa o portal_media_key REAL da
--       empresa de teste (company_profiles.portal_media_key, capturado via
--       RETURNING), nunca owner_id — owner_id tem formato de UUID como
--       qualquer outro, então a CHECK portal_media_path_valid (que só
--       valida FORMATO, não dono) não pegaria essa troca; ainda assim, usar
--       owner_id no lugar do portal_media_key é dado de teste ERRADO (não
--       representa um caminho real que o sistema algum dia produziria) e
--       poderia mascarar uma regressão futura se uma checagem de posse
--       vier a existir pra `services`/`portal_service_categories`;
--   (b) casos novos: anon NÃO consegue ler direto `services`/
--       `portal_service_categories` (comportamento real confirmado em
--       leitura, ver abaixo — os dois são DIFERENTES um do outro); anon lê
--       as duas views públicas (já existia); authenticated de outra
--       empresa só enxerga o que as views expõem (novo: mesma leitura
--       direta é bloqueada por RLS, mas via view aparece, porque as views
--       não têm security_invoker e não filtram por empresa — mesmo padrão
--       já documentado na migração);
--   (c) ciclo completo aplicar→verificar→rollback→verificar→reaplicar,
--       dentro da mesma transação que nunca é commitada;
--   (d) a suíte só pode falhar por causa da migração, nunca por dado de
--       teste — todo valor fixo foi conferido contra o banco antes de
--       escrever o caso (ver comentários específicos abaixo).
--
-- Comportamento real de "anon lendo a tabela base direto", confirmado em
-- leitura nesta sessão (information_schema.role_table_grants + pg_policies):
--   - `services`: anon TEM GRANT de SELECT na tabela (grant amplo pré-
--     existente, nada a ver com esta migração) — mas RLS está ligada e as
--     duas policies (`services_own_all`, `services_staff_select`) só se
--     aplicam ao role `authenticated`; sem nenhuma policy pra `anon`, o
--     resultado é ZERO LINHAS (RLS filtra tudo), NÃO um erro de permissão.
--   - `portal_service_categories`: anon NÃO tem GRANT nenhum na tabela —
--     o resultado é erro `insufficient_privilege` (42501).
-- A suíte abaixo afirma CADA um desses dois comportamentos como são de
-- verdade, não um comportamento uniforme assumido sem checar.
--
-- IMPORTANTE sobre BEGIN/COMMIT: o arquivo real do rollback
-- (20261111173000_portal_k2_public_service_media_rollback.sql) tem seu
-- próprio BEGIN/COMMIT (pedido explicitamente, por envolver DROP+CREATE de
-- view). Aqui dentro da suíte, o DDL do rollback é colado SEM esse
-- BEGIN/COMMIT (só os comandos internos) — a suíte inteira já roda dentro
-- de UMA transação própria que termina em ROLLBACK; colar um COMMIT no meio
-- commitaria tudo de verdade, destruindo a garantia de "nunca escreve em
-- produção". Mesma observação de PL/pgSQL não aceitar DDL dentro de um
-- bloco DO $$ (ver suíte do K2c) — por isso o DDL fica fora de qualquer DO.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TEMP TABLE zzfx_k2a_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_k2a_ids (chave text PRIMARY KEY, valor text) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_k2a_original_view (nome text PRIMARY KEY, def text, owner text, reloptions text) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_k2a_original_grants (nome text, grantee text, privilege text) ON COMMIT DROP;

-- ============================================================================
-- PASSO 1 — captura do estado ORIGINAL de public_services (lido agora).
-- ============================================================================
INSERT INTO zzfx_k2a_original_view
SELECT 'public_services', pg_get_viewdef('public.public_services'::regclass, true),
       pg_get_userbyid(c.relowner), array_to_string(c.reloptions, ',')
FROM pg_class c WHERE c.oid = 'public.public_services'::regclass;

INSERT INTO zzfx_k2a_original_grants
SELECT 'public_services', grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'public_services' AND grantee IN ('anon', 'authenticated');

-- ============================================================================
-- PASSO 2 — fixtures (empresas de teste, caminho de foto com o
-- portal_media_key REAL, capturado via RETURNING).
-- ============================================================================
DO $fixtures$
DECLARE
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_media_a uuid;
  v_cat_a uuid;
  v_svc_sem_foto_sem_cat uuid;
  v_svc_com_foto_com_cat uuid;
  v_svc_inativo uuid;
  v_svc_b uuid;
  v_image_path text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_a||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner_b||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb);

  INSERT INTO public.company_profiles (owner_id, slug, display_name)
  VALUES
    (v_owner_a, 'zzfx-k2a-empresa-a', 'ZZFX Empresa A'),
    (v_owner_b, 'zzfx-k2a-empresa-b', 'ZZFX Empresa B');

  -- portal_media_key é gerado automaticamente (default gen_random_uuid(),
  -- confirmado em information_schema.columns) — capturamos o valor REAL em
  -- vez de usar owner_id pra montar o caminho da foto.
  SELECT portal_media_key INTO v_media_a FROM public.company_profiles WHERE owner_id = v_owner_a;

  INSERT INTO public.portal_service_categories (owner_id, name, image_path, sort_order)
  VALUES (v_owner_a, 'ZZFX Categoria A', NULL, 0)
  RETURNING id INTO v_cat_a;

  INSERT INTO public.services (owner_id, name, description, price, duration_min, active)
  VALUES (v_owner_a, 'ZZFX Serviço sem foto sem categoria', 'Descrição A', 100, 30, true)
  RETURNING id INTO v_svc_sem_foto_sem_cat;

  v_image_path := v_media_a || '/services/' || gen_random_uuid() || '.jpg';
  INSERT INTO public.services (owner_id, name, description, price, duration_min, active, category_id, image_path)
  VALUES (
    v_owner_a, 'ZZFX Serviço com foto & categoria', 'Descrição <b>especial</b> & "aspas"', 250.50, 90, true,
    v_cat_a, v_image_path
  )
  RETURNING id INTO v_svc_com_foto_com_cat;

  INSERT INTO public.services (owner_id, name, price, duration_min, active)
  VALUES (v_owner_a, 'ZZFX Serviço inativo', 50, 15, false)
  RETURNING id INTO v_svc_inativo;

  INSERT INTO public.services (owner_id, name, price, duration_min, active)
  VALUES (v_owner_b, 'ZZFX Serviço da empresa B', 70, 20, true)
  RETURNING id INTO v_svc_b;

  INSERT INTO zzfx_k2a_ids (chave, valor) VALUES
    ('owner_a', v_owner_a::text), ('owner_b', v_owner_b::text),
    ('media_a', v_media_a::text), ('cat_a', v_cat_a::text),
    ('svc_sem_foto_sem_cat', v_svc_sem_foto_sem_cat::text),
    ('svc_com_foto_com_cat', v_svc_com_foto_com_cat::text),
    ('svc_inativo', v_svc_inativo::text), ('svc_b', v_svc_b::text),
    ('image_path', v_image_path);

  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('00_fixtures_criadas_com_portal_media_key_real', format('media_a=%s image_path=%s', v_media_a, v_image_path), true);
END $fixtures$;

-- ============================================================================
-- PASSO 3 — APLICAR a migração (DDL colado, igual ao arquivo real).
-- ============================================================================
CREATE OR REPLACE VIEW public.public_services AS
SELECT id, owner_id, name, description, price, duration_min, color, image_path, category_id
FROM public.services
WHERE active = true;

GRANT SELECT ON public.public_services TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_services FROM anon, authenticated;

CREATE OR REPLACE VIEW public.public_portal_categories AS
SELECT id, owner_id, name, image_path, sort_order
FROM public.portal_service_categories;

GRANT SELECT ON public.public_portal_categories TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_portal_categories FROM anon, authenticated;

-- ============================================================================
-- PASSO 4 — VERIFICAR pós-aplicação (casos funcionais + novos de permissão).
-- ============================================================================
DO $run_pos_aplicacao$
DECLARE
  v_owner_a uuid;
  v_owner_b uuid;
  v_cat_a uuid;
  v_svc_sem_foto_sem_cat uuid;
  v_svc_com_foto_com_cat uuid;
  v_svc_inativo uuid;
  v_svc_b uuid;
  v_image_path text;
  v_row record;
  v_count int;
  v_cols_ok boolean;
  v_description text;
BEGIN
  SELECT valor::uuid INTO v_owner_a FROM zzfx_k2a_ids WHERE chave = 'owner_a';
  SELECT valor::uuid INTO v_owner_b FROM zzfx_k2a_ids WHERE chave = 'owner_b';
  SELECT valor::uuid INTO v_cat_a FROM zzfx_k2a_ids WHERE chave = 'cat_a';
  SELECT valor::uuid INTO v_svc_sem_foto_sem_cat FROM zzfx_k2a_ids WHERE chave = 'svc_sem_foto_sem_cat';
  SELECT valor::uuid INTO v_svc_com_foto_com_cat FROM zzfx_k2a_ids WHERE chave = 'svc_com_foto_com_cat';
  SELECT valor::uuid INTO v_svc_inativo FROM zzfx_k2a_ids WHERE chave = 'svc_inativo';
  SELECT valor::uuid INTO v_svc_b FROM zzfx_k2a_ids WHERE chave = 'svc_b';
  SELECT valor INTO v_image_path FROM zzfx_k2a_ids WHERE chave = 'image_path';

  -- ===== 1: colunas antigas inalteradas, na mesma ordem (1ª-7ª posição) =====
  SELECT array_agg(column_name ORDER BY ordinal_position) = ARRAY['id','owner_id','name','description','price','duration_min','color']
  INTO v_cols_ok FROM (
    SELECT column_name, ordinal_position FROM information_schema.columns
    WHERE table_schema='public' AND table_name='public_services' AND ordinal_position <= 7
  ) s;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('01_colunas_antigas_inalteradas_na_mesma_ordem', format('ok=%s', v_cols_ok), v_cols_ok);

  -- ===== 2: colunas novas aparecem corretas pro serviço com foto/categoria =====
  SELECT * INTO v_row FROM public.public_services WHERE id = v_svc_com_foto_com_cat;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('02_colunas_novas_corretas', format('image_path=%s category_id=%s', v_row.image_path, v_row.category_id),
     v_row.image_path = v_image_path AND v_row.category_id = v_cat_a);

  -- ===== 3: serviço sem foto/sem categoria -> NULL sem quebrar =====
  SELECT * INTO v_row FROM public.public_services WHERE id = v_svc_sem_foto_sem_cat;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('03_sem_foto_sem_categoria_null_sem_quebrar', format('image_path=%s category_id=%s', v_row.image_path, v_row.category_id),
     v_row.image_path IS NULL AND v_row.category_id IS NULL);

  -- ===== 4: só serviços ativos aparecem (inativo não aparece) =====
  SELECT count(*) INTO v_count FROM public.public_services WHERE id = v_svc_inativo;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('04_servico_inativo_nao_aparece', format('linhas=%s', v_count), v_count = 0);

  -- ===== 5: anon lê a view public_services (com colunas novas) =====
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.public_services WHERE id = v_svc_com_foto_com_cat;
  RESET ROLE;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('05_anon_le_public_services_com_colunas_novas', format('linhas=%s', v_count), v_count = 1);

  -- ===== 6: anon NÃO lê campos privados (coluna não existe na view) =====
  PERFORM 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='public_services'
    AND column_name IN ('active','created_at','updated_at');
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('06_anon_nao_le_campos_privados_de_services', 'nenhuma coluna privada na view', NOT FOUND);

  -- ===== 7: anon sem escrita na view (REVOKE continua valendo) =====
  BEGIN
    SET LOCAL ROLE anon;
    UPDATE public.public_services SET name = 'hackeado' WHERE id = v_svc_com_foto_com_cat;
    RESET ROLE;
    INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
      ('07_anon_sem_escrita_em_public_services', 'UPDATE PERMITIDO (deveria ter sido negado!)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
      ('07_anon_sem_escrita_em_public_services', 'erro:insufficient_privilege (esperado)', true);
  END;

  -- ===== 8: empresa A não vê dados da B via consulta típica do app
  -- (filtro .eq(owner_id) sobre a view — a view em si não filtra, mesmo
  -- padrão já documentado) =====
  SELECT count(*) INTO v_count FROM public.public_services WHERE owner_id = v_owner_a AND id = v_svc_b;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('08_filtro_por_owner_id_isola_empresa_a_de_b_via_app', format('linhas=%s', v_count), v_count = 0);

  -- ===== 9: public_portal_categories — colunas corretas, ordem e nome =====
  SELECT * INTO v_row FROM public.public_portal_categories WHERE id = v_cat_a;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('09_public_portal_categories_colunas_corretas', format('name=%s sort_order=%s', v_row.name, v_row.sort_order),
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

  -- ===== 13 (novo): anon NÃO lê services DIRETO — aqui o resultado real é
  -- ZERO LINHAS (não erro), porque anon TEM grant de SELECT na tabela mas
  -- RLS só tem policy pra authenticated (confirmado em leitura antes de
  -- escrever este caso: information_schema.role_table_grants + pg_policies) =====
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.services WHERE id = v_svc_com_foto_com_cat;
  RESET ROLE;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('13_anon_select_direto_em_services_zero_linhas_por_rls', format('linhas=%s (esperado 0, RLS sem policy pra anon)', v_count), v_count = 0);

  -- ===== 14 (novo): anon NÃO lê portal_service_categories DIRETO — aqui o
  -- resultado real é ERRO insufficient_privilege, porque anon NÃO tem
  -- nenhum GRANT na tabela (diferente de services) =====
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.portal_service_categories WHERE id = v_cat_a;
    RESET ROLE;
    INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
      ('14_anon_select_direto_em_portal_service_categories_bloqueado', 'SELECT retornou (sem erro — esperava insufficient_privilege)', false);
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
      ('14_anon_select_direto_em_portal_service_categories_bloqueado', 'erro:insufficient_privilege (esperado)', true);
  END;

  -- ===== 15 (novo): authenticated de OUTRA empresa (dona B) não lê o
  -- serviço da empresa A direto na tabela (RLS: owner_id = auth.uid()) =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.services WHERE id = v_svc_com_foto_com_cat;
  RESET ROLE;
  RESET request.jwt.claim.sub;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('15_authenticated_outra_empresa_nao_le_services_direto', format('linhas=%s (esperado 0, RLS isola por owner_id)', v_count), v_count = 0);

  -- ===== 16 (novo): o MESMO authenticated de outra empresa (dona B) EXERGA
  -- o serviço da empresa A através da view pública (as views não têm
  -- security_invoker nem filtram por empresa — "só enxerga o que a view
  -- expõe" é exatamente essa diferença entre tabela e view) =====
  PERFORM set_config('request.jwt.claim.sub', v_owner_b::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.public_services WHERE id = v_svc_com_foto_com_cat;
  RESET ROLE;
  RESET request.jwt.claim.sub;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('16_authenticated_outra_empresa_le_via_view_publica', format('linhas=%s (esperado 1, a view expõe sem filtrar por empresa)', v_count), v_count = 1);
END $run_pos_aplicacao$;

-- ============================================================================
-- PASSO 5 — DESFAZER (rollback, DDL colado, SEM o BEGIN/COMMIT do arquivo
-- real — ver nota no topo deste arquivo).
-- ============================================================================
DROP VIEW IF EXISTS public.public_services;

CREATE VIEW public.public_services AS
SELECT id, owner_id, name, description, price, duration_min, color
FROM public.services
WHERE active = true;

ALTER VIEW public.public_services OWNER TO postgres;

GRANT SELECT ON public.public_services TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_services FROM anon, authenticated;

DROP VIEW IF EXISTS public.public_portal_categories;

-- ============================================================================
-- PASSO 6 — VERIFICAR pós-rollback: public_portal_categories sumiu,
-- public_services voltou às 7 colunas originais (mesma ordem/tipos), e
-- view-def/owner/reloptions/GRANTs batem com o capturado no Passo 1.
-- ============================================================================
DO $run_pos_rollback$
DECLARE
  v_svc_sem_foto_sem_cat uuid;
  v_n int;
  v_def_atual text;
  v_def_original text;
  v_owner_atual text;
  v_owner_original text;
  v_reloptions_atual text;
  v_reloptions_original text;
  v_divergentes int;
BEGIN
  SELECT valor::uuid INTO v_svc_sem_foto_sem_cat FROM zzfx_k2a_ids WHERE chave = 'svc_sem_foto_sem_cat';

  -- ===== 17: public_portal_categories não existe mais =====
  SELECT count(*) INTO v_n FROM information_schema.views
  WHERE table_schema = 'public' AND table_name = 'public_portal_categories';
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('17_public_portal_categories_removida_apos_rollback', format('%s view(s) ainda presente(s) (esperado 0)', v_n), v_n = 0);

  -- ===== 18: public_services voltou às 7 colunas originais, mesma ordem/tipos =====
  SELECT count(*) INTO v_n FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'public_services';
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('18_public_services_so_com_as_7_colunas_originais', format('%s coluna(s) (esperado 7)', v_n), v_n = 7);

  PERFORM 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'public_services'
    AND column_name IN ('image_path', 'category_id');
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('19_public_services_sem_image_path_category_id_apos_rollback', 'nenhuma das 2 colunas novas presente', NOT FOUND);

  -- ===== 20: definição da view idêntica à capturada no Passo 1 =====
  SELECT def, owner, reloptions INTO v_def_original, v_owner_original, v_reloptions_original
  FROM zzfx_k2a_original_view WHERE nome = 'public_services';
  SELECT pg_get_viewdef('public.public_services'::regclass, true), pg_get_userbyid(c.relowner), array_to_string(c.reloptions, ',')
  INTO v_def_atual, v_owner_atual, v_reloptions_atual
  FROM pg_class c WHERE c.oid = 'public.public_services'::regclass;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('20_viewdef_identica_ao_original_pos_rollback',
     format('igual=%s', v_def_atual = v_def_original), v_def_atual = v_def_original);
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('21_owner_igual_ao_original_pos_rollback',
     format('atual=%s original=%s', v_owner_atual, v_owner_original), v_owner_atual = v_owner_original);
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('22_reloptions_igual_ao_original_pos_rollback (ambos NULL/vazio, nenhuma security_invoker/security_barrier)',
     format('atual=%s original=%s', v_reloptions_atual, v_reloptions_original),
     coalesce(v_reloptions_atual, '') = coalesce(v_reloptions_original, ''));

  -- ===== 23: GRANTs idênticos ao capturado no Passo 1 — EXCEPT bidirecional
  -- (cada metade pega o que sobrou de um lado que não está no outro; soma
  -- das duas precisa ser 0 pra bater exatamente, não importa qual lado
  -- divergiu) =====
  SELECT coalesce(sum(x), 0) INTO v_divergentes FROM (
    SELECT count(*) AS x FROM (
      SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'public_services' AND grantee IN ('anon', 'authenticated')
      EXCEPT
      SELECT grantee, privilege FROM zzfx_k2a_original_grants WHERE nome = 'public_services'
    ) d1
    UNION ALL
    SELECT count(*) FROM (
      SELECT grantee, privilege FROM zzfx_k2a_original_grants WHERE nome = 'public_services'
      EXCEPT
      SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'public_services' AND grantee IN ('anon', 'authenticated')
    ) d2
  ) diffs;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('24_grants_identicos_ao_original_pos_rollback',
     format('%s diferença(s) (esperado 0)', v_divergentes), v_divergentes = 0);

  -- ===== 25: dado antigo (serviço sem foto/categoria, já existia antes da
  -- migração) continua acessível e correto via a view revertida =====
  PERFORM 1 FROM public.public_services WHERE id = v_svc_sem_foto_sem_cat AND name = 'ZZFX Serviço sem foto sem categoria';
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('25_dado_antigo_continua_visivel_via_view_revertida', 'encontrado', FOUND);
END $run_pos_rollback$;

-- ============================================================================
-- PASSO 7 — REAPLICAR a migração (DDL colado de novo, idêntico ao Passo 3).
-- ============================================================================
CREATE OR REPLACE VIEW public.public_services AS
SELECT id, owner_id, name, description, price, duration_min, color, image_path, category_id
FROM public.services
WHERE active = true;

GRANT SELECT ON public.public_services TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_services FROM anon, authenticated;

CREATE OR REPLACE VIEW public.public_portal_categories AS
SELECT id, owner_id, name, image_path, sort_order
FROM public.portal_service_categories;

GRANT SELECT ON public.public_portal_categories TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_portal_categories FROM anon, authenticated;

-- ============================================================================
-- PASSO 8 — VERIFICAR pós-reaplicação (breve): as colunas novas voltam, e o
-- dado antigo continua intacto depois do ciclo inteiro.
-- ============================================================================
DO $run_pos_reaplicacao$
DECLARE
  v_svc_com_foto_com_cat uuid;
  v_cat_a uuid;
  v_image_path text;
  v_row record;
BEGIN
  SELECT valor::uuid INTO v_svc_com_foto_com_cat FROM zzfx_k2a_ids WHERE chave = 'svc_com_foto_com_cat';
  SELECT valor::uuid INTO v_cat_a FROM zzfx_k2a_ids WHERE chave = 'cat_a';
  SELECT valor INTO v_image_path FROM zzfx_k2a_ids WHERE chave = 'image_path';

  SELECT * INTO v_row FROM public.public_services WHERE id = v_svc_com_foto_com_cat;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('26_colunas_novas_voltam_apos_reaplicar',
     format('image_path=%s category_id=%s', v_row.image_path, v_row.category_id),
     v_row.image_path = v_image_path AND v_row.category_id = v_cat_a);

  PERFORM 1 FROM public.public_portal_categories WHERE id = v_cat_a;
  INSERT INTO zzfx_k2a_results (caso, detalhe, passou) VALUES
    ('27_public_portal_categories_existe_de_novo_apos_reaplicar', 'encontrada', FOUND);
END $run_pos_reaplicacao$;

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
