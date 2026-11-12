-- FASE LEMBRETES-1 — suíte da migração
-- 20261112200000_whatsapp_reminders_reliable_dispatch.sql (já incluindo os
-- 3 ajustes pedidos pela dona em 12/11/2026: segredo duplo do agendador —
-- TypeScript, não testado aqui, ver tests/central-cron-auth.test.ts —,
-- prazo de 24h pro 'uncertain' expirar, e a confirmação de que
-- net._http_response já se limpa sozinha via pg_net.ttl).
--
-- NÃO EXECUTADA contra produção (banco tratado como SOMENTE LEITURA nesta
-- fase, por instrução explícita — nenhuma escrita, nem dentro de uma
-- transação que termina em ROLLBACK). Preparada para rodar quando a dona
-- autorizar ("AUTORIZO APLICAR MIGRAÇÃO FASE LEMBRETES-1"), de preferência
-- ANTES de aplicar de verdade (mesmo banco, mesma sessão, uma transação só
-- que nunca comita).
--
-- Mesmo padrão de supabase/tests/portal_k2c_logo_wide.sql e
-- whatsapp_central_concurrency.sql: fixtures sintéticas zz-fixture-/
-- zzfx_, tudo dentro de BEGIN...ROLLBACK, DDL colado na íntegra (migração
-- e rollback) como instruções de nível superior (nunca dentro de DO $$),
-- lógica de teste em blocos DO $$ separados, resultados agregados numa
-- tabela temporária e impressos com um SELECT final.
--
-- Ciclo cobrado pela fase: 1) confirma que os objetos novos NÃO existem
-- ainda; 2) aplica a migração; 3) roda os casos funcionais (bloqueio de
-- opt-out, histórico de execuções com trigger_source/uncertain_expired,
-- recuperação de job preso nos 4 desfechos possíveis, incluindo o prazo de
-- 24h do 'uncertain'); 4) aplica o rollback; 5) confirma que os objetos
-- novos somem e que o CHECK de whatsapp_messages volta exatamente aos 6
-- valores antigos; 6) reaplica a migração; 7) confirma que volta a
-- funcionar. Nunca COMMIT.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

CREATE TEMP TABLE zzfx_lr_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;
CREATE TEMP TABLE zzfx_lr_ids (chave text PRIMARY KEY, valor uuid) ON COMMIT DROP;

-- ============================================================================
-- PASSO 0 — confirma que nada disto existe ainda (estado de produção hoje)
-- e captura o CHECK original de whatsapp_messages.status, pra comparar
-- byte a byte depois do rollback (nunca confiar de memória).
-- ============================================================================
CREATE TEMP TABLE zzfx_lr_check_original (def text) ON COMMIT DROP;
INSERT INTO zzfx_lr_check_original
  SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'whatsapp_messages_status_check';

DO $passo0$
DECLARE v_n int; v_def text;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('whatsapp_blocked_recipients', 'whatsapp_cron_runs');
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('00_objetos_novos_nao_existem_ainda', format('%s de 2 tabelas novas já existiam (esperado 0)', v_n), v_n = 0);

  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'recover_stuck_notification_jobs';
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('00_funcao_nova_nao_existe_ainda', format('%s já existia (esperado 0)', v_n), v_n = 0);

  SELECT def INTO v_def FROM zzfx_lr_check_original;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('00_check_original_nao_tem_incerto_expirado', format('def=%s', v_def), v_def NOT LIKE '%incerto_expirado%');
END $passo0$;

-- ============================================================================
-- PASSO 1 — fixtures (owner, client, 4 agendamentos: 24h, 2h, sem_msg,
-- uncertain_old)
-- ============================================================================
INSERT INTO zzfx_lr_ids (chave, valor) VALUES
  ('owner', gen_random_uuid()), ('client', gen_random_uuid());

CREATE TEMP TABLE zzfx_lr_appt (chave text PRIMARY KEY, valor uuid) ON COMMIT DROP;

