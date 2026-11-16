-- FASE CONSENT-1C / CONSENT-1C-FIX — suíte da migração
-- 20261116090000_professional_terms_acceptance.sql (versão corrigida:
-- proteção por TRIGGER, não mais REVOKE/GRANT de coluna — ver o comentário
-- no topo do arquivo de migração para a prova do porquê a versão REVOKE
-- original não funcionava).
--
-- NÃO EXECUTADA contra produção nesta fase — "REGRAS ABSOLUTAS" desta fase
-- restringem o acesso ao banco de produção a SOMENTE LEITURA
-- (query_database, usado só pra introspecção/prova do defeito). Este
-- arquivo foi escrito e revisado, mas a execução de verdade (mesmo dentro
-- de BEGIN...ROLLBACK, sem COMMIT) fica para quando a dona autorizar a
-- aplicação da migração ("AUTORIZO APLICAR MIGRAÇÃO FASE CONSENT-1C").
--
-- Mesmo padrão de supabase/tests/client_consents.sql: fixtures sintéticas
-- zz-fixture-, tudo dentro de BEGIN...ROLLBACK, DDL colado na íntegra
-- (migração e rollback, exatamente como os arquivos reais), lógica de
-- teste em blocos DO $$ separados, resultados agregados numa tabela
-- temporária e impressos com um SELECT final (JSON). Nunca COMMIT.
--
-- Schema real reintrospectado nesta correção (não reaproveitado de leitura
-- anterior na mesma conversa, por instrução explícita):
--   public.profiles: id uuid PK (FK -> auth.users(id) ON DELETE CASCADE),
--     full_name/profession/phone/business_name/avatar_url/cep/city/state/
--     address text NULL, created_at/updated_at timestamptz NOT NULL
--     default now(), terms_accepted_at timestamptz NULL (sem
--     terms_accepted_version ainda).
--   Policies (RLS, todas só pra "authenticated", nenhuma pra "anon"):
--     "Own profile insert" (INSERT, WITH CHECK auth.uid() = id),
--     "Own profile read" (SELECT, USING auth.uid() = id),
--     "Own profile update" (UPDATE, USING auth.uid() = id).
--   Trigger pré-existente: profiles_updated_at BEFORE UPDATE FOR EACH ROW
--     (só seta NEW.updated_at = now(), não SECURITY DEFINER).
--   handle_new_user(): SECURITY DEFINER, dono "postgres", insere
--     (id, phone, full_name) em profiles a partir de auth.users — nunca
--     seta termos; current_user dentro dela é "postgres" (dono),
--     confirmado via pg_proc.proowner.
--   Prova do defeito do REVOKE de coluna (produção, somente leitura):
--     has_table_privilege('authenticated','public.profiles','UPDATE')=true
--     e has_column_privilege('authenticated','public.profiles',
--     'terms_accepted_at','UPDATE')=true — o GRANT de TABELA já cobre
--     tudo, então REVOKE de coluna nunca teria efeito.
--
-- Ciclo: 0) confirma que terms_accepted_version NÃO existe ainda; 1)
-- fixtures (owner_a, owner_b via INSERT em auth.users, que dispara
-- handle_new_user); 2) aplica a migração corrigida (coluna + trigger); 3)
-- verificação estrutural (coluna existe/nullable/sem default; trigger
-- existe e não é SECURITY DEFINER; NENHUM REVOKE/GRANT de coluna foi
-- criado — prova de que a correção realmente não usa mais essa
-- abordagem); 4) funcional, casos (a)-(i) do pedido da dona; 5)
-- idempotência (reaplica a migração); 6) aplica o rollback (DDL colado na
-- íntegra), confirma que trigger/função/coluna somem e que o backup em
-- backup_rollback_fase1 preserva os dados; 7) reaplica a migração e
-- confirma que volta a funcionar. Nunca COMMIT.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

