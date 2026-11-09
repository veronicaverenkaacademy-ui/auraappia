-- K1a-2, ponto 1 do pedido de autorização (09/11/2026): prova de que o CHECK
-- novo em team_members.avatar_url (team_members_avatar_url_check, da
-- migração 20261109020000_portal_personalization.sql, já aplicada) não
-- quebra nenhum dos 3 pontos reais do app que escrevem nessa coluna:
--   1. createTeamMember (team.functions.ts) — INSERT que NUNCA inclui
--      avatar_url (fica no DEFAULT NULL).
--   2. updateTeamMember (team.ts, usado por equipe.$id.tsx) — UPDATE cujo
--      patch só inclui os campos que a tela de edição expõe (não existe
--      controle de avatar nessa tela hoje — avatar_url nunca entra no
--      patch).
--   3. deleteStaffAccount (account-deletion.functions.ts) — UPDATE que
--      escreve avatar_url = NULL explicitamente (anonimização).
--
-- Mesmo padrão de supabase/tests/portal_personalization.sql: uma
-- transação, NUNCA COMMIT, dados sintéticos zz-fixture-/zzfx-.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TEMP TABLE zzfx_k1a2_results (ordem serial, caso text, detalhe text, passou boolean) ON COMMIT DROP;

DO $run$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_staff_user uuid := gen_random_uuid();
  v_member_id uuid;
  v_avatar text;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_owner||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb),
    (v_staff_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-fixture-'||v_staff_user||'@invalid.test', '', now(), now(), now(), '{}', '{}'::jsonb);

  -- ===== 1: createTeamMember — INSERT sem avatar_url nenhum (fica NULL) =====
  INSERT INTO public.team_members (owner_id, user_id, full_name, phone, email, role_title, profession, agenda_color, commission_type, commission_value, monthly_goal, status)
  VALUES (v_owner, v_staff_user, 'ZZFX Colaboradora K1a2', null, null, 'Cargo', 'Profissão', '#5C3A2E', 'percent', 0, 0, 'active')
  RETURNING id, avatar_url INTO v_member_id, v_avatar;
  INSERT INTO zzfx_k1a2_results (caso, detalhe, passou) VALUES
    ('1_create_team_member_sem_avatar_url_ok', format('avatar_url=%s', v_avatar), v_avatar IS NULL);

  -- ===== 2: updateTeamMember — UPDATE só com os campos que a tela expõe,
  -- nunca avatar_url (confirma que a coluna fica como estava, sem precisar
  -- re-enviar o valor) =====
  UPDATE public.team_members
  SET full_name = 'ZZFX Colaboradora K1a2 (editada)', role_title = 'Novo cargo', phone = '+5511999990000'
  WHERE id = v_member_id;
  SELECT avatar_url INTO v_avatar FROM public.team_members WHERE id = v_member_id;
  INSERT INTO zzfx_k1a2_results (caso, detalhe, passou) VALUES
    ('2_update_team_member_sem_avatar_url_no_patch_ok', format('avatar_url=%s', v_avatar), v_avatar IS NULL);

  -- ===== 3: deleteStaffAccount — UPDATE que escreve avatar_url = NULL
  -- explicitamente (anonimização) =====
  UPDATE public.team_members
  SET full_name = 'Ex-colaboradora', phone = null, email = null, role_title = null, profession = null, avatar_url = null, bio = null, instagram = null
  WHERE id = v_member_id;
  SELECT avatar_url INTO v_avatar FROM public.team_members WHERE id = v_member_id;
  INSERT INTO zzfx_k1a2_results (caso, detalhe, passou) VALUES
    ('3_delete_staff_account_avatar_url_null_explicito_ok', format('avatar_url=%s', v_avatar), v_avatar IS NULL);

  -- ===== 4 (controle, não é um fluxo real): confirma que o CHECK de fato
  -- existe e rejeita um valor fora do formato aceito — se este caso
  -- "passar" sem erro, o CHECK não está mais lá e os 3 casos acima deixariam
  -- de ser uma prova de nada. =====
  BEGIN
    UPDATE public.team_members SET avatar_url = 'nao-e-url-nem-caminho-valido' WHERE id = v_member_id;
    INSERT INTO zzfx_k1a2_results (caso, detalhe, passou) VALUES
      ('4_controle_check_existe_valor_invalido_rejeitado', 'PERMITIDO (CHECK não está mais ativo!)', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO zzfx_k1a2_results (caso, detalhe, passou) VALUES
      ('4_controle_check_existe_valor_invalido_rejeitado', 'erro:check_violation (esperado)', true);
  END;

  -- ===== 5 (controle): URL https:// antiga continua aceita (compatibilidade
  -- com qualquer avatar_url pré-existente nesse formato) =====
  UPDATE public.team_members SET avatar_url = 'https://exemplo.invalid/avatar.png' WHERE id = v_member_id;
  SELECT avatar_url INTO v_avatar FROM public.team_members WHERE id = v_member_id;
  INSERT INTO zzfx_k1a2_results (caso, detalhe, passou) VALUES
    ('5_controle_https_antigo_continua_aceito', format('avatar_url=%s', v_avatar), v_avatar = 'https://exemplo.invalid/avatar.png');
END $run$;

SELECT caso, detalhe, passou FROM zzfx_k1a2_results ORDER BY ordem;

DO $final_check$
DECLARE v_falhas int;
BEGIN
  SELECT count(*) INTO v_falhas FROM zzfx_k1a2_results WHERE passou IS NOT TRUE;
  IF v_falhas > 0 THEN
    RAISE EXCEPTION 'SUÍTE FALHOU: % caso(s) não passou(aram) — ver SELECT acima', v_falhas;
  END IF;
END $final_check$;

ROLLBACK;
