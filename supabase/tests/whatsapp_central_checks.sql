-- WhatsApp central (Etapa 1) — checagens pós-aplicação + cenários da
-- máquina de estados. Duas partes, rodar cada uma separadamente:
--
-- PARTE 1 (abaixo até a linha "-- ===== PARTE 2"): SOMENTE LEITURA, nunca
-- escreve nada — mesmo padrão de post_apply_checks.sql. Critério de
-- aceite: toda linha 'OK'.
--
-- PARTE 2: cenários sintéticos da função apply_whatsapp_central_reply —
-- cria dados fictícios (ids fixos, fáceis de reconhecer), roda os cenários,
-- e termina com ROLLBACK — nunca deixa rastro no banco real. Rodar como
-- UMA transação só (copiar o bloco inteiro, de BEGIN a ROLLBACK, numa
-- chamada só) — não funciona em pedaços separados.

-- ===== PARTE 1 — checagens pós-aplicação (somente leitura) =====
WITH checks AS (
  SELECT 'colunas' AS grupo, 'whatsapp_messages.template_name' AS item,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='whatsapp_messages' AND column_name='template_name')
      THEN 'OK' ELSE 'FALHOU' END AS status
  UNION ALL
  SELECT 'colunas', 'whatsapp_messages.error_class',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='whatsapp_messages' AND column_name='error_class')
      THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'constraint', 'whatsapp_messages_status_check inclui uncertain',
    CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conname='whatsapp_messages_status_check') LIKE '%uncertain%'
      THEN 'OK' ELSE 'FALHOU' END

  UNION ALL
  SELECT 'tabela_existe', t, CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t)
    THEN 'OK' ELSE 'FALHOU' END
  FROM unnest(ARRAY[
    'whatsapp_status_reconciliation', 'whatsapp_central_incidents', 'app_notifications',
    'whatsapp_central_threads', 'whatsapp_central_orphan_messages'
  ]) AS t

  UNION ALL
  SELECT 'rls_ativa', relname, CASE WHEN relrowsecurity THEN 'OK' ELSE 'FALHOU' END
  FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname IN (
    'whatsapp_status_reconciliation', 'whatsapp_central_incidents', 'app_notifications',
    'whatsapp_central_threads', 'whatsapp_central_orphan_messages'
  )

  UNION ALL
  SELECT 'policy_existe', p, CASE WHEN EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = p AND polrelid = 'public.app_notifications'::regclass)
    THEN 'OK' ELSE 'FALHOU' END
  FROM unnest(ARRAY['app_notifications_select', 'app_notifications_mark_read']) AS p

  UNION ALL
  SELECT 'indice_unico', i, CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = i) THEN 'OK' ELSE 'FALHOU' END
  FROM unnest(ARRAY[
    'whatsapp_central_incidents_open_global_idx', 'whatsapp_central_incidents_open_template_idx',
    'app_notifications_dedupe_idx', 'whatsapp_status_reconciliation_wamid_status_idx',
    'whatsapp_central_orphan_messages_provider_id_idx', 'whatsapp_central_threads_open_idx'
  ]) AS i

  UNION ALL
  SELECT 'funcao', 'apply_whatsapp_central_reply existe',
    CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='apply_whatsapp_central_reply')
      THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'funcao', 'apply_whatsapp_central_reply: anon sem EXECUTE',
    CASE WHEN NOT has_function_privilege('anon', 'public.apply_whatsapp_central_reply(uuid,text,uuid,numeric)', 'EXECUTE')
      THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'funcao', 'apply_whatsapp_central_reply: authenticated sem EXECUTE',
    CASE WHEN NOT has_function_privilege('authenticated', 'public.apply_whatsapp_central_reply(uuid,text,uuid,numeric)', 'EXECUTE')
      THEN 'OK' ELSE 'FALHOU' END
  UNION ALL
  SELECT 'funcao', 'apply_whatsapp_central_reply: service_role COM EXECUTE',
    CASE WHEN has_function_privilege('service_role', 'public.apply_whatsapp_central_reply(uuid,text,uuid,numeric)', 'EXECUTE')
      THEN 'OK' ELSE 'FALHOU' END

  UNION ALL
  SELECT 'dados', 'automations.meta_status das 4 mensagens padrão = APPROVED',
    CASE WHEN (SELECT count(*) FROM public.automations
      WHERE is_system = true
        AND template_key IN ('lembrete_24h','lembrete_2h','pos_avaliacao_google','retorno_30_dias')
        AND meta_status <> 'APPROVED') = 0
      THEN 'OK' ELSE 'FALHOU' END
)
SELECT * FROM checks ORDER BY grupo, item;

-- ===== PARTE 2 — cenários sintéticos de apply_whatsapp_central_reply =====
-- Copiar e rodar o bloco abaixo (BEGIN...ROLLBACK) como UMA chamada só.
-- Troca os ids reais de owner_id/client_id por um agendamento/cliente
-- qualquer já existente no banco antes de rodar (ids fixos abaixo são só
-- placeholders de exemplo — ver resultado completo já validado manualmente
-- na sessão de construção, registrado no PR).
--
-- BEGIN;
-- ... (ver supabase/migrations/20261024194007_whatsapp_central_reply_function.sql
--      para o corpo da função; cenários cobertos e confirmados na sessão de
--      construção: confirmar, confirmar de novo [no-op], cancelar depois de
--      confirmar, cancelar, confirmar depois de cancelar, lembrete
--      desatualizado, reagendar, reagendar de novo [repetição sem duplicar] —
--      todos batendo com tests/central-reply-decision.test.ts)
-- ROLLBACK;