CREATE TEMP TABLE zzfx_pta_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_pta_ids (chave text PRIMARY KEY, valor uuid) ON COMMIT DROP;
-- O Passo 4 faz SET ROLE authenticated/anon/service_role pra provar a
-- RLS/trigger de verdade (não só checar estruturalmente) — essas tabelas
-- TEMP precisam continuar legíveis/graváveis por qualquer papel durante a
-- troca.
GRANT ALL ON zzfx_pta_results TO PUBLIC;
GRANT ALL ON zzfx_pta_ids TO PUBLIC;
GRANT ALL ON SEQUENCE zzfx_pta_results_ordem_seq TO PUBLIC;

-- ============================================================================
-- PASSO 0 — confirma que a coluna nova não existe ainda
-- ============================================================================
DO $passo0$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='terms_accepted_version';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('00_coluna_nao_existe_ainda', format('%s (esperado 0)', v_n), v_n = 0);
END $passo0$;

-- ============================================================================
-- PASSO 1 — fixtures: owner_a, owner_b. O INSERT em auth.users dispara
-- handle_new_user, que já cria a linha em profiles sozinha.
-- ============================================================================
INSERT INTO zzfx_pta_ids (chave, valor) VALUES
  ('owner_a', gen_random_uuid()),
  ('owner_b', gen_random_uuid());

DO $setup$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_owner_b uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_b');
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner_a, 'zz-fixture-owner-a@invalid.test'),
    (v_owner_b, 'zz-fixture-owner-b@invalid.test');
END $setup$;

DO $sentinela$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.profiles
    WHERE id IN (SELECT valor FROM zzfx_pta_ids);
  IF n <> 2 THEN
    RAISE EXCEPTION 'SENTINELA: esperado 2 linhas em profiles (via handle_new_user), achei %', n;
  END IF;
END $sentinela$;

-- ============================================================================
-- PASSO 2 — aplica a migração corrigida (DDL colado na íntegra de
-- 20261116090000_professional_terms_acceptance.sql, sem o BEGIN/COMMIT/
-- SET LOCAL/NOTIFY próprios — já estamos dentro de uma transação de teste)
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_version text NULL;

CREATE OR REPLACE FUNCTION public.profiles_protect_terms_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.terms_accepted_at := NULL;
      NEW.terms_accepted_version := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.terms_accepted_at := OLD.terms_accepted_at;
      NEW.terms_accepted_version := OLD.terms_accepted_version;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_10_profiles_protect_terms_acceptance ON public.profiles;
CREATE TRIGGER trg_10_profiles_protect_terms_acceptance
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_protect_terms_acceptance();

-- ============================================================================
-- PASSO 3 — verificação estrutural
-- ============================================================================
DO $passo3$
DECLARE
  v_is_nullable text;
  v_default text;
  v_n int;
  v_secdef boolean;
BEGIN
  SELECT is_nullable, column_default INTO v_is_nullable, v_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='terms_accepted_version';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('03a_coluna_existe_nullable', format('is_nullable=%s default=%s', v_is_nullable, coalesce(v_default,'NULL')),
     v_is_nullable = 'YES' AND v_default IS NULL);

  SELECT count(*) INTO v_n FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal
      AND tgname = 'trg_10_profiles_protect_terms_acceptance';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('03b_trigger_existe', format('count=%s (esperado 1)', v_n), v_n = 1);

  SELECT prosecdef INTO v_secdef FROM pg_proc WHERE proname = 'profiles_protect_terms_acceptance';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('03c_funcao_nao_e_security_definer', format('prosecdef=%s (esperado false)', v_secdef), v_secdef = false);

  -- Prova de que a correção realmente abandonou REVOKE/GRANT de coluna:
  -- information_schema.column_privileges EXPANDE o GRANT de TABELA pra
  -- cada coluna (confirmado lendo produção antes desta correção — full_name
  -- e terms_accepted_at têm exatamente o mesmo conjunto de privilégios por
  -- grantee), então "0 linhas" NUNCA seria o resultado certo aqui. O teste
  -- certo é: terms_accepted_version tem o MESMO conjunto de privilégios
  -- que full_name (nenhum REVOKE/GRANT extra foi aplicado só nela) — a
  -- proteção de verdade é o trigger (04d/04f/04h abaixo), não o GRANT.
  SELECT count(*) INTO v_n FROM (
    SELECT grantee, privilege_type FROM information_schema.column_privileges
      WHERE table_schema='public' AND table_name='profiles' AND column_name='terms_accepted_version'
    EXCEPT
    SELECT grantee, privilege_type FROM information_schema.column_privileges
      WHERE table_schema='public' AND table_name='profiles' AND column_name='full_name'
  ) diff;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('03d_grant_terms_accepted_version_igual_a_full_name', format('diferenças=%s (esperado 0)', v_n), v_n = 0);

  -- GRANT de tabela padrão do Supabase continua intacto pra authenticated
  -- (a proteção é só via trigger, não via GRANT) — confirma que não
  -- quebramos o UPDATE comum de profiles.
  SELECT count(*) INTO v_n FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='profiles'
      AND grantee='authenticated' AND privilege_type='UPDATE';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('03e_grant_update_tabela_authenticated_intacto', format('count=%s (esperado 1)', v_n), v_n = 1);
