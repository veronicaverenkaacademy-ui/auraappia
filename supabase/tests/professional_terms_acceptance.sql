-- FASE CONSENT-1C — suíte da migração
-- 20261116090000_professional_terms_acceptance.sql.
--
-- NÃO EXECUTADA contra produção nesta fase — "REGRAS ABSOLUTAS" desta fase
-- restringem o acesso ao banco de produção a SOMENTE LEITURA
-- (query_database, usado só pra introspecção no PASSO 0). Este arquivo foi
-- escrito e revisado, mas a execução de verdade (mesmo dentro de
-- BEGIN...ROLLBACK, sem COMMIT) fica para quando a dona autorizar a
-- aplicação da migração ("AUTORIZO APLICAR MIGRAÇÃO FASE CONSENT-1C").
--
-- Mesmo padrão de supabase/tests/client_consents.sql: fixtures sintéticas
-- zz-fixture-, tudo dentro de BEGIN...ROLLBACK, DDL colado na íntegra
-- (migração e rollback, exatamente como os arquivos reais), lógica de
-- teste em blocos DO $$ separados, resultados agregados numa tabela
-- temporária e impressos com um SELECT final (JSON). Nunca COMMIT.
--
-- Pressupõe profiles (com terms_accepted_at já existente, sem
-- terms_accepted_version ainda) e o trigger handle_new_user já existindo
-- em produção — confirmado no PASSO 0 desta fase.
--
-- Ciclo: 0) confirma que terms_accepted_version NÃO existe ainda; 1)
-- fixtures (2 usuárias — a inserção em auth.users já dispara
-- handle_new_user, que cria a linha em profiles automaticamente, com
-- terms_accepted_at/terms_accepted_version nulos); 2) aplica a migração;
-- 3) verificação estrutural (coluna existe, nullable, sem default;
-- REVOKE/GRANT de coluna conferidos via information_schema); 4)
-- funcional — (a) coluna NULL numa linha "antiga" (recém-criada antes do
-- primeiro aceite); (b) service_role consegue gravar as duas colunas; (c)
-- authenticated NÃO consegue alterar terms_accepted_version nem
-- terms_accepted_at da PRÓPRIA linha, mas consegue alterar outro campo
-- (full_name); (d) outra usuária não lê nem escreve o profile alheio
-- (RLS por linha, inalterada por esta migração); 5) idempotência (reaplica
-- a migração, sem erro, mesmo estado); 6) aplica o rollback, confirma que
-- a coluna some, que o backup em backup_rollback_fase1 preserva os dados,
-- e que o GRANT de UPDATE em terms_accepted_at volta pra
-- authenticated/anon; 7) reaplica a migração e confirma que volta a
-- funcionar. Nunca COMMIT.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

CREATE TEMP TABLE zzfx_pta_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_pta_ids (chave text PRIMARY KEY, valor uuid) ON COMMIT DROP;
-- Passo 4 faz SET ROLE authenticated/anon pra provar a RLS/GRANT de
-- verdade (não só checar estruturalmente) — essas tabelas TEMP precisam
-- continuar legíveis/graváveis por qualquer papel durante a troca.
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
-- PASSO 1 — fixtures: 2 usuárias (ownerA, ownerB). O INSERT em auth.users
-- dispara handle_new_user, que já cria a linha em profiles sozinha.
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
-- PASSO 2 — aplica a migração (DDL colado na íntegra)
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_version text NULL;

REVOKE UPDATE (terms_accepted_version, terms_accepted_at)
  ON public.profiles FROM authenticated, anon;

GRANT UPDATE (terms_accepted_version, terms_accepted_at)
  ON public.profiles TO service_role;

-- ============================================================================
-- PASSO 3 — verificação estrutural
-- ============================================================================
DO $passo3$
DECLARE
  v_is_nullable text;
  v_default text;
  v_n int;
BEGIN
  SELECT is_nullable, column_default INTO v_is_nullable, v_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='terms_accepted_version';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('03a_coluna_existe_nullable', format('is_nullable=%s default=%s', v_is_nullable, coalesce(v_default,'NULL')),
     v_is_nullable = 'YES' AND v_default IS NULL);

  SELECT count(*) INTO v_n FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name IN ('terms_accepted_version','terms_accepted_at')
      AND grantee IN ('authenticated','anon') AND privilege_type='UPDATE';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('03b_sem_grant_update_authenticated_anon', format('count=%s (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name IN ('terms_accepted_version','terms_accepted_at')
      AND grantee='service_role' AND privilege_type='UPDATE';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('03c_service_role_tem_grant_update', format('count=%s (esperado 2)', v_n), v_n = 2);

  -- Outras colunas de profiles continuam com UPDATE pra authenticated —
  -- confirma que o REVOKE foi SÓ nas duas colunas, não na tabela inteira.
  SELECT count(*) INTO v_n FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='full_name' AND grantee='authenticated' AND privilege_type='UPDATE';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('03d_outras_colunas_ainda_atualizaveis', format('count=%s (esperado 1)', v_n), v_n = 1);
END $passo3$;

-- ============================================================================
-- PASSO 4 — funcional (RLS + GRANT de coluna de verdade, via SET ROLE)
-- ============================================================================
DO $passo4a$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_ver text;
  v_at timestamptz;
BEGIN
  SELECT terms_accepted_version, terms_accepted_at INTO v_ver, v_at
    FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04a_linha_antiga_sem_aceite_fica_null',
     format('version=%s at=%s (ambos NULL esperado)', coalesce(v_ver,'NULL'), coalesce(v_at::text,'NULL')),
     v_ver IS NULL AND v_at IS NULL);
END $passo4a$;

DO $passo4b$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_ver text;
BEGIN
  SET ROLE service_role;
  UPDATE public.profiles
    SET terms_accepted_version = '2026-11-15', terms_accepted_at = now()
    WHERE id = v_owner_a;
  RESET ROLE;

  SELECT terms_accepted_version INTO v_ver FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04b_service_role_consegue_gravar', format('version=%s', coalesce(v_ver,'NULL')), v_ver = '2026-11-15');
END $passo4b$;

DO $passo4c$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_erro_version boolean := false;
  v_erro_at boolean := false;
  v_full_name text;
BEGIN
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);

  BEGIN
    UPDATE public.profiles SET terms_accepted_version = '2099-01-01' WHERE id = v_owner_a;
    v_erro_version := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_erro_version := true;
  END;

  BEGIN
    UPDATE public.profiles SET terms_accepted_at = now() WHERE id = v_owner_a;
    v_erro_at := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_erro_at := true;
  END;

  -- Mesma linha, mesma sessão authenticated: outro campo continua editável.
  UPDATE public.profiles SET full_name = 'Nome Atualizado Pela Própria' WHERE id = v_owner_a;
  SELECT full_name INTO v_full_name FROM public.profiles WHERE id = v_owner_a;

  RESET ROLE;

  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04c_authenticated_nao_altera_version', format('bloqueado=%s', v_erro_version), v_erro_version),
    ('04c_authenticated_nao_altera_at', format('bloqueado=%s', v_erro_at), v_erro_at),
    ('04c_authenticated_altera_outro_campo_proprio', format('full_name=%s', v_full_name),
     v_full_name = 'Nome Atualizado Pela Própria');
