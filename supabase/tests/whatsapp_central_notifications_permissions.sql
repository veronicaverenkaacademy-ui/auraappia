-- Item 3k da auditoria de testes do WhatsApp central: permissões de
-- app_notifications. Padrão ROLLBACK (como marketing_permissions.sql,
-- versão simplificada). Fixtures sintéticas com prefixo ZZFX_ e e-mail
-- zz-fixture-...@invalid.test (sentinela), nada persiste.
--
-- ACHADO REAL DESTA RODADA (CONFIRMADO NO BANCO, rodado em 2026-10-25):
-- `authenticated`/`anon` NÃO têm NENHUM GRANT em public.app_notifications
-- hoje (confirmado via information_schema.role_table_grants — zero linhas
-- pra esses dois papéis). Isso significa que a tabela é, na prática,
-- 100% INACESSÍVEL para qualquer usuária real via context.supabase (o
-- cliente que respeita RLS, usado por notifications.functions.ts) — toda
-- chamada a listNotifications/getUnreadNotificationsCount/marcar como lida
-- falha com 42501 "permission denied" ANTES da RLS nem ser avaliada. A
-- política RLS em si (app_notifications_select/app_notifications_mark_read,
-- migration 20261024191212) está CORRETA — provado abaixo concedendo o
-- GRANT faltante DENTRO desta mesma transação (GRANT é transacional no
-- Postgres, desfeito pelo ROLLBACK final, nunca persiste) só pra isolar e
-- testar a lógica da policy, independente do bug de GRANT.
--
-- Por que isso não quebrou visivelmente: use-unread-notifications-count.ts
-- trata isError como "sem ponto no sino" (nunca propaga o erro pra tela) —
-- então o sino simplesmente nunca mostra aviso algum pra ninguém, o que é
-- indistinguível visualmente de "não há avisos ainda". Avaliação: PROIBIDO
-- corrigir nesta sessão (exige GRANT real no banco = escrita persistente,
-- fora do autorizado aqui) — reportado, não corrigido. Remédio sugerido:
-- nova migration com
--   GRANT SELECT, UPDATE ON public.app_notifications TO authenticated;
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- PARTE A: confirma o estado REAL de produção agora (sem nenhum ajuste).
CREATE TEMP TABLE zzfx_grants_antes AS
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='app_notifications' AND grantee IN ('anon','authenticated');

-- PARTE B: concede DENTRO desta transação (nunca persiste) só pra isolar
-- e testar a LÓGICA das policies em si.
GRANT SELECT, UPDATE ON public.app_notifications TO authenticated;

CREATE TEMP TABLE zzfx_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO zzfx_ids (k, v) VALUES
  ('owner_a', gen_random_uuid()), ('prof_a', gen_random_uuid()),
  ('outra_prof_a', gen_random_uuid()), ('owner_b', gen_random_uuid());

DO $setup$
DECLARE
  v_owner_a uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_al_sem_agenda uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  SELECT u.v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'zz-fixture-'||u.v||'@invalid.test', '', now(), now(), now(), '{}',
         CASE WHEN u.k IN ('owner_a','owner_b') THEN '{"user_type":"professional"}'::jsonb ELSE '{}'::jsonb END
  FROM zzfx_ids u WHERE u.k IN ('owner_a','prof_a','outra_prof_a','owner_b');

  INSERT INTO public.access_levels (owner_id, name) VALUES (v_owner_a, 'ZZFX_SemAgenda') RETURNING id INTO v_al_sem_agenda;
  INSERT INTO public.access_level_permissions (access_level_id, resource, action, allowed) VALUES (v_al_sem_agenda, 'agenda', 'view', false);

  INSERT INTO public.team_members (owner_id, user_id, access_level_id, status, full_name)
  SELECT v_owner_a, (SELECT v FROM zzfx_ids WHERE k='prof_a'),
         (SELECT id FROM public.access_levels WHERE owner_id=v_owner_a AND name='Gerente' LIMIT 1), 'active', 'ZZFX_Prof'
  UNION ALL
  SELECT v_owner_a, (SELECT v FROM zzfx_ids WHERE k='outra_prof_a'), v_al_sem_agenda, 'active', 'ZZFX_OutraProf';
END $setup$;

DO $sentinel$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM auth.users WHERE email LIKE 'zz-fixture-%@invalid.test';
  IF n <> 4 THEN RAISE EXCEPTION 'SENTINELA: esperado 4, achei %', n; END IF;
END $sentinel$;

CREATE TEMP TABLE zzfx_notif (id uuid) ON COMMIT DROP;
INSERT INTO public.app_notifications (owner_id, recipient_user_id, kind, title, body)
VALUES ((SELECT v FROM zzfx_ids WHERE k='owner_a'), (SELECT v FROM zzfx_ids WHERE k='prof_a'), 'client_cancelled', 'ZZFX_Teste', 'ZZFX corpo');
INSERT INTO zzfx_notif (id) SELECT id FROM public.app_notifications WHERE title = 'ZZFX_Teste';