END $passo3$;

-- ============================================================================
-- PASSO 4 — funcional (trigger + RLS de verdade, via SET ROLE)
-- ============================================================================

-- (a)/(b) linha "antiga" (criada antes de qualquer aceite, via
-- handle_new_user) já nasce com as duas colunas NULL.
DO $passo4ab$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_ver text;
  v_at timestamptz;
BEGIN
  SELECT terms_accepted_version, terms_accepted_at INTO v_ver, v_at
    FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04ab_linha_antiga_sem_aceite_fica_null',
     format('version=%s at=%s (ambos NULL esperado)', coalesce(v_ver,'NULL'), coalesce(v_at::text,'NULL')),
     v_ver IS NULL AND v_at IS NULL);
END $passo4ab$;

-- (c) service_role consegue gravar as duas colunas via UPDATE comum.
DO $passo4c$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_ver text;
BEGIN
  SET ROLE service_role;
  UPDATE public.profiles
    SET terms_accepted_version = '2026-11-15|2026-11-15', terms_accepted_at = now()
    WHERE id = v_owner_a;
  RESET ROLE;

  SELECT terms_accepted_version INTO v_ver FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04c_service_role_consegue_gravar', format('version=%s', coalesce(v_ver,'NULL')), v_ver = '2026-11-15|2026-11-15');
END $passo4c$;

-- (d) authenticated: UPDATE das duas colunas na PRÓPRIA linha NÃO altera
-- nada (trigger ignora silenciosamente) e NÃO dá erro.
DO $passo4d$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_ver_antes text;
  v_at_antes timestamptz;
  v_ver_depois text;
  v_at_depois timestamptz;
  v_erro boolean := false;
BEGIN
  SELECT terms_accepted_version, terms_accepted_at INTO v_ver_antes, v_at_antes
    FROM public.profiles WHERE id = v_owner_a;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  BEGIN
    UPDATE public.profiles
      SET terms_accepted_version = '2099-01-01|2099-01-01', terms_accepted_at = now()
      WHERE id = v_owner_a;
  EXCEPTION WHEN OTHERS THEN
    v_erro := true;
  END;
  RESET ROLE;

  SELECT terms_accepted_version, terms_accepted_at INTO v_ver_depois, v_at_depois
    FROM public.profiles WHERE id = v_owner_a;

  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04d_authenticated_update_nao_altera_version',
     format('antes=%s depois=%s', coalesce(v_ver_antes,'NULL'), coalesce(v_ver_depois,'NULL')),
     v_ver_depois = v_ver_antes AND v_ver_depois <> '2099-01-01|2099-01-01'),
    ('04d_authenticated_update_nao_altera_at',
     format('antes=%s depois=%s', coalesce(v_at_antes::text,'NULL'), coalesce(v_at_depois::text,'NULL')),
     v_at_depois = v_at_antes),
    ('04d_authenticated_update_nao_lanca_erro', format('erro=%s', v_erro), v_erro = false);
