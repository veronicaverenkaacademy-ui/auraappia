-- FASE CONSENT-1C (16/11/2026, revisada em CONSENT-1C-FIX) — registro de
-- DATA + VERSÃO do aceite dos Termos de Uso / Política de Privacidade pela
-- profissional (dona ou colaboradora — ambas têm linha em public.profiles).
-- Decisão da dona: só data + versão, SEM IP, SEM dispositivo/user-agent
-- (diferente de client_consents, que guarda evidência completa para a
-- CLIENTE — aqui o par é profissional↔AURA, não precisa do mesmo nível de
-- prova).
--
-- ESTA MIGRAÇÃO NÃO FOI APLICADA EM PRODUÇÃO NESTA FASE — só branch nova +
-- PR em DRAFT, por instrução explícita da dona.
--
-- terms_accepted_at JÁ EXISTE (migration 20260804120000) e continua tendo
-- o mesmo papel: timestamp do último aceite. Esta migração só ADICIONA
-- terms_accepted_version — sem ela, não dá pra saber SE o aceite que
-- terms_accepted_at registra ainda corresponde ao texto atual (ela podia
-- ter aceitado uma versão de agosto e nunca mais ter visto o texto novo
-- de novembro). Sem backfill: contas existentes (hoje só de teste, sem
-- usuárias reais) ficam com terms_accepted_version NULL — o app trata
-- NULL como "precisa aceitar" (ver src/lib/professional-terms-version.ts),
-- então elas simplesmente veem o bloqueio de aceite na próxima vez que
-- abrirem o app, nunca um valor inventado.
--
-- REVISÃO CONSENT-1C-FIX — A ABORDAGEM ORIGINAL (REVOKE DE COLUNA) ESTAVA
-- QUEBRADA E FOI SUBSTITUÍDA POR TRIGGER:
-- a versão original desta migração fazia
-- "REVOKE UPDATE (terms_accepted_version, terms_accepted_at) ON
-- public.profiles FROM authenticated, anon". Isso NÃO funciona no
-- Postgres quando o papel já tem GRANT UPDATE no nível da TABELA (que é
-- exatamente o padrão do Supabase, confirmado lendo o catálogo real:
-- has_table_privilege('authenticated', 'public.profiles', 'UPDATE') =
-- true) — um REVOKE de privilégio de COLUNA não revoga o privilégio de
-- TABELA, que sozinho já cobre UPDATE em qualquer coluna, inclusive as
-- duas que o REVOKE tentava proteger. Prova lida direto do catálogo de
-- produção (somente leitura, antes desta correção):
--   has_table_privilege('authenticated','public.profiles','UPDATE')          = true
--   has_column_privilege('authenticated','public.profiles','terms_accepted_at','UPDATE') = true
--   has_column_privilege('authenticated','public.profiles','full_name','UPDATE')         = true
--   (mesmos três resultados para 'anon')
-- ou seja, a coluna sensível tinha exatamente o mesmo privilégio de
-- UPDATE que qualquer outra coluna comum — a proteção por REVOKE nunca
-- teria funcionado.
--
-- PROTEÇÃO CORRIGIDA: TRIGGER, não GRANT/REVOKE. public.profiles continua
-- com o GRANT UPDATE de tabela padrão do Supabase para authenticated/anon
-- (inalterado — não mexemos em GRANTs aqui, para não criar a mesma
-- armadilha silenciosa com colunas futuras que alguém adicione sem saber
-- que GRANT de tabela sempre vence REVOKE de coluna). Em vez disso, um
-- trigger BEFORE INSERT OR UPDATE ignora silenciosamente qualquer
-- tentativa de authenticated/anon de gravar valor nessas duas colunas:
-- em INSERT, força NULL; em UPDATE, força o valor antigo (nunca lança
-- erro) — de propósito "silencioso": o app antigo publicado (antes deste
-- PR) ainda manda terms_accepted_at no upsert de auth.tsx por algum
-- tempo após o deploy do frontend e antes de todo mundo atualizar o app
-- (Capacitor/iOS não atualiza instantaneamente), e isso não pode quebrar
-- cadastro/login. A gravação de verdade passa a ser só por supabaseAdmin
-- (src/lib/professional-terms.functions.ts, acceptMyTerms), que roda como
-- service_role — current_user = 'service_role', fora do IN() do trigger,
-- então nunca é afetado. O trigger também não SECURITY DEFINER de
-- propósito: precisa enxergar o current_user real de quem está fazendo o
-- UPDATE/INSERT, não o dono da função.
--
-- handle_new_user() (INSERT automático da linha de profiles no cadastro)
-- é SECURITY DEFINER, dono "postgres" — current_user dentro dela é
-- 'postgres', fora do IN() do trigger, e de qualquer forma ela nunca seta
-- as colunas de termos (fica NULL por padrão) — confirmado lendo
-- pg_get_functiondef(handle_new_user) e o owner da função antes desta
-- migração.
--
-- profiles já tinha um trigger BEFORE UPDATE (profiles_updated_at, só
-- atualiza updated_at) — confirmado via pg_trigger antes desta migração.
-- O novo trigger (nome "trg_10_..." ordena antes de "profiles_updated_at"
-- alfabeticamente, mas a ORDEM entre os dois não importa: cada um mexe só
-- nas suas próprias colunas, sem nenhuma dependência entre eles).
--
-- Idempotente (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS antes de recriar). Aditiva: nenhuma coluna/
-- policy/grant existente é alterada ou removida. Termina com NOTIFY
-- pgrst.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_version text NULL;

-- Ignora silenciosamente (nunca lança exceção) qualquer tentativa de
-- authenticated/anon de setar as duas colunas de aceite de termos —
-- quem grava de verdade é sempre acceptMyTerms, via service_role.
-- Qualquer outro current_user (service_role, postgres, e funções
-- SECURITY DEFINER rodando como postgres, como handle_new_user) passa
-- direto, sem nenhuma alteração.
CREATE OR REPLACE FUNCTION public.profiles_protect_terms_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.terms_accepted_at := NULL;
      NEW.terms_accepted_version := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.terms_accepted_at := OLD.terms_accepted_at;
      NEW.terms_accepted_version := OLD.terms_accepted_version;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_10_profiles_protect_terms_acceptance ON public.profiles;
CREATE TRIGGER trg_10_profiles_protect_terms_acceptance
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_protect_terms_acceptance();

NOTIFY pgrst, 'reload schema';

COMMIT;