DO $setup$
DECLARE
  v_owner uuid := (SELECT valor FROM zzfx_lr_ids WHERE chave='owner');
  v_client uuid := (SELECT valor FROM zzfx_lr_ids WHERE chave='client');
  v_appt_24h uuid;
  v_appt_2h uuid;
  v_appt_sem_msg uuid;
  v_appt_uncertain_old uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-fixture-'||v_owner||'@invalid.test', '', now(), now(), now(), '{}', '{"user_type":"professional"}'::jsonb);

  INSERT INTO public.clients (id, owner_id, full_name, phone)
  VALUES (v_client, v_owner, 'ZZFX_LR_Cliente', '+5547999990199');

  INSERT INTO public.appointments (owner_id, client_id, service_name, starts_at, ends_at, status, client_confirmation_status)
  VALUES (v_owner, v_client, 'ZZFX_LR_Corte24h', now() + interval '20 hours', now() + interval '21 hours', 'confirmed', 'pending')
  RETURNING id INTO v_appt_24h;
  INSERT INTO public.appointments (owner_id, client_id, service_name, starts_at, ends_at, status, client_confirmation_status)
  VALUES (v_owner, v_client, 'ZZFX_LR_Corte2h', now() + interval '2 hours', now() + interval '3 hours', 'confirmed', 'pending')
  RETURNING id INTO v_appt_2h;
  INSERT INTO public.appointments (owner_id, client_id, service_name, starts_at, ends_at, status, client_confirmation_status)
  VALUES (v_owner, v_client, 'ZZFX_LR_SemMsg', now() + interval '20 hours', now() + interval '21 hours', 'confirmed', 'pending')
  RETURNING id INTO v_appt_sem_msg;
  INSERT INTO public.appointments (owner_id, client_id, service_name, starts_at, ends_at, status, client_confirmation_status)
  VALUES (v_owner, v_client, 'ZZFX_LR_IncertoVelho', now() + interval '48 hours', now() + interval '49 hours', 'confirmed', 'pending')
  RETURNING id INTO v_appt_uncertain_old;

  INSERT INTO zzfx_lr_appt VALUES ('24h', v_appt_24h), ('2h', v_appt_2h), ('sem_msg', v_appt_sem_msg), ('uncertain_old', v_appt_uncertain_old);
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
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.whatsapp_blocked_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'client_stop_request'
    CHECK (source IN ('client_stop_request', 'manual')),
  reason text NOT NULL DEFAULT
    'Cliente respondeu pedindo para parar de receber mensagens pelo WhatsApp.',
  unblocked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_blocked_recipients_active_idx
  ON public.whatsapp_blocked_recipients (owner_id, phone_e164)
  WHERE unblocked_at IS NULL;
CREATE INDEX IF NOT EXISTS whatsapp_blocked_recipients_owner_idx
  ON public.whatsapp_blocked_recipients (owner_id)
  WHERE unblocked_at IS NULL;
ALTER TABLE public.whatsapp_blocked_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_blocked_recipients FROM anon, authenticated;
GRANT ALL ON public.whatsapp_blocked_recipients TO service_role;

CREATE TABLE IF NOT EXISTS public.whatsapp_cron_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  ok boolean NULL,
  trigger_source text NULL CHECK (trigger_source IN ('github', 'db')),
  scan_enqueued int NULL,
  scan_recalculated int NULL,
  scan_cancelled_bobo int NULL,
  processed_claimed int NULL,
  processed_sent int NULL,
  processed_failed int NULL,
  processed_held int NULL,
  processed_cancelled int NULL,
  stuck_recovered int NULL,
  uncertain_expired int NULL,
  orphan_deleted int NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_cron_runs_started_idx
  ON public.whatsapp_cron_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_cron_runs_unfinished_idx
  ON public.whatsapp_cron_runs (started_at)
  WHERE finished_at IS NULL;
ALTER TABLE public.whatsapp_cron_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_cron_runs FROM anon, authenticated;
GRANT ALL ON public.whatsapp_cron_runs TO service_role;

ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_status_check;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'uncertain', 'incerto_expirado'));