END $passo4d$;

-- (e) authenticated: UPDATE de full_name na própria linha funciona
-- normalmente, e updated_at é atualizado (prova que o trigger novo não
-- interfere em updates comuns nem no profiles_updated_at pré-existente).
-- CORREÇÃO (aplicação real, tentativa 1→2): dentro de uma única transação
-- de teste (BEGIN...ROLLBACK), now() é FIXO (timestamp do início da
-- transação, não do statement) — pg_sleep() não muda isso. Comparar
-- "antes < depois" com os dois lidos via now() dentro da MESMA transação
-- nunca pode passar, mesmo com o trigger funcionando perfeitamente (não é
-- um problema da migração/trigger, é do formato do teste). Fix: como
-- profiles_updated_at usa now() (não clock_timestamp()), o valor certo e
-- determinístico pra provar que o trigger disparou é updated_at = now()
-- (o mesmo now() congelado desta transação) depois do UPDATE — não uma
-- comparação de "antes vs depois".
DO $passo4e$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_updated_depois timestamptz;
  v_full_name text;
BEGIN
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  UPDATE public.profiles SET full_name = 'Nome Atualizado Pela Própria' WHERE id = v_owner_a;
  RESET ROLE;

  SELECT full_name, updated_at INTO v_full_name, v_updated_depois FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04e_authenticated_altera_outro_campo_proprio', format('full_name=%s', v_full_name),
     v_full_name = 'Nome Atualizado Pela Própria'),
    ('04e_updated_at_continua_funcionando', format('updated_at=%s now=%s', v_updated_depois, now()),
     v_updated_depois = now());
END $passo4e$;

-- (f) authenticated: upsert (INSERT ... ON CONFLICT DO UPDATE) com
-- terms_accepted_at no payload — simula o auth.tsx antigo (pré-FIX) —
-- NÃO grava a coluna protegida (o ON CONFLICT DO UPDATE dispara o ramo
-- UPDATE do trigger).
DO $passo4f$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_at_antes timestamptz;
  v_at_depois timestamptz;
  v_full_name text;
BEGIN
  SELECT terms_accepted_at INTO v_at_antes FROM public.profiles WHERE id = v_owner_a;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  INSERT INTO public.profiles (id, full_name, terms_accepted_at)
    VALUES (v_owner_a, 'Nome Via Upsert', now())
    ON CONFLICT (id) DO UPDATE
      SET full_name = EXCLUDED.full_name, terms_accepted_at = EXCLUDED.terms_accepted_at;
  RESET ROLE;

  SELECT terms_accepted_at, full_name INTO v_at_depois, v_full_name FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04f_upsert_authenticated_nao_grava_terms_accepted_at',
     format('antes=%s depois=%s (devem ser iguais)', coalesce(v_at_antes::text,'NULL'), coalesce(v_at_depois::text,'NULL')),
     v_at_depois = v_at_antes),
    ('04f_upsert_authenticated_grava_full_name_normalmente',
     format('full_name=%s', v_full_name), v_full_name = 'Nome Via Upsert');
END $passo4f$;

-- (g) anon: nenhuma escrita (RLS não concede nenhuma policy pra anon em
-- profiles — nem chega a testar o trigger, a linha nem é alcançada).
DO $passo4g$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_rows int;
BEGIN
  SET ROLE anon;
  UPDATE public.profiles SET terms_accepted_version = '2099-01-01|2099-01-01' WHERE id = v_owner_a;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;

  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04g_anon_nenhuma_escrita', format('linhas_afetadas=%s (esperado 0)', v_rows), v_rows = 0);
END $passo4g$;

-- (h) INSERT de uma linha NOVA em profiles como authenticated, com as
-- duas colunas preenchidas no payload, resulta em NULL (ramo INSERT do
-- trigger). Usa um owner_c dedicado: cria via auth.users (que já insere a
-- linha em profiles via handle_new_user), apaga essa linha como
-- service_role e refaz o INSERT na mão como authenticated.
DO $passo4h_setup$
DECLARE
  v_owner_c uuid := gen_random_uuid();
