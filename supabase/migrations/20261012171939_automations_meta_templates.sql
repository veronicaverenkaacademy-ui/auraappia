-- Telas de automações (excluir, renomear) + 4 mensagens padrão — migration 3/3
-- do Sistema A de marketing. Depende de 20261006124828_automations_soft_delete.sql
-- e 20261006124829_automations_staff_permissions.sql já aplicadas (Fase 1,
-- instalada e verificada em produção em 12/10/2026 — ver docs/fase1-progress.md).
--
-- Textos das 4 mensagens padrão vêm de src/lib/marketing/system-templates.ts
-- (fonte única — um teste node:test compara este arquivo com aquele). Não
-- edite um texto aqui sem editar lá primeiro.
--
-- "Onde o estabelecimento nasce" (item 2.4): investigado por catálogo real
-- (pg_get_functiondef/information_schema.triggers). public.profiles nasce
-- pra QUALQUER cadastro (handle_new_user(), inclusive colaboradoras) — não
-- serve. public.company_profiles é manual/opcional (só existe depois que a
-- dona preenche slug+nome público) — não serve como gatilho confiável. O
-- sinal certo é public.user_roles com role='admin' (só existe quando
-- raw_user_meta_data->>'user_type'='professional', via
-- grant_admin_on_new_user()) — e já existe PRECEDENTE EXATO no projeto pra
-- esse gatilho: on_user_roles_seed_access_levels (AFTER INSERT ON
-- user_roles) chama seed_access_levels_on_new_admin(), que faz
-- "IF NEW.role = 'admin' THEN PERFORM seed_default_access_levels(...)". A
-- SEÇÃO E deste arquivo segue exatamente esse padrão.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ===================== SEÇÃO A — colunas novas =====================
ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS template_key text NULL,
  ADD COLUMN IF NOT EXISTS meta_template_name text NULL,
  ADD COLUMN IF NOT EXISTS meta_status text NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN IF NOT EXISTS meta_category text NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text NULL;

ALTER TABLE public.automations
  DROP CONSTRAINT IF EXISTS automations_meta_status_check;
ALTER TABLE public.automations
  ADD CONSTRAINT automations_meta_status_check
  CHECK (meta_status IN ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED'));

-- CHECK de nome (item 2.2) — confirmado por consulta real antes de aplicar
-- esta migration: o maior nome real hoje tem 18 caracteres (as 3 automações
-- reais existentes e as fixtures ZZFX de teste todas cabem em 40).
ALTER TABLE public.automations
  DROP CONSTRAINT IF EXISTS automations_name_length_check;
ALTER TABLE public.automations
  ADD CONSTRAINT automations_name_length_check
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 40);

-- Índice único parcial — chave de idempotência da seed (item 2.4) e trava
-- de catálogo contra duplicar template_key por dono.
DROP INDEX IF EXISTS public.automations_owner_template_key_idx;
CREATE UNIQUE INDEX automations_owner_template_key_idx
  ON public.automations (owner_id, template_key)
  WHERE template_key IS NOT NULL AND deleted_at IS NULL;

-- company_profiles.google_review_url (item 2.2b). Confirmado por consulta
-- real antes de aplicar: a tabela hoje só é acessível por
-- owner_id = auth.uid() (policy company_profiles_own_all) — nenhuma
-- colaboradora (nem Gerente) tem qualquer acesso, nem leitura; esta coluna
-- NÃO muda isso (nenhuma policy nova, nenhum GRANT novo nesta tabela). A
-- view public.public_company_profiles (lida por anon/authenticated no
-- portal público) lista colunas explicitamente — google_review_url NÃO foi
-- adicionada a ela, então o link não fica público pela Landing Pública por
-- este caminho.
ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS google_review_url text NULL;

ALTER TABLE public.company_profiles
  DROP CONSTRAINT IF EXISTS company_profiles_google_review_url_check;
ALTER TABLE public.company_profiles
  ADD CONSTRAINT company_profiles_google_review_url_check
  CHECK (
    google_review_url IS NULL
    OR (char_length(google_review_url) <= 500 AND google_review_url ~ '^https://\S+$')
  );