CREATE TEMP TABLE zzfx_results (papel text PRIMARY KEY, pode_ver boolean, pode_alterar boolean) ON COMMIT DROP;

-- Schema temp só dá USAGE pra quem criou (postgres) — sem isto, SET LOCAL
-- ROLE authenticated/anon dentro do DO block abaixo não conseguiria nem
-- ler nem escrever nas tabelas TEMP (mesmo achado documentado em
-- marketing_permissions.sql).
DO $grant$
DECLARE v_schema text := (SELECT pg_my_temp_schema()::regnamespace::text);
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %s TO anon, authenticated', v_schema);
  EXECUTE format('GRANT ALL ON %s.zzfx_results, %s.zzfx_ids, %s.zzfx_notif TO anon, authenticated', v_schema, v_schema, v_schema);
END $grant$;

DO $run$
DECLARE
  v_notif_id uuid := (SELECT id FROM zzfx_notif LIMIT 1);
  v_owner_a uuid := (SELECT v FROM zzfx_ids WHERE k='owner_a');
  v_prof_a uuid := (SELECT v FROM zzfx_ids WHERE k='prof_a');
  v_outra_prof_a uuid := (SELECT v FROM zzfx_ids WHERE k='outra_prof_a');
  v_owner_b uuid := (SELECT v FROM zzfx_ids WHERE k='owner_b');
  v_ok boolean; v_cnt int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  PERFORM set_config('request.jwt.claim.sub', v_owner_a::text, true);
  SELECT count(*) INTO v_cnt FROM public.app_notifications WHERE id = v_notif_id;
  INSERT INTO zzfx_results VALUES ('dona', v_cnt = 1, NULL);
  UPDATE public.app_notifications SET read_at = now() WHERE id = v_notif_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  UPDATE zzfx_results SET pode_alterar = (v_cnt = 1) WHERE papel = 'dona';
  UPDATE public.app_notifications SET read_at = NULL WHERE id = v_notif_id;

  PERFORM set_config('request.jwt.claim.sub', v_prof_a::text, true);
  SELECT count(*) INTO v_cnt FROM public.app_notifications WHERE id = v_notif_id;
  INSERT INTO zzfx_results VALUES ('profissional_destinataria', v_cnt = 1, NULL);
  UPDATE public.app_notifications SET read_at = now() WHERE id = v_notif_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  UPDATE zzfx_results SET pode_alterar = (v_cnt = 1) WHERE papel = 'profissional_destinataria';
  UPDATE public.app_notifications SET read_at = NULL WHERE id = v_notif_id;

  PERFORM set_config('request.jwt.claim.sub', v_outra_prof_a::text, true);
  SELECT count(*) INTO v_cnt FROM public.app_notifications WHERE id = v_notif_id;
  INSERT INTO zzfx_results VALUES ('outra_profissional_sem_permissao', v_cnt = 1, NULL);
  UPDATE public.app_notifications SET read_at = now() WHERE id = v_notif_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  UPDATE zzfx_results SET pode_alterar = (v_cnt = 1) WHERE papel = 'outra_profissional_sem_permissao';

  PERFORM set_config('request.jwt.claim.sub', v_owner_b::text, true);
  SELECT count(*) INTO v_cnt FROM public.app_notifications WHERE id = v_notif_id;
  INSERT INTO zzfx_results VALUES ('outro_salao', v_cnt = 1, NULL);
  UPDATE public.app_notifications SET read_at = now() WHERE id = v_notif_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  UPDATE zzfx_results SET pode_alterar = (v_cnt = 1) WHERE papel = 'outro_salao';

  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    SELECT count(*) INTO v_cnt FROM public.app_notifications WHERE id = v_notif_id;
    v_ok := v_cnt = 1;
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  INSERT INTO zzfx_results VALUES ('anon_sem_login', v_ok, NULL);
  RESET ROLE;
END $run$;

-- Resultado real desta rodada (2026-10-25): zzfx_grants_antes = 0 linhas
-- (achado confirmado); zzfx_results com o GRANT temporário =
--   dona: ver=t alterar=t | profissional_destinataria: ver=t alterar=t
--   outra_profissional_sem_permissao: ver=f alterar=f | outro_salao: ver=f alterar=f
--   anon_sem_login: ver=f
-- — a POLICY está certa; falta só o GRANT real em produção.
SELECT 'GRANTS_REAIS_ANTES_authenticated_anon' AS secao, grantee AS a, privilege_type::text AS b FROM zzfx_grants_antes
UNION ALL
SELECT 'RESULTADO_POLICY_COM_GRANT_TEMPORARIO', papel, format('ver=%s alterar=%s', pode_ver, pode_alterar) FROM zzfx_results
ORDER BY 1, 2;

ROLLBACK;