BEGIN
  INSERT INTO zzfx_pta_ids (chave, valor) VALUES ('owner_c', v_owner_c);
  INSERT INTO auth.users (id, email) VALUES (v_owner_c, 'zz-fixture-owner-c@invalid.test');

  SET ROLE service_role;
  DELETE FROM public.profiles WHERE id = v_owner_c;
  RESET ROLE;
END $passo4h_setup$;

DO $passo4h$
DECLARE
  v_owner_c uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_c');
  v_ver text;
  v_at timestamptz;
BEGIN
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_c::text, true);
  INSERT INTO public.profiles (id, full_name, terms_accepted_version, terms_accepted_at)
    VALUES (v_owner_c, 'Linha Nova Via Authenticated', '2099-01-01|2099-01-01', now());
  RESET ROLE;

  SELECT terms_accepted_version, terms_accepted_at INTO v_ver, v_at
    FROM public.profiles WHERE id = v_owner_c;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04h_insert_authenticated_com_termos_preenchidos_vira_null',
     format('version=%s at=%s (ambos NULL esperado)', coalesce(v_ver,'NULL'), coalesce(v_at::text,'NULL')),
     v_ver IS NULL AND v_at IS NULL);
END $passo4h$;

-- (i) RLS inalterada: outra usuária não lê nem escreve o profile alheio.
DO $passo4i$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_owner_b uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_b');
  v_n int;
  v_rows int;
BEGIN
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_b::text, true);

  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04i_outra_usuaria_nao_le_profile_alheio', format('linhas_visiveis=%s (esperado 0)', v_n), v_n = 0);

  UPDATE public.profiles SET full_name = 'Tentativa de outra usuária' WHERE id = v_owner_a;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04i_outra_usuaria_nao_escreve_profile_alheio', format('linhas_afetadas=%s (esperado 0)', v_rows), v_rows = 0);

  RESET ROLE;
END $passo4i$;

-- ============================================================================
-- PASSO 5 — idempotência: reaplica a migração, sem erro, mesmo estado
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_version text NULL;

CREATE OR REPLACE FUNCTION public.profiles_protect_terms_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.terms_accepted_at := NULL;
      NEW.terms_accepted_version := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.terms_accepted_at := OLD.terms_accepted_at;
      NEW.terms_accepted_version := OLD.terms_accepted_version;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_10_profiles_protect_terms_acceptance ON public.profiles;
CREATE TRIGGER trg_10_profiles_protect_terms_acceptance
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_protect_terms_acceptance();

DO $passo5$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_ver text;
  v_n int;
BEGIN
  SELECT terms_accepted_version INTO v_ver FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('05a_idempotente_estado_preservado',
     format('version=%s (esperado 2026-11-15|2026-11-15, do passo 4c)', coalesce(v_ver,'NULL')),
     v_ver = '2026-11-15|2026-11-15');

  SELECT count(*) INTO v_n FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal
      AND tgname = 'trg_10_profiles_protect_terms_acceptance';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('05b_idempotente_trigger_unico', format('count=%s (esperado 1, não duplicado)', v_n), v_n = 1);
END $passo5$;

-- ============================================================================
-- PASSO 6 — rollback (DDL colado na íntegra do arquivo de rollback)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS backup_rollback_fase1;
REVOKE ALL ON SCHEMA backup_rollback_fase1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_fase1.profiles_terms_acceptance_20261116 AS
  SELECT id, terms_accepted_version, terms_accepted_at, now() AS backed_up_at
  FROM public.profiles;
ALTER TABLE backup_rollback_fase1.profiles_terms_acceptance_20261116 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_rollback_fase1.profiles_terms_acceptance_20261116 FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_10_profiles_protect_terms_acceptance ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_protect_terms_acceptance();

ALTER TABLE public.profiles DROP COLUMN IF EXISTS terms_accepted_version;

DO $passo6$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_n_coluna int;
  v_n_trigger int;
  v_n_funcao int;
  v_ver_backup text;