-- ===================== SEÇÃO B — travas de linha de sistema (item 2.3) =====================
-- trg_22: para linha de SISTEMA (is_system=true), usuário comum não pode
-- alterar conteúdo/canal/categoria/gatilho. Mesma técnica das proteções da
-- Fase 1 (BEFORE UPDATE, aura_private.aura_system_bypass() qualificado,
-- mensagem AURA_... com SQLSTATE novo). message_body/message_buttons/
-- channel/category/trigger_description aqui — template_key/meta_* ficam no
-- trg_23 (universal, não só pra linha de sistema).
CREATE OR REPLACE FUNCTION public.automations_protect_system_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT aura_private.aura_system_bypass() AND OLD.is_system
     AND (NEW.message_body IS DISTINCT FROM OLD.message_body
          OR NEW.message_buttons IS DISTINCT FROM OLD.message_buttons
          OR NEW.channel IS DISTINCT FROM OLD.channel
          OR NEW.category IS DISTINCT FROM OLD.category
          OR NEW.trigger_description IS DISTINCT FROM OLD.trigger_description) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UR009',
      MESSAGE = 'AURA_SYSTEM_FIELDS_PROTECTED: mensagem padrão do AURA não pode ter texto, botões, canal, categoria ou gatilho alterados.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.automations_protect_system_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_22_automations_protect_system_fields ON public.automations;
CREATE TRIGGER trg_22_automations_protect_system_fields
  BEFORE UPDATE ON public.automations
  FOR EACH ROW
  WHEN (OLD.is_system)
  EXECUTE FUNCTION public.automations_protect_system_fields();

