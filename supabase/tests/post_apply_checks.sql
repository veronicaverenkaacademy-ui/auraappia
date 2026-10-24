-- Fase 1 — checagens pós-aplicação (SOMENTE LEITURA, nunca escreve nada).
-- Rodar logo depois de aplicar as 2 migrations da Fase 1 em produção
-- (runbook, Item 10). Cada linha do resultado é um check independente:
-- status 'OK' ou 'FALHOU', com o detalhe do que foi encontrado. Não altera
-- nenhum dado, não precisa de BEGIN/ROLLBACK (mas não faz mal rodar assim).
--
-- Critério de aceite do runbook: TODAS as linhas devem vir 'OK'. Qualquer
-- 'FALHOU' é motivo de abortar antes de publicar o código novo do app
-- (ver Item 10 em docs/fase1-progress.md para os critérios de reversão).

WITH checks AS (

  -- 1. Colunas novas existem com o tipo/nullability certos
  SELECT 'colunas' AS grupo, 'automations.deleted_at' AS item,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='automations' AND column_name='deleted_at'
        AND data_type='timestamp with time zone' AND is_nullable='YES')
      THEN 'OK' ELSE 'FALHOU' END AS status
  UNION ALL
  SELECT 'colunas', 'automations.is_system',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='automations' AND column_name='is_system'
        AND data_type='boolean' AND is_nullable='NO')
      THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'colunas', 'journeys.deleted_at',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='journeys' AND column_name='deleted_at'
        AND data_type='timestamp with time zone' AND is_nullable='YES')
      THEN 'OK' ELSE 'FALHOU' END

  -- 2. RLS ativa nas 4 tabelas
  UNION ALL
  SELECT 'rls_ativa', relname,
    CASE WHEN relrowsecurity THEN 'OK' ELSE 'FALHOU' END
  FROM pg_class WHERE relname IN ('automations','journeys','journey_steps','marketing_sends')
    AND relnamespace = 'public'::regnamespace

  -- 3. Policies staff_* esperadas (nomes exatos, uma linha por policy)
  UNION ALL
  SELECT 'policy_existe', esperado,
    CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE tablename=tabela AND policyname=esperado)
      THEN 'OK' ELSE 'FALHOU' END
  FROM (VALUES
    ('automations','automations_staff_select'), ('automations','automations_staff_insert'), ('automations','automations_staff_update'),
    ('journeys','journeys_staff_select'), ('journeys','journeys_staff_insert'), ('journeys','journeys_staff_update'),
    ('journey_steps','journey_steps_staff_select'), ('journey_steps','journey_steps_staff_insert'),
    ('journey_steps','journey_steps_staff_update'), ('journey_steps','journey_steps_staff_delete'),
    ('marketing_sends','marketing_sends_staff_select')
  ) AS v(tabela, esperado)

  -- 4. Ausência de policy de DELETE pra authenticated em automations/journeys
  -- (journey_steps É esperado ter — deleteJourneyStep físico, fora de escopo da Fase 1)
  UNION ALL
  SELECT 'sem_policy_delete', tablename,
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename=t.tablename AND cmd='DELETE')
      THEN 'OK' ELSE 'FALHOU' END
  FROM (VALUES ('automations'), ('journeys')) AS t(tablename)

  -- 5. Triggers na ordem certa (nome alfabético = ordem de disparo do Postgres)
  UNION ALL
  SELECT 'trigger_existe', tabela||':'||esperado,
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=esperado AND NOT tgisinternal
         AND tgrelid = (tabela||'')::regclass)
      THEN 'OK' ELSE 'FALHOU' END
  FROM (VALUES
    ('public.automations','trg_05_automations_normalize_delete'),
    ('public.automations','trg_10_automations_protect_immutable'),
    ('public.automations','trg_20_automations_protect_system'),
    ('public.automations','trg_21_automations_protect_system_delete'),
    ('public.automations','trg_25_automations_require_delete_permission'),
    ('public.automations','trg_30_automations_block_edit_after_delete'),
    ('public.journeys','trg_05_journeys_normalize_delete'),
    ('public.journeys','trg_10_journeys_protect_immutable'),
    ('public.journeys','trg_30_journeys_block_edit_after_delete'),
    ('public.journey_steps','trg_15_journey_steps_owner_matches_parent'),
    ('public.journey_steps','trg_16_journey_steps_block_if_parent_deleted')
  ) AS t(tabela, esperado), (SELECT 1) dummy

  -- 6. Grants (REVOKE aplicados corretamente)
  UNION ALL
  SELECT 'grant_revogado', tabela||':'||grantee_v||':'||privilegio,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name=tabela AND grantee=grantee_v AND privilege_type=privilegio)
      THEN 'OK' ELSE 'FALHOU' END
  FROM (VALUES
    ('automations','anon','SELECT'), ('automations','anon','INSERT'), ('automations','anon','UPDATE'),
    ('automations','anon','DELETE'), ('automations','anon','TRUNCATE'),
    ('journeys','anon','SELECT'), ('journeys','anon','INSERT'), ('journeys','anon','UPDATE'),
    ('journeys','anon','DELETE'), ('journeys','anon','TRUNCATE'),
    ('journey_steps','anon','SELECT'), ('journey_steps','anon','INSERT'), ('journey_steps','anon','UPDATE'),
    ('journey_steps','anon','DELETE'), ('journey_steps','anon','TRUNCATE'),
    ('marketing_sends','anon','SELECT'), ('marketing_sends','anon','TRUNCATE'),
    ('automations','authenticated','DELETE'), ('automations','authenticated','TRUNCATE'),
    ('journeys','authenticated','DELETE'), ('journeys','authenticated','TRUNCATE'),
    ('journey_steps','authenticated','TRUNCATE'),
    ('marketing_sends','authenticated','TRUNCATE')
  ) AS g(tabela, grantee_v, privilegio)

  -- 7. Função marketing_can() existe com EXECUTE correto (authenticated sim, anon não)
  UNION ALL
  SELECT 'marketing_can', 'EXECUTE authenticated',
    CASE WHEN has_function_privilege('authenticated', 'public.marketing_can(uuid,text)', 'EXECUTE')
      THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'marketing_can', 'EXECUTE anon (deve ser negado)',
    CASE WHEN NOT has_function_privilege('anon', 'public.marketing_can(uuid,text)', 'EXECUTE')
      THEN 'OK' ELSE 'FALHOU' END

  -- 8. Schema aura_private existe, com ACL esperada (USAGE pros 4 roles, não PUBLIC)
  UNION ALL
  SELECT 'aura_private', 'schema_existe',
    CASE WHEN EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='aura_private') THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'aura_private', 'aura_system_bypass_existe',
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='aura_private' AND p.proname='aura_system_bypass')
      THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'aura_private', 'NAO_VERIFICADO_exposicao_API (ver A7/8.3, passo manual via curl/painel)',
    'NAO_VERIFICADO'

  -- 9. Schema de backup (se existir de um ciclo de rollback anterior) está fechado
  -- — não deveria existir logo após uma aplicação limpa, só aparece se algum
  -- rollback já rodou antes neste ambiente; se existir, tem que estar trancado.
  UNION ALL
  SELECT 'backup_schema', 'fechado_ou_ausente',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='backup_rollback_fase1')
      THEN 'OK (ausente, esperado após aplicação limpa)'
      WHEN NOT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE table_schema='backup_rollback_fase1' AND grantee IN ('anon','authenticated','PUBLIC'))
      THEN 'OK (presente mas sem GRANT pra anon/authenticated/PUBLIC)'
      ELSE 'FALHOU' END

  -- 10. As automações REAIS originais (não-ZZFX, não-sistema) continuam com
  -- deleted_at NULL e is_system=false — a migration não deve ter marcado
  -- nada como excluído/sistema por engano além do que a Fase 2 (migration 3)
  -- fez de propósito (a conversão do "Lembrete 24h antes"). Não expõe
  -- nome/conteúdo, só os 2 booleanos agregados.
  UNION ALL
  SELECT 'dados_originais', 'automations_comuns_intactas (n='||count(*)||')',
    CASE WHEN bool_and(deleted_at IS NULL) AND bool_and(is_system = false)
      THEN 'OK' ELSE 'FALHOU' END
  FROM public.automations WHERE name NOT LIKE 'ZZFX_%' AND is_system = false
  UNION ALL
  SELECT 'dados_originais', 'journeys_reais_intactas (n='||count(*)||')',
    CASE WHEN bool_and(deleted_at IS NULL) THEN 'OK' ELSE 'FALHOU' END
  FROM public.journeys WHERE name NOT LIKE 'ZZFX_%'

  -- ===================== Migration 3 (telas de automações + 4 mensagens) =====================

  -- 11. Colunas novas existem com tipo/nullability certos
  UNION ALL
  SELECT 'colunas_m3', esperado,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='automations' AND column_name=esperado
        AND data_type='text' AND (esperado <> 'meta_status' OR is_nullable='NO'))
      THEN 'OK' ELSE 'FALHOU' END
  FROM (VALUES ('template_key'),('meta_template_name'),('meta_status'),('meta_category'),('rejection_reason')) AS v(esperado)
  UNION ALL
  SELECT 'colunas_m3', 'company_profiles.google_review_url',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='company_profiles' AND column_name='google_review_url'
        AND data_type='text' AND is_nullable='YES')
      THEN 'OK' ELSE 'FALHOU' END

  -- 12. CHECKs novos existem
  UNION ALL
  SELECT 'checks_m3', esperado,
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname=esperado) THEN 'OK' ELSE 'FALHOU' END
  FROM (VALUES
    ('automations_meta_status_check'), ('automations_name_length_check'),
    ('company_profiles_google_review_url_check')
  ) AS v(esperado)

  -- 13. Índice único parcial
  UNION ALL
  SELECT 'indice_m3', 'automations_owner_template_key_idx',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='automations_owner_template_key_idx')
      THEN 'OK' ELSE 'FALHOU' END

  -- 14. Triggers novos (travas de linha de sistema + gatilho de seed)
  UNION ALL
  SELECT 'trigger_m3_existe', tabela||':'||esperado,
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=esperado AND NOT tgisinternal
         AND tgrelid = (tabela||'')::regclass)
      THEN 'OK' ELSE 'FALHOU' END
  FROM (VALUES
    ('public.automations','trg_22_automations_protect_system_fields'),
    ('public.automations','trg_23_automations_protect_meta_fields'),
    ('public.user_roles','on_user_roles_seed_system_automations')
  ) AS t(tabela, esperado)

  -- 15. Função de seed existe, é SECURITY DEFINER e está fora da API (não
  -- chamável por anon/authenticated — confirma que aura_private continua
  -- tendo essa garantia pro objeto novo também, não só pros antigos).
  UNION ALL
  SELECT 'seed_m3', 'funcao_existe',
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='aura_private' AND p.proname='seed_system_automations')
      THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'seed_m3', 'EXECUTE anon (deve ser negado)',
    CASE WHEN NOT has_function_privilege('anon', 'aura_private.seed_system_automations(uuid)', 'EXECUTE')
      THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'seed_m3', 'EXECUTE authenticated (deve ser negado)',
    CASE WHEN NOT has_function_privilege('authenticated', 'aura_private.seed_system_automations(uuid)', 'EXECUTE')
      THEN 'OK' ELSE 'FALHOU' END

  -- 16. Cada dono admin tem exatamente 4 mensagens de sistema, sem duplicata
  -- de template_key, e nenhuma órfã de dono inexistente (nenhuma linha de
  -- teste/estabelecimento sintético sobrando).
  UNION ALL
  SELECT 'seed_m3', 'quatro_por_dono_admin_sem_duplicata',
    CASE WHEN NOT EXISTS (
      SELECT owner_id FROM public.automations WHERE is_system = true AND deleted_at IS NULL
      GROUP BY owner_id HAVING count(*) <> 4
    ) THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'seed_m3', 'sem_linha_sistema_de_dono_orfao',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.automations a WHERE a.is_system = true
        AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = a.owner_id AND ur.role = 'admin')
    ) THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'seed_m3', 'sem_lembrete24h_duplicado',
    CASE WHEN NOT EXISTS (
      SELECT owner_id FROM public.automations WHERE template_key = 'lembrete_24h' AND deleted_at IS NULL
      GROUP BY owner_id HAVING count(*) > 1
    ) THEN 'OK' ELSE 'FALHOU' END

  -- 17. Nenhuma linha de teste/sintética sobrando (sentinela ZZFX também nas
  -- colunas novas, e nenhum usuário sintético de e-mail .invalid restante).
  UNION ALL
  SELECT 'limpeza_m3', 'sem_template_key_zzfx',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.automations WHERE template_key LIKE 'ZZFX%')
      THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'limpeza_m3', 'sem_usuario_sintetico_invalid',
    CASE WHEN NOT EXISTS (SELECT 1 FROM auth.users WHERE email LIKE '%@example.invalid')
      THEN 'OK' ELSE 'FALHOU' END

)
SELECT grupo, item, status FROM checks ORDER BY
  CASE status WHEN 'FALHOU' THEN 0 WHEN 'NAO_VERIFICADO' THEN 1 ELSE 2 END, grupo, item;
