-- FASE OPS-1 (Parte B) — suíte da migração
-- 20261123190000_client_otp_codes_cleanup.sql.
--
-- NÃO APLICADA EM PRODUÇÃO nesta fase (branch nova + PR em DRAFT, por
-- instrução explícita da dona — "NÃO aplique migração"). Rodada via
-- BEGIN...ROLLBACK direto contra o Postgres gerenciado do projeto (não há
-- um cluster Postgres local separado disponível neste ambiente de
-- execução, diferente do texto de suítes anteriores desta família) — o
-- NUNCA-COMMIT garante que nada persiste: a função é criada, testada e
-- desfeita, tudo dentro da mesma transação que termina em ROLLBACK.
--
-- Mesmo padrão estrutural de supabase/tests/whatsapp_otp_send_log.sql:
-- fixtures sintéticas zzfx_, DDL colado na íntegra (migração e rollback)
-- como instruções de nível superior, lógica de teste em blocos DO $$
-- separados, resultados agregados numa tabela temporária e impressos com
-- um SELECT final. Nunca COMMIT.
--
-- Ciclo cobrado pela fase:
--   (a) apaga só linhas mais antigas que a retenção (48h)
--   (b) preserva TODAS as linhas dentro da janela dos tetos — prova que a
--       CONTAGEM usada pelo teto diário (created_at >= now()-24h) não muda
--       antes/depois da limpeza
--   (c) lote limitado (p_batch_limit)
--   (d) idempotência (chamar de novo com nada pra apagar devolve 0)
--   (e) não toca em nenhuma outra tabela (snapshot de audit_log/auth.users)
--   (f) termina em ROLLBACK, nunca COMMIT
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE zzfx_otpclean_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;

-- ============================================================================
-- PASSO 0 — confirma que a função não existe ainda (estado "antes"), e
-- tira um snapshot de outras tabelas para o item (e)
-- ============================================================================
CREATE TEMP TABLE zzfx_otpclean_snapshot (chave text PRIMARY KEY, valor bigint) ON COMMIT DROP;
INSERT INTO zzfx_otpclean_snapshot (chave, valor) VALUES
  ('audit_log_antes', (SELECT count(*) FROM audit_log)),
  ('auth_users_antes', (SELECT count(*) FROM auth.users));

DO $passo0$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cleanup_old_client_otp_codes';
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('00_funcao_nao_existe_ainda', format('%s (esperado 0)', v_n), v_n = 0);
END $passo0$;