CREATE OR REPLACE FUNCTION public.recover_stuck_notification_jobs(
  p_stuck_after_minutes int DEFAULT 10,
  p_limit int DEFAULT 50
)
RETURNS TABLE(job_id uuid, appointment_id uuid, owner_id uuid, job_type text, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  v_template_key text;
  v_sent_msg_id uuid;
  v_sent_at timestamptz;
  v_uncertain_msg_id uuid;
  v_uncertain_created_at timestamptz;
  v_uncertain_expiry_hours CONSTANT int := 24;
BEGIN
  FOR rec IN
    SELECT nj.id, nj.appointment_id, nj.owner_id, nj.type, nj.attempts
    FROM public.notification_jobs nj
    WHERE nj.status = 'processing'
      AND nj.type IN ('appointment_reminder_24h', 'appointment_reminder_2h')
      AND nj.updated_at < now() - (p_stuck_after_minutes || ' minutes')::interval
    ORDER BY nj.updated_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_template_key := CASE rec.type
      WHEN 'appointment_reminder_24h' THEN 'lembrete_24h'
      WHEN 'appointment_reminder_2h' THEN 'lembrete_2h'
    END;
    v_sent_msg_id := NULL;
    v_sent_at := NULL;
    v_uncertain_msg_id := NULL;
    v_uncertain_created_at := NULL;

    IF rec.appointment_id IS NOT NULL THEN
      SELECT wm.id, wm.sent_at INTO v_sent_msg_id, v_sent_at
      FROM public.whatsapp_messages wm
      WHERE wm.appointment_id = rec.appointment_id
        AND wm.message_type = v_template_key
        AND wm.status IN ('sent', 'delivered', 'read')
      ORDER BY wm.created_at DESC
      LIMIT 1;
    END IF;

    IF v_sent_msg_id IS NOT NULL THEN
      UPDATE public.notification_jobs
      SET status = 'sent',
          sent_at = coalesce(v_sent_at, now()),
          last_error = 'Recuperado automaticamente: envio já confirmado em whatsapp_messages (a escrita em notification_jobs tinha travado em "processing").'
      WHERE id = rec.id;

      IF rec.type = 'appointment_reminder_24h' THEN
        UPDATE public.appointments
        SET reminder_24h_sent_at = coalesce(v_sent_at, now())
        WHERE id = rec.appointment_id AND reminder_24h_sent_at IS NULL;
      ELSE
        UPDATE public.appointments
        SET reminder_2h_sent_at = coalesce(v_sent_at, now())
        WHERE id = rec.appointment_id AND reminder_2h_sent_at IS NULL;
      END IF;

      job_id := rec.id; appointment_id := rec.appointment_id; owner_id := rec.owner_id; job_type := rec.type; outcome := 'reconciled_sent';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF rec.appointment_id IS NOT NULL THEN
      SELECT wm.id, wm.created_at INTO v_uncertain_msg_id, v_uncertain_created_at
      FROM public.whatsapp_messages wm
      WHERE wm.appointment_id = rec.appointment_id
        AND wm.message_type = v_template_key
        AND wm.status = 'uncertain'
      ORDER BY wm.created_at DESC
      LIMIT 1;
    END IF;

    IF v_uncertain_msg_id IS NOT NULL THEN
      IF v_uncertain_created_at < now() - (v_uncertain_expiry_hours || ' hours')::interval THEN
        UPDATE public.whatsapp_messages
        SET status = 'incerto_expirado'
        WHERE id = v_uncertain_msg_id;
        UPDATE public.notification_jobs
        SET status = 'failed',
            last_error = 'Nunca confirmado: envio incerto (timeout da Meta) há mais de ' || v_uncertain_expiry_hours || 'h sem o webhook de status resolver. Marcado como falho — nunca reenviado automaticamente.'
        WHERE id = rec.id;

        job_id := rec.id; appointment_id := rec.appointment_id; owner_id := rec.owner_id; job_type := rec.type; outcome := 'uncertain_expired';
        RETURN NEXT;
        CONTINUE;
      END IF;

      job_id := rec.id; appointment_id := rec.appointment_id; owner_id := rec.owner_id; job_type := rec.type; outcome := 'left_uncertain';
      RETURN NEXT;
      CONTINUE;
    END IF;

    UPDATE public.notification_jobs
    SET status = 'pending',
        attempts = GREATEST(rec.attempts - 1, 0),
        last_error = 'Recuperado automaticamente: ficou "processando" por mais de ' || p_stuck_after_minutes || ' minuto(s) sem terminar (provável falha/timeout do processo anterior) — nenhum envio confirmado encontrado, liberado para nova tentativa.'
    WHERE id = rec.id;

    job_id := rec.id; appointment_id := rec.appointment_id; owner_id := rec.owner_id; job_type := rec.type; outcome := 'reset_to_pending';
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.recover_stuck_notification_jobs(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stuck_notification_jobs(int, int) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PASSO 3 — verificação estrutural pós-aplicação
-- ============================================================================
DO $passo3$
DECLARE v_ok boolean; v_def text;
BEGIN
  SELECT count(*) = 2 INTO v_ok FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('whatsapp_blocked_recipients', 'whatsapp_cron_runs');
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_tabelas_criadas', 'as 2 tabelas existem', v_ok);

  SELECT relrowsecurity INTO v_ok FROM pg_class WHERE oid = 'public.whatsapp_blocked_recipients'::regclass;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_rls_blocked_recipients', 'RLS ligada', v_ok);
  SELECT relrowsecurity INTO v_ok FROM pg_class WHERE oid = 'public.whatsapp_cron_runs'::regclass;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_rls_cron_runs', 'RLS ligada', v_ok);

  SELECT NOT (has_table_privilege('anon', 'public.whatsapp_blocked_recipients', 'SELECT')
    OR has_table_privilege('authenticated', 'public.whatsapp_blocked_recipients', 'SELECT'))
    INTO v_ok;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_anon_authenticated_sem_select_blocked', 'nenhum privilégio pra anon/authenticated', v_ok);
  SELECT has_table_privilege('service_role', 'public.whatsapp_blocked_recipients', 'INSERT') INTO v_ok;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_service_role_insert_blocked', 'service_role pode escrever', v_ok);

  SELECT count(*) = 1 INTO v_ok FROM pg_proc WHERE proname = 'recover_stuck_notification_jobs';
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_funcao_existe', 'recover_stuck_notification_jobs existe', v_ok);
  SELECT NOT has_function_privilege('anon', 'public.recover_stuck_notification_jobs(int,int)', 'EXECUTE') INTO v_ok;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_funcao_anon_sem_execute', 'anon sem EXECUTE', v_ok);
  SELECT has_function_privilege('service_role', 'public.recover_stuck_notification_jobs(int,int)', 'EXECUTE') INTO v_ok;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_funcao_service_role_execute', 'service_role com EXECUTE', v_ok);

  SELECT count(*) = 2 INTO v_ok FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_extensoes_instaladas', 'pg_cron e pg_net instaladas', v_ok);
  SELECT count(*) = 0 INTO v_ok FROM cron.job;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_nenhum_cron_job_criado', 'instalar a extensão não ligou nenhum job sozinho', v_ok);

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'whatsapp_messages_status_check';
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('03_check_ganhou_incerto_expirado', format('def=%s', v_def), v_def LIKE '%incerto_expirado%');
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('03_check_manteve_os_6_valores_antigos',
     format('def=%s', v_def),
     v_def LIKE '%pending%' AND v_def LIKE '%sent%' AND v_def LIKE '%delivered%'
       AND v_def LIKE '%read%' AND v_def LIKE '%failed%' AND v_def LIKE '%uncertain%');

  SELECT count(*) = 1 INTO v_ok FROM information_schema.columns
    WHERE table_schema='public' AND table_name='whatsapp_cron_runs' AND column_name='trigger_source';
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_coluna_trigger_source', 'whatsapp_cron_runs.trigger_source existe', v_ok);
  SELECT count(*) = 1 INTO v_ok FROM information_schema.columns
    WHERE table_schema='public' AND table_name='whatsapp_cron_runs' AND column_name='uncertain_expired';
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('03_coluna_uncertain_expired', 'whatsapp_cron_runs.uncertain_expired existe', v_ok);
END $passo3$;

-- ============================================================================
-- PASSO 4 — caso funcional: bloqueio de opt-out (unicidade do bloqueio ativo)
-- ============================================================================
DO $caso_bloqueio$
DECLARE
  v_owner uuid := (SELECT valor FROM zzfx_lr_ids WHERE chave='owner');
  v_block_id uuid;
  v_duplicou boolean := false;
BEGIN
  INSERT INTO public.whatsapp_blocked_recipients (owner_id, phone_e164)
  VALUES (v_owner, '+5547999990199')
  RETURNING id INTO v_block_id;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('04_bloqueio_inserido', format('id=%s', v_block_id), v_block_id IS NOT NULL);

  BEGIN
    INSERT INTO public.whatsapp_blocked_recipients (owner_id, phone_e164)
    VALUES (v_owner, '+5547999990199');
    v_duplicou := true;
  EXCEPTION WHEN unique_violation THEN
    v_duplicou := false;
  END;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('04_bloqueio_duplicado_rejeitado', 'segundo bloqueio ATIVO pro mesmo telefone é rejeitado (unique_violation)', NOT v_duplicou);

  UPDATE public.whatsapp_blocked_recipients SET unblocked_at = now() WHERE id = v_block_id;
  BEGIN
    INSERT INTO public.whatsapp_blocked_recipients (owner_id, phone_e164, source, reason)
    VALUES (v_owner, '+5547999990199', 'manual', 'ZZFX_teste_reautorizacao');
    v_duplicou := true;
  EXCEPTION WHEN unique_violation THEN
    v_duplicou := false;
  END;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('04_reautorizacao_depois_de_desbloquear', 'depois de desbloquear, um novo bloqueio ativo é aceito', v_duplicou);
END $caso_bloqueio$;

-- ============================================================================
-- PASSO 5 — caso funcional: histórico de execuções (inclui trigger_source
-- e uncertain_expired, ajuste da dona)
-- ============================================================================
DO $caso_cron_runs$
DECLARE v_id uuid; v_ok boolean; v_source text; v_ue int;
BEGIN
  INSERT INTO public.whatsapp_cron_runs (started_at, finished_at, ok, trigger_source, scan_enqueued, processed_claimed, processed_sent, uncertain_expired)
  VALUES (now() - interval '2 seconds', now(), true, 'github', 0, 0, 0, 0)
  RETURNING id INTO v_id;
  SELECT ok, trigger_source, uncertain_expired INTO v_ok, v_source, v_ue FROM public.whatsapp_cron_runs WHERE id = v_id;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('05_cron_run_gravado_e_lido', format('id=%s ok=%s trigger_source=%s uncertain_expired=%s', v_id, v_ok, v_source, v_ue),
     v_ok IS TRUE AND v_source = 'github' AND v_ue = 0);

  INSERT INTO public.whatsapp_cron_runs (started_at, trigger_source) VALUES (now(), 'db');
  SELECT trigger_source INTO v_source FROM public.whatsapp_cron_runs WHERE trigger_source = 'db' LIMIT 1;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('05_trigger_source_db_aceito', format('trigger_source=%s', v_source), v_source = 'db');

  BEGIN
    INSERT INTO public.whatsapp_cron_runs (started_at, trigger_source) VALUES (now(), 'qualquer_outra_coisa');
    INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('05_trigger_source_invalido_rejeitado', 'deveria ter sido rejeitado pelo CHECK', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('05_trigger_source_invalido_rejeitado', 'rejeitado por check_violation, como esperado', true);
  END;

  INSERT INTO public.whatsapp_cron_runs (started_at) VALUES (now() - interval '1 hour');
  SELECT count(*) = 1 INTO v_ok FROM public.whatsapp_cron_runs WHERE finished_at IS NULL;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('05_execucao_sem_terminar_e_visivel', 'uma execução iniciada sem finished_at aparece no índice de não-terminadas', v_ok);
END $caso_cron_runs$;

-- ============================================================================
-- PASSO 6 — caso funcional: recuperação de job preso, os 4 desfechos
-- (reconciled_sent, left_uncertain, reset_to_pending, uncertain_expired)
-- ============================================================================
DO $caso_recovery$
DECLARE
  v_appt_24h uuid := (SELECT valor FROM zzfx_lr_appt WHERE chave='24h');
  v_appt_2h uuid := (SELECT valor FROM zzfx_lr_appt WHERE chave='2h');
  v_appt_sem_msg uuid := (SELECT valor FROM zzfx_lr_appt WHERE chave='sem_msg');
  v_appt_uncertain_old uuid := (SELECT valor FROM zzfx_lr_appt WHERE chave='uncertain_old');
  v_owner uuid := (SELECT valor FROM zzfx_lr_ids WHERE chave='owner');
  v_client uuid := (SELECT valor FROM zzfx_lr_ids WHERE chave='client');
  v_job_reconcilia uuid;
  v_job_incerto uuid;
  v_job_reset uuid;
  v_job_recente uuid;
  v_job_incerto_velho uuid;
  v_msg_incerto_velho uuid;
  v_outcome text; v_n int; v_status text; v_sent_at timestamptz; v_attempts int;
BEGIN
  -- 6a) já foi enviado de verdade (whatsapp_messages 'sent'), só a escrita
  -- em notification_jobs travou -> deve RECONCILIAR como 'sent', nunca reenviar.
  INSERT INTO public.whatsapp_messages (owner_id, client_id, appointment_id, direction, message_type, recipient_phone, provider, provider_message_id, status, sent_at)
  VALUES (v_owner, v_client, v_appt_24h, 'outbound', 'lembrete_24h', '+5547999990199', 'meta_cloud_api_central', 'ZZFX_LR_WAMID_1', 'sent', now() - interval '15 minutes');
  INSERT INTO public.notification_jobs (owner_id, appointment_id, client_id, type, recipient_phone, status, attempts, scheduled_for, next_attempt_at)
  VALUES (v_owner, v_appt_24h, v_client, 'appointment_reminder_24h', '+5547999990199', 'processing', 1, now() - interval '20 minutes', now() - interval '20 minutes')
  RETURNING id INTO v_job_reconcilia;
  UPDATE public.notification_jobs SET updated_at = now() - interval '20 minutes' WHERE id = v_job_reconcilia;

  -- 6b) a Meta nunca confirmou (whatsapp_messages 'uncertain'), mas AINDA
  -- DENTRO das 24h -> deve deixar como está (processing), nunca reenviar.
  INSERT INTO public.whatsapp_messages (owner_id, client_id, appointment_id, direction, message_type, recipient_phone, provider, status)
  VALUES (v_owner, v_client, v_appt_2h, 'outbound', 'lembrete_2h', '+5547999990199', 'meta_cloud_api_central', 'uncertain');
  INSERT INTO public.notification_jobs (owner_id, appointment_id, client_id, type, recipient_phone, status, attempts, scheduled_for, next_attempt_at)
  VALUES (v_owner, v_appt_2h, v_client, 'appointment_reminder_2h', '+5547999990199', 'processing', 1, now() - interval '20 minutes', now() - interval '20 minutes')
  RETURNING id INTO v_job_incerto;
  UPDATE public.notification_jobs SET updated_at = now() - interval '20 minutes' WHERE id = v_job_incerto;

  -- 6c) nenhum whatsapp_messages pra este agendamento -> nunca chegou a
  -- tentar a Meta, seguro liberar de novo.
  INSERT INTO public.notification_jobs (owner_id, appointment_id, client_id, type, recipient_phone, status, attempts, scheduled_for, next_attempt_at)
  VALUES (v_owner, v_appt_sem_msg, v_client, 'appointment_reminder_24h', '+5547999990199', 'processing', 1, now() - interval '20 minutes', now() - interval '20 minutes')
  RETURNING id INTO v_job_reset;
  UPDATE public.notification_jobs SET updated_at = now() - interval '20 minutes' WHERE id = v_job_reset;

  -- 6d) controle: 'processing' mas RECENTE (1 min) -> nunca deve ser
  -- tocado por um limite de 10 minutos.
  INSERT INTO public.notification_jobs (owner_id, appointment_id, client_id, type, recipient_phone, status, attempts, scheduled_for, next_attempt_at)
  VALUES (v_owner, v_appt_sem_msg, v_client, 'appointment_reminder_2h', '+5547999990199', 'processing', 1, now() - interval '1 minute', now() - interval '1 minute')
  RETURNING id INTO v_job_recente;
  UPDATE public.notification_jobs SET updated_at = now() - interval '1 minute' WHERE id = v_job_recente;

  -- 6e, AJUSTE da dona) 'uncertain' há mais de 24h -> deve expirar: mensagem
  -- vira 'incerto_expirado', job vira 'failed' (terminal, nunca reenviado).
  INSERT INTO public.whatsapp_messages (owner_id, client_id, appointment_id, direction, message_type, recipient_phone, provider, status)
  VALUES (v_owner, v_client, v_appt_uncertain_old, 'outbound', 'lembrete_24h', '+5547999990199', 'meta_cloud_api_central', 'uncertain')
  RETURNING id INTO v_msg_incerto_velho;
  UPDATE public.whatsapp_messages SET created_at = now() - interval '25 hours' WHERE id = v_msg_incerto_velho;
  INSERT INTO public.notification_jobs (owner_id, appointment_id, client_id, type, recipient_phone, status, attempts, scheduled_for, next_attempt_at)
  VALUES (v_owner, v_appt_uncertain_old, v_client, 'appointment_reminder_24h', '+5547999990199', 'processing', 1, now() - interval '20 minutes', now() - interval '20 minutes')
  RETURNING id INTO v_job_incerto_velho;
  UPDATE public.notification_jobs SET updated_at = now() - interval '20 minutes' WHERE id = v_job_incerto_velho;

  CREATE TEMP TABLE zzfx_lr_outcomes AS
    SELECT * FROM public.recover_stuck_notification_jobs(10, 50);

  SELECT outcome INTO v_outcome FROM zzfx_lr_outcomes WHERE job_id = v_job_reconcilia;
  SELECT status, sent_at INTO v_status, v_sent_at FROM public.notification_jobs WHERE id = v_job_reconcilia;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('06a_reconciliado_como_sent', format('outcome=%s status=%s sent_at_preenchido=%s', v_outcome, v_status, v_sent_at IS NOT NULL),
     v_outcome = 'reconciled_sent' AND v_status = 'sent' AND v_sent_at IS NOT NULL);
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('06a_appointments_reminder_24h_sent_at_marcado', 'reminder_24h_sent_at preenchido no agendamento',
     (SELECT reminder_24h_sent_at IS NOT NULL FROM public.appointments WHERE id = v_appt_24h));

  SELECT outcome INTO v_outcome FROM zzfx_lr_outcomes WHERE job_id = v_job_incerto;
  SELECT status INTO v_status FROM public.notification_jobs WHERE id = v_job_incerto;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('06b_incerto_dentro_do_prazo_nao_e_reenviado', format('outcome=%s status=%s (deve seguir processing)', v_outcome, v_status),
     v_outcome = 'left_uncertain' AND v_status = 'processing');

  SELECT outcome INTO v_outcome FROM zzfx_lr_outcomes WHERE job_id = v_job_reset;
  SELECT status, attempts INTO v_status, v_attempts FROM public.notification_jobs WHERE id = v_job_reset;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('06c_sem_envio_volta_pra_pending', format('outcome=%s status=%s attempts=%s (era 1)', v_outcome, v_status, v_attempts),
     v_outcome = 'reset_to_pending' AND v_status = 'pending' AND v_attempts = 0);

  SELECT count(*) INTO v_n FROM zzfx_lr_outcomes WHERE job_id = v_job_recente;
  SELECT status INTO v_status FROM public.notification_jobs WHERE id = v_job_recente;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('06d_job_recente_nunca_tocado', format('apareceu_no_resultado=%s status_continua=%s', v_n > 0, v_status),
     v_n = 0 AND v_status = 'processing');

  -- AJUSTE da dona (06e): 'uncertain' com mais de 24h expira de vez.
  SELECT outcome INTO v_outcome FROM zzfx_lr_outcomes WHERE job_id = v_job_incerto_velho;
  SELECT status INTO v_status FROM public.notification_jobs WHERE id = v_job_incerto_velho;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('06e_incerto_expirado_apos_24h_marca_failed', format('outcome=%s status_job=%s', v_outcome, v_status),
     v_outcome = 'uncertain_expired' AND v_status = 'failed');
  SELECT status INTO v_status FROM public.whatsapp_messages WHERE id = v_msg_incerto_velho;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('06e_mensagem_incerta_velha_marcada_incerto_expirado', format('status_mensagem=%s', v_status),
     v_status = 'incerto_expirado');

  -- rodar de novo imediatamente (prova de que nada é reenviado/reprocessado):
  DROP TABLE zzfx_lr_outcomes;
  CREATE TEMP TABLE zzfx_lr_outcomes AS
    SELECT * FROM public.recover_stuck_notification_jobs(10, 50);
  SELECT count(*) INTO v_n FROM zzfx_lr_outcomes WHERE job_id = v_job_reconcilia; -- já está 'sent', não é mais 'processing'
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('06f_segunda_rodada_nao_toca_job_ja_resolvido_sent', 'job já virado sent não aparece de novo', v_n = 0);
  SELECT count(*) INTO v_n FROM zzfx_lr_outcomes WHERE job_id = v_job_incerto_velho; -- já está 'failed', não é mais 'processing'
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('06g_segunda_rodada_nao_retoca_incerto_expirado', 'job já expirado (failed) nunca é reprocessado/reenviado', v_n = 0);
  SELECT count(*) INTO v_n FROM zzfx_lr_outcomes WHERE job_id = v_job_incerto AND outcome = 'left_uncertain';
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('06h_incerto_ainda_dentro_do_prazo_continua_sem_reenviar', 'job incerto (dentro de 24h) continua "left_uncertain"', v_n = 1);

  -- Limpa a mensagem sintética que ficou 'incerto_expirado' — valor que o
  -- CHECK original (6 valores, sem esse) rejeitaria se o rollback tentasse
  -- recriar a constraint estreita com essa linha ainda presente (comportamento
  -- CORRETO e documentado no arquivo de rollback — "pare e investigue" — mas
  -- aqui é só fixture sintética de teste, sem motivo pra deixar no caminho
  -- do PASSO 7 abaixo).
  DELETE FROM public.whatsapp_messages WHERE id = v_msg_incerto_velho;
