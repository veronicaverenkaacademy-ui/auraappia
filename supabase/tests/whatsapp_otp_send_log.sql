-- FASE LEMBRETES-3 (Ponto B) — suíte da migração
-- 20261114120000_whatsapp_otp_send_log.sql.
--
-- NÃO EXECUTADA contra produção nesta fase (branch nova + PR em DRAFT, por
-- instrução explícita da dona — "NÃO aplique migração"). Rodada LOCALMENTE
-- (cluster Postgres local deste ambiente, banco descartável, NUNCA o banco
-- de produção da dona) — ver saída colada no relatório final da fase.
--
-- Mesmo padrão de supabase/tests/whatsapp_reminders_reliable_dispatch.sql:
-- fixtures sintéticas zzfx_, tudo dentro de BEGIN...ROLLBACK, DDL colado na
-- íntegra (migração e rollback) como instruções de nível superior, lógica
-- de teste em blocos DO $$ separados, resultados agregados numa tabela
-- temporária e impressos com um SELECT final. Nunca COMMIT.
--
-- Ciclo cobrado pela fase: 1) confirma que whatsapp_otp_send_log NÃO existe
-- ainda; 2) aplica a migração; 3) verificação estrutural (RLS, GRANT/REVOKE,
-- CHECKs, FK); 4) casos funcionais (insert sent/failed, nunca telefone/
-- código, outcome/error_class inválidos rejeitados, owner_id nulo aceito,
-- owner_id apontando para usuário real aceito e sobrevive a DELETE do
-- usuário via ON DELETE SET NULL); 5) aplica o rollback; 6) confirma que a
-- tabela some; 7) reaplica a migração; 8) confirma que volta a funcionar.
-- Nunca COMMIT.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

CREATE TEMP TABLE zzfx_otp_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;

-- ============================================================================
-- PASSO 0 — confirma que a tabela não existe ainda (estado "antes")
-- ============================================================================
DO $passo0$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.tables
    WHERE table_schema='public' AND table_name = 'whatsapp_otp_send_log';
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES
    ('00_tabela_nao_existe_ainda', format('%s (esperado 0)', v_n), v_n = 0);
END $passo0$;

-- ============================================================================
-- PASSO 1 — fixture: uma dona de verdade (auth.users), pra provar o FK
-- owner_id + ON DELETE SET NULL no PASSO 4.
-- ============================================================================
CREATE TEMP TABLE zzfx_otp_ids (chave text PRIMARY KEY, valor uuid) ON COMMIT DROP;
INSERT INTO zzfx_otp_ids (chave, valor) VALUES ('owner', gen_random_uuid());

DO $setup$
DECLARE v_owner uuid := (SELECT valor FROM zzfx_otp_ids WHERE chave='owner');
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-fixture-'||v_owner||'@invalid.test', '', now(), now(), now(), '{}', '{"user_type":"professional"}'::jsonb);
END $setup$;

DO $sentinela$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE 'zz-fixture-%@invalid.test';
  IF n <> 1 THEN RAISE EXCEPTION 'SENTINELA: esperado 1 usuário sintético, achei %', n; END IF;
END $sentinela$;

-- ============================================================================
-- PASSO 2 — aplica a migração (DDL colado, igual ao arquivo real)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_otp_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  template_name text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('sent', 'failed')),
  meta_error_code int NULL,
  error_class text NULL CHECK (error_class IN ('permanent', 'temporary'))
);
CREATE INDEX IF NOT EXISTS whatsapp_otp_send_log_created_at_idx
  ON public.whatsapp_otp_send_log (created_at);