-- trg_23: para QUALQUER linha (sistema ou não), usuário comum não pode
-- alterar template_key nem nenhuma coluna meta_* — só a seed/migration
-- (aura_system_bypass()) ou uma atualização manual via SQL direto (item
-- 3.5, quando a dona avisar "a Meta aprovou X") passam por aqui.
CREATE OR REPLACE FUNCTION public.automations_protect_meta_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT aura_private.aura_system_bypass()
     AND (NEW.template_key IS DISTINCT FROM OLD.template_key
          OR NEW.meta_template_name IS DISTINCT FROM OLD.meta_template_name
          OR NEW.meta_status IS DISTINCT FROM OLD.meta_status
          OR NEW.meta_category IS DISTINCT FROM OLD.meta_category
          OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UR010',
      MESSAGE = 'AURA_META_FIELDS_LOCKED: campos de integração com a Meta não podem ser alterados diretamente.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.automations_protect_meta_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_23_automations_protect_meta_fields ON public.automations;
CREATE TRIGGER trg_23_automations_protect_meta_fields
  BEFORE UPDATE ON public.automations
  FOR EACH ROW
  WHEN (OLD.template_key IS DISTINCT FROM NEW.template_key
        OR OLD.meta_template_name IS DISTINCT FROM NEW.meta_template_name
        OR OLD.meta_status IS DISTINCT FROM NEW.meta_status
        OR OLD.meta_category IS DISTINCT FROM NEW.meta_category
        OR OLD.rejection_reason IS DISTINCT FROM NEW.rejection_reason)
  EXECUTE FUNCTION public.automations_protect_meta_fields();

-- ===================== SEÇÃO C — seed idempotente das 4 mensagens (item 2.4) =====================
-- SECURITY DEFINER (roda como o dono da função, que bypassa RLS por ser o
-- dono das tabelas — confirmado por catálogo: automations/journeys NÃO têm
-- FORCE ROW LEVEL SECURITY) + search_path fixo. EXECUTE revogado de PUBLIC/
-- anon/authenticated — só postgres/service_role chamam (migration e o
-- trigger AFTER INSERT da SEÇÃO E, nunca a API). Idempotente via ON
-- CONFLICT DO NOTHING no índice único (owner_id, template_key) — rodar duas
-- vezes pro mesmo owner não duplica nada. NUNCA cria linha para outro dono:
-- p_owner_id é usado em TODAS as 4 linhas, nunca lido de contexto/sessão.
CREATE OR REPLACE FUNCTION aura_private.seed_system_automations(p_owner_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.automations (
    owner_id, name, category, channel, active, is_system,
    template_key, meta_template_name, meta_status, meta_category,
    trigger_description, audience_description, message_body, message_buttons
  ) VALUES
  (
    p_owner_id, 'Lembrete 24h antes', 'agenda', 'whatsapp', false, true,
    'lembrete_24h', 'lembrete_24h', 'PENDING', 'UTILITY',
    '24 horas antes do horário marcado', 'Clientes com horário confirmado',
    'Olá, {{1}}! 💛 Passando para lembrar que amanhã, às {{2}}, você tem um horário reservado para {{3}} no {{4}}. Estamos te esperando! Por favor, confirme sua presença abaixo.',
    ARRAY['Confirmar presença', 'Reagendar', 'Cancelar']
  ),
  (
    p_owner_id, 'Lembrete 2h antes', 'agenda', 'whatsapp', false, true,
    'lembrete_2h', 'lembrete_2h', 'APPROVED', 'UTILITY',
    '2 horas antes do horário marcado', 'Clientes com horário confirmado',
    'Olá, {{1}}! 💛 Seu horário de {{2}} é hoje, às {{3}}, no {{4}}. Estamos te esperando! Se tiver algum imprevisto, é só nos avisar por aqui.',
    ARRAY[]::text[]
  ),
  (
    p_owner_id, 'Avaliação no Google', 'fidelidade', 'whatsapp', false, true,
    'pos_avaliacao_google', 'pos_avaliacao_google', 'PENDING', 'UTILITY',
    'Depois do atendimento concluído — só na primeira vez da cliente', 'Clientes atendidas pela primeira vez',
    'Olá, {{1}}! 💛 Foi um prazer te atender hoje no {{2}}. Sua opinião é muito importante para nós! Se puder, deixe sua avaliação no Google por este link: {{3}} Agradecemos a sua confiança!',
    ARRAY[]::text[]
  ),
  (
    p_owner_id, 'Retorno em 30 dias', 'reativacao', 'whatsapp', false, true,
    'retorno_30_dias', 'retorno_30_dias', 'PENDING', 'MARKETING',
    'Cliente há mais de 30 dias sem atendimento concluído', 'Clientes inativas há 30+ dias',
    'Olá, {{1}}! 💛 Sentimos sua falta no {{2}}. Já faz um tempinho desde o seu último atendimento. Que tal agendar seu retorno? Reserve seu horário pelo link: {{3}} Esperamos você em breve!',
    ARRAY['Parar de receber mensagens']
  )
  ON CONFLICT (owner_id, template_key) WHERE (template_key IS NOT NULL AND deleted_at IS NULL)
  DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION aura_private.seed_system_automations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aura_private.seed_system_automations(uuid) TO postgres, service_role;

-- ===================== SEÇÃO D — confirmação por catálogo: função fora da API =====================
-- (comentário, não SQL executável — prova feita via consulta separada,
-- registrada em docs/telas-progress.md)
-- SELECT has_function_privilege('anon', 'aura_private.seed_system_automations(uuid)', 'EXECUTE');          -- esperado: false
-- SELECT has_function_privilege('authenticated', 'aura_private.seed_system_automations(uuid)', 'EXECUTE'); -- esperado: false
-- aura_private nunca está na lista "Exposed schemas" do PostgREST (mesmo
-- raciocínio já documentado para aura_system_bypass() na migration 1).

-- ===================== SEÇÃO E — gatilho: estabelecimento nasce em user_roles (item 2.4) =====================
-- Mesmo padrão de on_user_roles_seed_access_levels/seed_access_levels_on_new_admin
-- (já existente no projeto, ver cabeçalho deste arquivo). SECURITY DEFINER
-- pela mesma razão da função chamada.
CREATE OR REPLACE FUNCTION public.seed_system_automations_on_new_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    PERFORM aura_private.seed_system_automations(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_system_automations_on_new_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_user_roles_seed_system_automations ON public.user_roles;
CREATE TRIGGER on_user_roles_seed_system_automations
  AFTER INSERT ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_system_automations_on_new_admin();

-- ===================== SEÇÃO F — backfill único: estabelecimentos já existentes (item 2.4a/2.5) =====================
-- Para cada dono admin JÁ existente hoje: se ele tiver uma automação não-
-- sistema chamada exatamente "Lembrete 24h antes" (o caso real da dona,
-- instalada da biblioteca), ela VIRA a mensagem de sistema lembrete_24h —
-- atualiza a linha em vez de criar uma nova (nunca duplica). Depois chama a
-- seed pra esse mesmo dono: a própria linha recém-convertida já ocupa a
-- vaga de lembrete_24h no índice único, então o INSERT de lembrete_24h
-- dentro da seed colide e faz DO NOTHING — só os outros 3 (lembrete_2h,
-- pos_avaliacao_google, retorno_30_dias) são inseridos. Donos sem essa
-- linha nomeada ganham as 4 do zero, sem conversão. Idempotente: rodar esta
-- seção de novo não duplica nem reconverte nada (o UPDATE abaixo só atinge
-- linhas com is_system=false, que já não existem depois da 1a aplicação).
DO $$
DECLARE
  v_owner_id uuid;
BEGIN
  FOR v_owner_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin'
  LOOP
    UPDATE public.automations
    SET
      is_system = true,
      template_key = 'lembrete_24h',
      meta_template_name = 'lembrete_24h',
      meta_status = 'PENDING',
      meta_category = 'UTILITY',
      channel = 'whatsapp',
      trigger_description = '24 horas antes do horário marcado',
      message_body = 'Olá, {{1}}! 💛 Passando para lembrar que amanhã, às {{2}}, você tem um horário reservado para {{3}} no {{4}}. Estamos te esperando! Por favor, confirme sua presença abaixo.',
      message_buttons = ARRAY['Confirmar presença', 'Reagendar', 'Cancelar']
    WHERE owner_id = v_owner_id
      AND name = 'Lembrete 24h antes'
      AND is_system = false
      AND deleted_at IS NULL;

    PERFORM aura_private.seed_system_automations(v_owner_id);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