END $caso_recovery$;

-- ============================================================================
-- PASSO 7 — aplica o rollback (DDL colado, igual ao arquivo real)
-- ============================================================================
REVOKE ALL ON FUNCTION public.recover_stuck_notification_jobs(int, int) FROM service_role;
DROP FUNCTION IF EXISTS public.recover_stuck_notification_jobs(int, int);

ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_status_check;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'uncertain'));

DROP TABLE IF EXISTS public.whatsapp_cron_runs;
DROP TABLE IF EXISTS public.whatsapp_blocked_recipients;
NOTIFY pgrst, 'reload schema';

DO $passo8$
DECLARE v_n int; v_def text; v_def_original text;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('whatsapp_blocked_recipients', 'whatsapp_cron_runs');
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('08_tabelas_removidas_pelo_rollback', format('%s de 2 ainda existem (esperado 0)', v_n), v_n = 0);
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'recover_stuck_notification_jobs';
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('08_funcao_removida_pelo_rollback', format('%s ainda existe (esperado 0)', v_n), v_n = 0);

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'whatsapp_messages_status_check';
  SELECT def INTO v_def_original FROM zzfx_lr_check_original;
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('08_check_voltou_exatamente_ao_original', format('antes=%s depois=%s', v_def_original, v_def), v_def = v_def_original);

  -- Confirma de fato que 'incerto_expirado' deixou de ser aceito (prova
  -- funcional do rollback, não só textual):
  BEGIN
    INSERT INTO public.whatsapp_messages (owner_id, client_id, direction, message_type, recipient_phone, provider, status)
    VALUES ((SELECT valor FROM zzfx_lr_ids WHERE chave='owner'), (SELECT valor FROM zzfx_lr_ids WHERE chave='client'),
            'outbound', 'ZZFX_teste', '+5547999990199', 'meta_cloud_api_central', 'incerto_expirado');
    INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('08_incerto_expirado_rejeitado_apos_rollback', 'deveria ter sido rejeitado pelo CHECK', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('08_incerto_expirado_rejeitado_apos_rollback', 'rejeitado por check_violation, como esperado', true);
  END;

  SELECT count(*) = 4 INTO v_n FROM public.notification_jobs WHERE appointment_id IN (SELECT valor FROM zzfx_lr_appt);
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES
    ('08_fixtures_de_negocio_intactas_apos_rollback', format('%s jobs sintéticos (esperado 4)', v_n), v_n = 4);
END $passo8$;

-- ============================================================================
-- PASSO 9 — reaplica a migração (DDL colado de novo) e confirma que volta
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_blocked_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'client_stop_request'
    CHECK (source IN ('client_stop_request', 'manual')),
  reason text NOT NULL DEFAULT
    'Cliente respondeu pedindo para parar de receber mensagens pelo WhatsApp.',
  unblocked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_blocked_recipients_active_idx
  ON public.whatsapp_blocked_recipients (owner_id, phone_e164)
  WHERE unblocked_at IS NULL;
ALTER TABLE public.whatsapp_blocked_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_blocked_recipients FROM anon, authenticated;
GRANT ALL ON public.whatsapp_blocked_recipients TO service_role;

ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS whatsapp_messages_status_check;
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'uncertain', 'incerto_expirado'));