ALTER TABLE public.whatsapp_otp_send_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_otp_send_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_otp_send_log TO service_role;
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PASSO 3 — verificação estrutural pós-aplicação
-- ============================================================================
DO $passo3$
DECLARE v_ok boolean;
BEGIN
  SELECT count(*) = 1 INTO v_ok FROM information_schema.tables
    WHERE table_schema='public' AND table_name = 'whatsapp_otp_send_log';
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('03_tabela_criada', 'whatsapp_otp_send_log existe', v_ok);

  SELECT relrowsecurity INTO v_ok FROM pg_class WHERE oid = 'public.whatsapp_otp_send_log'::regclass;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('03_rls_ligada', 'RLS ligada', v_ok);

  SELECT NOT (has_table_privilege('anon', 'public.whatsapp_otp_send_log', 'SELECT')
    OR has_table_privilege('authenticated', 'public.whatsapp_otp_send_log', 'SELECT')
    OR has_table_privilege('anon', 'public.whatsapp_otp_send_log', 'INSERT')
    OR has_table_privilege('authenticated', 'public.whatsapp_otp_send_log', 'INSERT'))
    INTO v_ok;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('03_anon_authenticated_sem_acesso', 'nenhum privilégio pra anon/authenticated', v_ok);

  SELECT has_table_privilege('service_role', 'public.whatsapp_otp_send_log', 'INSERT')
    AND has_table_privilege('service_role', 'public.whatsapp_otp_send_log', 'SELECT')
    AND has_table_privilege('service_role', 'public.whatsapp_otp_send_log', 'DELETE')
    INTO v_ok;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('03_service_role_acesso_total', 'service_role pode insert/select/delete', v_ok);

  SELECT count(*) = 1 INTO v_ok FROM information_schema.columns
    WHERE table_schema='public' AND table_name='whatsapp_otp_send_log' AND column_name='created_at';
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('03_coluna_created_at', 'created_at existe', v_ok);

  -- Prova negativa explícita (pedido da dona): o conjunto EXATO de colunas é
  -- só este — nenhuma coluna de telefone, código OTP, hash ou texto de
  -- mensagem pode ter entrado por acidente (meta_error_code é o código
  -- NUMÉRICO de erro da Meta, nunca o código OTP da cliente).
  SELECT array_agg(column_name::text ORDER BY column_name) = ARRAY[
    'created_at', 'error_class', 'id', 'meta_error_code', 'outcome', 'owner_id', 'template_name'
  ] INTO v_ok
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='whatsapp_otp_send_log';
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES
    ('03_conjunto_exato_de_colunas_sem_telefone_codigo_hash_ou_texto', 'só as 7 colunas esperadas, nenhuma extra', v_ok);

  SELECT count(*) = 1 INTO v_ok FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='whatsapp_otp_send_log'
      AND constraint_type='FOREIGN KEY';
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('03_fk_owner_id_existe', 'owner_id tem FK para auth.users', v_ok);
END $passo3$;

-- ============================================================================
-- PASSO 4 — casos funcionais
-- ============================================================================
DO $caso_funcional$
DECLARE
  v_owner uuid := (SELECT valor FROM zzfx_otp_ids WHERE chave='owner');
  v_id_sent uuid;
  v_id_failed uuid;
  v_id_owner_null uuid;
  v_rejeitou boolean;
  v_outcome text; v_error_class text; v_meta_code int; v_owner_lido uuid;
BEGIN
  -- 4a) envio bem-sucedido: outcome='sent', sem código/classe de erro.
  INSERT INTO public.whatsapp_otp_send_log (owner_id, template_name, outcome)
  VALUES (NULL, 'autenti_', 'sent')
  RETURNING id INTO v_id_sent;
  SELECT outcome, meta_error_code, error_class INTO v_outcome, v_meta_code, v_error_class
    FROM public.whatsapp_otp_send_log WHERE id = v_id_sent;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES
    ('04a_envio_sent_gravado', format('outcome=%s meta_error_code=%s error_class=%s', v_outcome, v_meta_code, v_error_class),
     v_outcome = 'sent' AND v_meta_code IS NULL AND v_error_class IS NULL);

  -- 4b) falha permanente (ex.: 132018), owner_id NULL (caso real do OTP hoje).
  INSERT INTO public.whatsapp_otp_send_log (owner_id, template_name, outcome, meta_error_code, error_class)
  VALUES (NULL, 'autenti_', 'failed', 132018, 'permanent')
  RETURNING id INTO v_id_failed;
  SELECT outcome, meta_error_code, error_class, owner_id INTO v_outcome, v_meta_code, v_error_class, v_owner_lido
    FROM public.whatsapp_otp_send_log WHERE id = v_id_failed;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES
    ('04b_falha_permanente_gravada', format('outcome=%s meta_error_code=%s error_class=%s owner_id=%s', v_outcome, v_meta_code, v_error_class, v_owner_lido),
     v_outcome = 'failed' AND v_meta_code = 132018 AND v_error_class = 'permanent' AND v_owner_lido IS NULL);

  -- 4c) owner_id NÃO-nulo é aceito (caso futuro hipotético, FK de verdade).
  INSERT INTO public.whatsapp_otp_send_log (owner_id, template_name, outcome, meta_error_code, error_class)
  VALUES (v_owner, 'autenti_', 'failed', 131026, NULL)
  RETURNING id INTO v_id_owner_null;
  SELECT owner_id INTO v_owner_lido FROM public.whatsapp_otp_send_log WHERE id = v_id_owner_null;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES
    ('04c_owner_id_nao_nulo_aceito', format('owner_id=%s', v_owner_lido), v_owner_lido = v_owner);

  -- 4d) outcome inválido é rejeitado pelo CHECK.
  BEGIN
    INSERT INTO public.whatsapp_otp_send_log (owner_id, template_name, outcome) VALUES (NULL, 'autenti_', 'qualquer_coisa');
    v_rejeitou := false;
  EXCEPTION WHEN check_violation THEN
    v_rejeitou := true;
  END;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('04d_outcome_invalido_rejeitado', 'rejeitado por check_violation', v_rejeitou);

  -- 4e) error_class inválido é rejeitado pelo CHECK.
  BEGIN
    INSERT INTO public.whatsapp_otp_send_log (owner_id, template_name, outcome, error_class) VALUES (NULL, 'autenti_', 'failed', 'qualquer_coisa');
    v_rejeitou := false;
  EXCEPTION WHEN check_violation THEN
    v_rejeitou := true;
  END;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('04e_error_class_invalido_rejeitado', 'rejeitado por check_violation', v_rejeitou);

  -- 4f) template_name é obrigatório (NOT NULL).
  BEGIN
    INSERT INTO public.whatsapp_otp_send_log (owner_id, template_name, outcome) VALUES (NULL, NULL, 'sent');
    v_rejeitou := false;
  EXCEPTION WHEN not_null_violation THEN
    v_rejeitou := true;
  END;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('04f_template_name_obrigatorio', 'rejeitado por not_null_violation', v_rejeitou);

  -- 4g) owner_id apontando para um usuário inexistente é rejeitado (FK de verdade).
  BEGIN
    INSERT INTO public.whatsapp_otp_send_log (owner_id, template_name, outcome) VALUES (gen_random_uuid(), 'autenti_', 'sent');
    v_rejeitou := false;
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejeitou := true;
  END;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('04g_owner_id_inexistente_rejeitado', 'rejeitado por foreign_key_violation', v_rejeitou);

  -- 4h) ON DELETE SET NULL: apagar a conta da dona NUNCA apaga o log, só
  -- desvincula o owner_id (prova funcional, não só textual da FK).
  DELETE FROM auth.users WHERE id = v_owner;
  SELECT owner_id INTO v_owner_lido FROM public.whatsapp_otp_send_log WHERE id = v_id_owner_null;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES
    ('04h_delete_do_owner_so_desvincula_nunca_apaga_o_log',
     format('owner_id=%s (deveria ter virado NULL, linha continua existindo)', v_owner_lido),
     v_owner_lido IS NULL);
  SELECT count(*) = 3 INTO v_rejeitou FROM public.whatsapp_otp_send_log
    WHERE id IN (v_id_sent, v_id_failed, v_id_owner_null);
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES
    ('04i_as_3_linhas_continuam_existindo_apos_o_delete', 'nenhuma linha foi apagada em cascata', v_rejeitou);