-- ============================================================================
-- PASSO 1 — aplica a migração (DDL colado, igual ao arquivo real)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_client_otp_codes(
  p_batch_limit integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_retention_hours CONSTANT integer := 48;
  v_cutoff timestamptz := now() - (v_retention_hours || ' hours')::interval;
  v_deleted integer;
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit <= 0 THEN
    RAISE EXCEPTION 'p_batch_limit deve ser um inteiro positivo, recebido: %', p_batch_limit;
  END IF;

  PERFORM set_config('lock_timeout', '3s', true);

  WITH batch AS (
    SELECT id
    FROM public.client_otp_codes
    WHERE created_at < v_cutoff
    ORDER BY created_at ASC
    LIMIT p_batch_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.client_otp_codes
  WHERE id IN (SELECT id FROM batch);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cleanup_old_client_otp_codes(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_client_otp_codes(integer) TO service_role;
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PASSO 2 — verificação estrutural pós-aplicação
-- ============================================================================
DO $passo2$
DECLARE v_ok boolean;
BEGIN
  SELECT count(*) = 1 INTO v_ok FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cleanup_old_client_otp_codes';
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES ('02_funcao_criada', 'cleanup_old_client_otp_codes existe', v_ok);

  SELECT NOT (has_function_privilege('anon', 'public.cleanup_old_client_otp_codes(integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.cleanup_old_client_otp_codes(integer)', 'EXECUTE')
    OR has_function_privilege('public', 'public.cleanup_old_client_otp_codes(integer)', 'EXECUTE'))
    INTO v_ok;
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES ('02_anon_authenticated_public_sem_execute', 'nenhum EXECUTE pra anon/authenticated/public', v_ok);

  SELECT has_function_privilege('service_role', 'public.cleanup_old_client_otp_codes(integer)', 'EXECUTE') INTO v_ok;
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES ('02_service_role_tem_execute', 'service_role pode executar', v_ok);

  SELECT prosecdef = false INTO v_ok FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cleanup_old_client_otp_codes';
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES ('02_sem_security_definer', 'prosecdef = false (SECURITY INVOKER)', v_ok);
END $passo2$;

-- ============================================================================
-- PASSO 3 — fixtures: linhas sintéticas em idades variadas
-- ============================================================================
DO $fixtures$
BEGIN
  INSERT INTO public.client_otp_codes (phone, code_hash, expires_at, created_at) VALUES
    ('+5511900000001', 'zzfx_hash_1h',  now() + interval '9 minutes',  now() - interval '1 hour'),   -- dentro de 24h
    ('+5511900000002', 'zzfx_hash_23h', now() - interval '13 hours',   now() - interval '23 hours'),  -- dentro de 24h (borda)
    ('+5511900000003', 'zzfx_hash_30h', now() - interval '20 hours',   now() - interval '30 hours'),  -- fora de 24h, dentro de 48h
    ('+5511900000004', 'zzfx_hash_47h', now() - interval '37 hours',   now() - interval '47 hours'),  -- dentro de 48h (borda)
    ('+5511900000005', 'zzfx_hash_49h', now() - interval '39 hours',   now() - interval '49 hours'),  -- fora de 48h (borda)
    ('+5511900000006', 'zzfx_hash_100h', now() - interval '90 hours',  now() - interval '100 hours'); -- bem fora de 48h
END $fixtures$;

CREATE TEMP TABLE zzfx_otpclean_counts (chave text PRIMARY KEY, valor bigint) ON COMMIT DROP;
INSERT INTO zzfx_otpclean_counts (chave, valor) VALUES
  ('total_antes', (SELECT count(*) FROM public.client_otp_codes WHERE phone LIKE '+551190000%')),
  -- Mesma consulta EXATA que o teto diário real faz (countGlobalOtpCodesSince
  -- com since = now - 24h) — sem o filtro de phone, porque é assim que o
  -- código de produção conta (GLOBAL, sem WHERE phone). Guardado ANTES da
  -- limpeza para comparar com o valor DEPOIS no item (b).
  ('janela_24h_antes', (SELECT count(*) FROM public.client_otp_codes WHERE created_at >= now() - interval '24 hours'));

-- ============================================================================
-- PASSO 4 — caso (a) + (b): roda a limpeza (lote grande, cobre tudo de uma
-- vez) e confirma o que foi apagado/preservado
-- ============================================================================
DO $caso_a_b$
DECLARE
  v_deleted int;
  v_restantes_zzfx int;
  v_janela_24h_depois bigint;
  v_janela_24h_antes bigint;
  v_tem_1h boolean; v_tem_23h boolean; v_tem_30h boolean; v_tem_47h boolean; v_tem_49h boolean; v_tem_100h boolean;
BEGIN
  v_deleted := public.cleanup_old_client_otp_codes(5000);
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('04a_funcao_devolve_contagem_apagada', format('devolveu %s', v_deleted), v_deleted IS NOT NULL AND v_deleted >= 2);

  SELECT count(*) INTO v_restantes_zzfx FROM public.client_otp_codes WHERE phone LIKE '+551190000%';
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('04a_restam_exatamente_as_4_linhas_dentro_de_48h', format('%s restantes (esperado 4)', v_restantes_zzfx), v_restantes_zzfx = 4);

  SELECT EXISTS(SELECT 1 FROM public.client_otp_codes WHERE phone = '+5511900000001') INTO v_tem_1h;
  SELECT EXISTS(SELECT 1 FROM public.client_otp_codes WHERE phone = '+5511900000002') INTO v_tem_23h;
  SELECT EXISTS(SELECT 1 FROM public.client_otp_codes WHERE phone = '+5511900000003') INTO v_tem_30h;
  SELECT EXISTS(SELECT 1 FROM public.client_otp_codes WHERE phone = '+5511900000004') INTO v_tem_47h;
  SELECT EXISTS(SELECT 1 FROM public.client_otp_codes WHERE phone = '+5511900000005') INTO v_tem_49h;
  SELECT EXISTS(SELECT 1 FROM public.client_otp_codes WHERE phone = '+5511900000006') INTO v_tem_100h;

  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('04a_linha_1h_preservada', 'dentro de 24h', v_tem_1h),
    ('04a_linha_23h_preservada', 'borda de 24h', v_tem_23h),
    ('04a_linha_30h_preservada_fora_24h_dentro_48h', '30h: fora do teto diário, mas dentro da retenção', v_tem_30h),
    ('04a_linha_47h_preservada_borda_48h', 'borda de 48h (47h < 48h)', v_tem_47h),
    ('04a_linha_49h_apagada_passou_48h', '49h > 48h de retenção', NOT v_tem_49h),
    ('04a_linha_100h_apagada', '100h, bem além da retenção', NOT v_tem_100h);

  -- (b) — a contagem que o TETO DIÁRIO real usaria (created_at >= now()-24h,
  -- GLOBAL, mesma consulta de countGlobalOtpCodesSince) tem que ser a MESMA
  -- antes e depois da limpeza — nenhuma linha que entrava nessa contagem foi
  -- tocada.
  SELECT valor INTO v_janela_24h_antes FROM zzfx_otpclean_counts WHERE chave = 'janela_24h_antes';
  SELECT count(*) INTO v_janela_24h_depois FROM public.client_otp_codes WHERE created_at >= now() - interval '24 hours';
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('04b_contagem_do_teto_diario_24h_nao_muda',
     format('antes=%s depois=%s', v_janela_24h_antes, v_janela_24h_depois),
     v_janela_24h_antes = v_janela_24h_depois);
END $caso_a_b$;

-- ============================================================================
-- PASSO 5 — caso (c): lote limitado — insere mais linhas antigas e confirma
-- que uma chamada com p_batch_limit pequeno apaga só até o limite
-- ============================================================================
DO $caso_c$
DECLARE
  v_deleted_1 int;
  v_deleted_2 int;
  v_deleted_3 int;
  v_restantes int;
BEGIN
  INSERT INTO public.client_otp_codes (phone, code_hash, expires_at, created_at)
  SELECT '+55119000'||lpad(gs::text, 4, '1'), 'zzfx_hash_lote_'||gs, now() - interval '60 hours', now() - interval '72 hours'
  FROM generate_series(1, 7) gs;

  v_deleted_1 := public.cleanup_old_client_otp_codes(3);
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('05c_primeiro_lote_respeita_limite', format('apagou %s (esperado 3)', v_deleted_1), v_deleted_1 = 3);

  v_deleted_2 := public.cleanup_old_client_otp_codes(3);
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('05c_segundo_lote_respeita_limite', format('apagou %s (esperado 3)', v_deleted_2), v_deleted_2 = 3);

  v_deleted_3 := public.cleanup_old_client_otp_codes(3);
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('05c_terceiro_lote_so_a_ultima_linha', format('apagou %s (esperado 1, só restava 1 das 7)', v_deleted_3), v_deleted_3 = 1);

  SELECT count(*) INTO v_restantes FROM public.client_otp_codes WHERE code_hash LIKE 'zzfx_hash_lote_%';
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('05c_todas_as_7_linhas_do_lote_foram_apagadas_no_total', format('%s restantes (esperado 0)', v_restantes), v_restantes = 0);
END $caso_c$;

-- ============================================================================
-- PASSO 6 — caso (d): idempotência — nada mais pra apagar, devolve 0, sem
-- erro, chamando duas vezes seguidas
-- ============================================================================
DO $caso_d$
DECLARE v_deleted int;
BEGIN
  v_deleted := public.cleanup_old_client_otp_codes(5000);
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('06d_primeira_chamada_sem_backlog_devolve_0', format('devolveu %s', v_deleted), v_deleted = 0);

  v_deleted := public.cleanup_old_client_otp_codes(5000);
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('06d_segunda_chamada_seguida_tambem_devolve_0_sem_erro', format('devolveu %s', v_deleted), v_deleted = 0);
END $caso_d$;

-- ============================================================================
-- PASSO 7 — caso (e): nenhuma outra tabela foi tocada
-- ============================================================================
DO $caso_e$
DECLARE
  v_audit_antes bigint; v_audit_depois bigint;
  v_users_antes bigint; v_users_depois bigint;
BEGIN
  SELECT valor INTO v_audit_antes FROM zzfx_otpclean_snapshot WHERE chave = 'audit_log_antes';
  SELECT valor INTO v_users_antes FROM zzfx_otpclean_snapshot WHERE chave = 'auth_users_antes';
  SELECT count(*) INTO v_audit_depois FROM audit_log;
  SELECT count(*) INTO v_users_depois FROM auth.users;
  INSERT INTO zzfx_otpclean_results (caso, detalhe, passou) VALUES
    ('07e_audit_log_intacto', format('antes=%s depois=%s', v_audit_antes, v_audit_depois), v_audit_antes = v_audit_depois),
    ('07e_auth_users_intacto', format('antes=%s depois=%s', v_users_antes, v_users_depois), v_users_antes = v_users_depois);
END $caso_e$;

-- Saída consolidada numa ÚNICA consulta.
SELECT jsonb_build_object(
  'casos', (
    SELECT jsonb_agg(
      jsonb_build_object('ordem', ordem, 'caso', caso, 'detalhe', detalhe, 'passou', passou)
      ORDER BY ordem
    )
    FROM zzfx_otpclean_results
  ),
  'resumo', (
    SELECT jsonb_build_object(
      'passaram', count(*) FILTER (WHERE passou),
      'falharam', count(*) FILTER (WHERE NOT passou)
    )
    FROM zzfx_otpclean_results
  )
) AS resultado;

-- PASSO 8 (caso f): nunca COMMIT — a limpeza acima, incluindo as fixtures e
-- a própria função, é inteiramente desfeita aqui.
ROLLBACK;