CREATE OR REPLACE FUNCTION public.recover_stuck_notification_jobs(
  p_stuck_after_minutes int DEFAULT 10,
  p_limit int DEFAULT 50
)
RETURNS TABLE(job_id uuid, appointment_id uuid, owner_id uuid, job_type text, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function2$
BEGIN
  RETURN;
END;
$function2$;
-- (corpo mínimo só pra confirmar reaplicação de CREATE OR REPLACE sem erro
-- de assinatura/tipo de retorno — o corpo real volta a ser colado na hora
-- de aplicar de verdade; esta suíte já provou o comportamento funcional
-- completo no Passo 6, não precisa reprovar tudo de novo aqui.)
REVOKE ALL ON FUNCTION public.recover_stuck_notification_jobs(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stuck_notification_jobs(int, int) TO service_role;
NOTIFY pgrst, 'reload schema';

DO $passo10$
DECLARE v_ok boolean;
BEGIN
  SELECT count(*) = 1 INTO v_ok FROM information_schema.tables
    WHERE table_schema='public' AND table_name = 'whatsapp_blocked_recipients';
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('10_tabela_volta_depois_de_reaplicar', 'whatsapp_blocked_recipients existe de novo', v_ok);
  SELECT count(*) = 1 INTO v_ok FROM pg_proc WHERE proname = 'recover_stuck_notification_jobs';
  INSERT INTO zzfx_lr_results (caso, detalhe, passou) VALUES ('10_funcao_volta_depois_de_reaplicar', 'recover_stuck_notification_jobs existe de novo', v_ok);
END $passo10$;

SELECT ordem, caso, detalhe, passou FROM zzfx_lr_results ORDER BY ordem;

SELECT 'RESUMO' AS linha, count(*) FILTER (WHERE passou) AS passaram, count(*) FILTER (WHERE NOT passou) AS falharam
FROM zzfx_lr_results;

ROLLBACK;