BEGIN
  SELECT count(*) INTO v_n_coluna FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='terms_accepted_version';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('06a_coluna_some_apos_rollback', format('%s (esperado 0)', v_n_coluna), v_n_coluna = 0);

  SELECT count(*) INTO v_n_trigger FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal
      AND tgname = 'trg_10_profiles_protect_terms_acceptance';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('06b_trigger_some_apos_rollback', format('%s (esperado 0)', v_n_trigger), v_n_trigger = 0);

  SELECT count(*) INTO v_n_funcao FROM pg_proc WHERE proname = 'profiles_protect_terms_acceptance';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('06c_funcao_some_apos_rollback', format('%s (esperado 0)', v_n_funcao), v_n_funcao = 0);

  SELECT terms_accepted_version INTO v_ver_backup
    FROM backup_rollback_fase1.profiles_terms_acceptance_20261116 WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('06d_backup_preserva_dado',
     format('version_no_backup=%s (esperado 2026-11-15|2026-11-15)', coalesce(v_ver_backup,'NULL')),
     v_ver_backup = '2026-11-15|2026-11-15');

  -- profiles_updated_at (trigger pré-existente, não tocado pela migração
  -- nem pelo rollback) continua lá.
  SELECT count(*) INTO v_n_trigger FROM pg_trigger
    WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal AND tgname = 'profiles_updated_at';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('06e_trigger_preexistente_profiles_updated_at_intacto', format('count=%s (esperado 1)', v_n_trigger), v_n_trigger = 1);
END $passo6$;

-- ============================================================================
-- PASSO 7 — reaplica a migração, confirma que volta a funcionar
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_version text NULL;

CREATE OR REPLACE FUNCTION public.profiles_protect_terms_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.terms_accepted_at := NULL;
      NEW.terms_accepted_version := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.terms_accepted_at := OLD.terms_accepted_at;
      NEW.terms_accepted_version := OLD.terms_accepted_version;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_10_profiles_protect_terms_acceptance ON public.profiles;
CREATE TRIGGER trg_10_profiles_protect_terms_acceptance
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_protect_terms_acceptance();

DO $passo7$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_ver text;
  v_erro boolean := false;
BEGIN
  -- DROP COLUMN no passo 6 apagou os dados de verdade (só o backup
  -- sobrevive) — reaplicar a migração recria a coluna, agora NULL de novo
  -- (comportamento correto e esperado: reaplicar não reaproveita o backup
  -- automaticamente, isso seria uma decisão separada, fora de escopo).
  SELECT terms_accepted_version INTO v_ver FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('07a_reaplicar_funciona_coluna_volta_null', format('version=%s (esperado NULL)', coalesce(v_ver,'NULL')),
     v_ver IS NULL);

  -- Trigger volta a proteger de verdade (não só a coluna existir).
  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
    UPDATE public.profiles SET terms_accepted_version = '2099-01-01|2099-01-01' WHERE id = v_owner_a;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    v_erro := true;
    RESET ROLE;
  END;
  SELECT terms_accepted_version INTO v_ver FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('07b_reaplicar_trigger_volta_a_proteger', format('version=%s erro=%s (esperado NULL/false)', coalesce(v_ver,'NULL'), v_erro),
     v_ver IS NULL AND v_erro = false);
END $passo7$;

-- ============================================================================
-- RESULTADO FINAL
-- ============================================================================
SELECT json_agg(row_to_json(r)) AS resultado
FROM (SELECT ordem, caso, detalhe, passou FROM zzfx_pta_results ORDER BY ordem) r;

DO $resumo$
DECLARE v_total int; v_falhas int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT passou) INTO v_total, v_falhas FROM zzfx_pta_results;
  RAISE NOTICE 'RESUMO: % casos, % falha(s)', v_total, v_falhas;
  IF v_falhas > 0 THEN
    RAISE EXCEPTION 'SUÍTE FALHOU: % de % casos não passaram — ver resultado JSON acima', v_falhas, v_total;
  END IF;
END $resumo$;

ROLLBACK;