END $passo4c$;

DO $passo4d$
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
    ('04d_outra_usuaria_nao_le_profile_alheio', format('linhas_visiveis=%s (esperado 0)', v_n), v_n = 0);

  UPDATE public.profiles SET full_name = 'Tentativa de outra usuária' WHERE id = v_owner_a;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('04d_outra_usuaria_nao_escreve_profile_alheio', format('linhas_afetadas=%s (esperado 0)', v_rows), v_rows = 0);

  RESET ROLE;
END $passo4d$;

-- ============================================================================
-- PASSO 5 — idempotência: reaplica a migração, sem erro, mesmo estado
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_version text NULL;

REVOKE UPDATE (terms_accepted_version, terms_accepted_at)
  ON public.profiles FROM authenticated, anon;

GRANT UPDATE (terms_accepted_version, terms_accepted_at)
  ON public.profiles TO service_role;

DO $passo5$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_ver text;
BEGIN
  SELECT terms_accepted_version INTO v_ver FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('05_idempotente_estado_preservado', format('version=%s (esperado 2026-11-15, do passo 4b)', coalesce(v_ver,'NULL')),
     v_ver = '2026-11-15');
END $passo5$;

-- ============================================================================
-- PASSO 6 — rollback (DDL colado na íntegra)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS backup_rollback_fase1;
REVOKE ALL ON SCHEMA backup_rollback_fase1 FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS backup_rollback_fase1.profiles_terms_acceptance_20261116 AS
  SELECT id, terms_accepted_version, terms_accepted_at, now() AS backed_up_at
  FROM public.profiles;
ALTER TABLE backup_rollback_fase1.profiles_terms_acceptance_20261116 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON backup_rollback_fase1.profiles_terms_acceptance_20261116 FROM PUBLIC, anon, authenticated;

GRANT UPDATE (terms_accepted_at) ON public.profiles TO authenticated, anon;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS terms_accepted_version;

DO $passo6$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_n int;
  v_ver_backup text;
  v_grant_restaurado int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='terms_accepted_version';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('06a_coluna_some_apos_rollback', format('%s (esperado 0)', v_n), v_n = 0);

  SELECT terms_accepted_version INTO v_ver_backup
    FROM backup_rollback_fase1.profiles_terms_acceptance_20261116 WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('06b_backup_preserva_dado', format('version_no_backup=%s (esperado 2026-11-15)', coalesce(v_ver_backup,'NULL')),
     v_ver_backup = '2026-11-15');

  SELECT count(*) INTO v_grant_restaurado FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='profiles' AND column_name='terms_accepted_at'
      AND grantee IN ('authenticated','anon') AND privilege_type='UPDATE';
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('06c_grant_terms_accepted_at_restaurado', format('count=%s (esperado 2)', v_grant_restaurado),
     v_grant_restaurado = 2);
END $passo6$;

-- ============================================================================
-- PASSO 7 — reaplica a migração, confirma que volta a funcionar
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_version text NULL;

REVOKE UPDATE (terms_accepted_version, terms_accepted_at)
  ON public.profiles FROM authenticated, anon;

GRANT UPDATE (terms_accepted_version, terms_accepted_at)
  ON public.profiles TO service_role;

DO $passo7$
DECLARE
  v_owner_a uuid := (SELECT valor FROM zzfx_pta_ids WHERE chave='owner_a');
  v_ver text;
BEGIN
  -- DROP COLUMN no passo 6 apagou os dados de verdade (só o backup
  -- sobrevive) — reaplicar a migração recria a coluna, agora NULL de novo
  -- (comportamento correto e esperado: reaplicar não reaproveita o backup
  -- automaticamente, isso seria uma decisão separada, fora de escopo).
  SELECT terms_accepted_version INTO v_ver FROM public.profiles WHERE id = v_owner_a;
  INSERT INTO zzfx_pta_results (caso, detalhe, passou) VALUES
    ('07_reaplicar_funciona_coluna_volta_null', format('version=%s (esperado NULL)', coalesce(v_ver,'NULL')),
     v_ver IS NULL);
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