END $caso_funcional$;

-- ============================================================================
-- PASSO 5 — aplica o rollback (DDL colado, igual ao arquivo real)
-- ============================================================================
DROP TABLE IF EXISTS public.whatsapp_otp_send_log;
NOTIFY pgrst, 'reload schema';

DO $passo6$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.tables
    WHERE table_schema='public' AND table_name = 'whatsapp_otp_send_log';
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES
    ('06_tabela_removida_pelo_rollback', format('%s ainda existe (esperado 0)', v_n), v_n = 0);
END $passo6$;

-- ============================================================================
-- PASSO 7 — reaplica a migração (DDL colado de novo) e confirma que volta
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_otp_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  template_name text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('sent', 'failed')),
  meta_error_code int NULL,
  error_class text NULL CHECK (error_class IN ('permanent', 'temporary'))
);
CREATE INDEX IF NOT EXISTS whatsapp_otp_send_log_created_at_idx
  ON public.whatsapp_otp_send_log (created_at);
ALTER TABLE public.whatsapp_otp_send_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_otp_send_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_otp_send_log TO service_role;
NOTIFY pgrst, 'reload schema';

DO $passo8$
DECLARE v_ok boolean; v_id uuid;
BEGIN
  SELECT count(*) = 1 INTO v_ok FROM information_schema.tables
    WHERE table_schema='public' AND table_name = 'whatsapp_otp_send_log';
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES ('08_tabela_volta_depois_de_reaplicar', 'whatsapp_otp_send_log existe de novo', v_ok);

  INSERT INTO public.whatsapp_otp_send_log (owner_id, template_name, outcome, meta_error_code, error_class)
  VALUES (NULL, 'autenti_', 'failed', 132018, 'permanent')
  RETURNING id INTO v_id;
  INSERT INTO zzfx_otp_results (caso, detalhe, passou) VALUES
    ('08_insert_funciona_normalmente_apos_reaplicar', format('id=%s', v_id), v_id IS NOT NULL);
END $passo8$;

SELECT ordem, caso, detalhe, passou FROM zzfx_otp_results ORDER BY ordem;

SELECT 'RESUMO' AS linha, count(*) FILTER (WHERE passou) AS passaram, count(*) FILTER (WHERE NOT passou) AS falharam
FROM zzfx_otp_results;

ROLLBACK;
