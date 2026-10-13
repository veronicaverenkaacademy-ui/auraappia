-- Rollback de 20261012171939_automations_meta_templates.sql
-- Fora de supabase/migrations/ propositalmente (mesmo motivo documentado nos
-- 2 rollbacks da Fase 1) — SQL de referência pra reverter manualmente via
-- query_database/SQL Editor, rodando como conexão privilegiada (postgres/
-- service_role — é assim que aura_private.aura_system_bypass() evolui true
-- e os triggers novos desta migration não interferem aqui).
-- Rodar DEPOIS deste rollback, se também for desfazer a Fase 1: primeiro
-- este arquivo, depois 20261006124829_..._rollback.sql, depois
-- 20261006124828_..._rollback.sql (ordem 3, 2, 1 — nunca a Fase 1 primeiro,
-- porque a UNIQUE INDEX e os triggers desta migration dependem das colunas
-- da Fase 1 continuarem existindo até aqui).
--
-- A linha "Lembrete 24h antes" é restaurada a partir da cópia em
-- backup_fase1_20261012.automations (criada na instalação da Fase 1, antes
-- de qualquer uma destas 3 migrations) — ela nunca foi apagada nem
-- recriada, então ainda existe com os valores de message_body/buttons/
-- channel/category/trigger_description/active de antes desta migration.
-- Confirmar por hash (SQL de verificação em separado, não incluído aqui)
-- que o valor pós-rollback bate com a cópia.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ---- Restaura a linha "Lembrete 24h antes" ao estado anterior a esta migration ----
UPDATE public.automations a
SET
  is_system = false,
  template_key = NULL,
  meta_template_name = NULL,
  meta_status = 'NOT_SUBMITTED',
  meta_category = NULL,
  rejection_reason = NULL,
  message_body = b.message_body,
  message_buttons = b.message_buttons,
  channel = b.channel,
  category = b.category,
  trigger_description = b.trigger_description,
  active = b.active
FROM backup_fase1_20261012.automations b
WHERE a.owner_id = b.owner_id
  AND b.name = 'Lembrete 24h antes'
  AND a.name = 'Lembrete 24h antes'
  AND a.is_system = true
  AND a.template_key = 'lembrete_24h';

-- ---- Remove as outras 3 linhas de sistema criadas pela seed (nunca existiram antes) ----
DELETE FROM public.automations
WHERE is_system = true
  AND template_key IN ('lembrete_2h', 'pos_avaliacao_google', 'retorno_30_dias');

-- ---- Gatilho "estabelecimento nasce" + função + função de seed ----
DROP TRIGGER IF EXISTS on_user_roles_seed_system_automations ON public.user_roles;
DROP FUNCTION IF EXISTS public.seed_system_automations_on_new_admin();
DROP FUNCTION IF EXISTS aura_private.seed_system_automations(uuid);

-- ---- Travas de linha de sistema (item 2.3) ----
DROP TRIGGER IF EXISTS trg_23_automations_protect_meta_fields ON public.automations;
DROP FUNCTION IF EXISTS public.automations_protect_meta_fields();
DROP TRIGGER IF EXISTS trg_22_automations_protect_system_fields ON public.automations;
DROP FUNCTION IF EXISTS public.automations_protect_system_fields();

-- ---- Índice único ----
DROP INDEX IF EXISTS public.automations_owner_template_key_idx;

-- ---- company_profiles.google_review_url ----
ALTER TABLE public.company_profiles DROP CONSTRAINT IF EXISTS company_profiles_google_review_url_check;
ALTER TABLE public.company_profiles DROP COLUMN IF EXISTS google_review_url;

-- ---- Colunas/CHECKs de automations ----
ALTER TABLE public.automations DROP CONSTRAINT IF EXISTS automations_name_length_check;
ALTER TABLE public.automations DROP CONSTRAINT IF EXISTS automations_meta_status_check;
ALTER TABLE public.automations DROP COLUMN IF EXISTS rejection_reason;
ALTER TABLE public.automations DROP COLUMN IF EXISTS meta_category;
ALTER TABLE public.automations DROP COLUMN IF EXISTS meta_status;
ALTER TABLE public.automations DROP COLUMN IF EXISTS meta_template_name;
ALTER TABLE public.automations DROP COLUMN IF EXISTS template_key;

NOTIFY pgrst, 'reload schema';

COMMIT;
