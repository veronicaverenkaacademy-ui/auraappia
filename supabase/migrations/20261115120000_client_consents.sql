-- FASE CONSENT-1A — "Livro de consentimentos": tabela append-only que vai
-- virar a prova real de que uma cliente aceitou (ou negou) cada tipo de
-- consentimento que /termo-consentimento promete hoje sem gravar nada
-- (CONSENT-0, 15/11/2026): dados de saúde (anamnese), uso de imagem (com 3
-- opções), marketing separado/revogável, termos/privacidade, e o aceite de
-- lembretes de agendamento por WhatsApp.
--
-- ESTA MIGRAÇÃO NÃO FOI APLICADA EM PRODUÇÃO NESTA FASE — só branch nova +
-- PR em DRAFT, por instrução explícita da dona. Só cria a tabela/funções;
-- nenhuma tela nova, nenhum texto legal alterado, nenhuma trava de
-- bloqueio (etapa 1D, futura, decide isso).
--
-- DECISÕES DA DONA (revisão de desenho, 15/11/2026 — substituem o desenho
-- original pedido no mesmo dia):
--   1) Assinatura = só caixa de aceite + data, nunca nome digitado. Por
--      isso signer_name é OPCIONAL (nullable, nunca exigido pelo servidor)
--      — mantido só por compatibilidade, caso uma tela futura decida usar.
--      A prova real é: created_at, consent_type, choice, document_version,
--      source, evidence_ip, evidence_user_agent.
--   2) Menores de 18 anos: a dona decidiu NÃO coletar dados de responsável
--      legal nesta etapa (sem guardian_name/guardian_document/signer_role)
--      — ver RISCOS/NÃO VERIFICADO no relatório da fase: ponto encaminhado
--      à advogada, apesar de a Política de Privacidade (§11) prometer
--      consentimento do responsável para clientes menores.
--   3) Uso de imagem sem autorização NUNCA bloqueia nada nesta fase (nem
--      na futura 1D) — a trava ali será só um AVISO visual. Por isso
--      'granted_no_face' é uma escolha de primeira classe (não um detalhe
--      de UI) e getClientConsentStatus/hasConsent (camada TS) precisam
--      diferenciar "nunca respondeu" (ausente) de "negou" (denied) de
--      "autorizou sem rosto" (granted_no_face) — tudo já fica gravado por
--      linha, essa parte é só leitura/interpretação na camada TS.
--
-- DESENHO (por que cada decisão):
--   - APPEND-ONLY: cada troca de ideia da cliente é uma linha NOVA (nunca
--     um UPDATE comum) — o estado "atual" de um tipo é sempre a linha mais
--     recente desse par (client_id, consent_type). Histórico completo
--     sempre disponível (quando ela mudou de ideia, quantas vezes).
--   - owner_id/client_id ON DELETE CASCADE (não RESTRICT): mesmo padrão já
--     usado em TODO o resto do schema para tabelas client-adjacent
--     (client_anamnesis, client_photos — ambas CASCADE em owner_id E
--     client_id, migration 20260727180855). Excluir uma cliente
--     (deleteClient, clients.ts) ou a dona excluir a própria conta
--     (account-deletion.functions.ts, exigência da Apple, que termina com
--     supabaseAdmin.auth.admin.deleteUser) JÁ apaga em cascata anamnese e
--     fotos hoje — um client_consents com ON DELETE RESTRICT seria a ÚNICA
--     tabela do schema a quebrar essas duas exclusões (a de conta é
--     exigência da App Store) só por ter uma linha de consentimento
--     associada. Trade-off CONSCIENTE, não esquecimento: o "livro" não
--     sobrevive a uma exclusão física da cliente/da conta, igual à
--     anamnese/fotos hoje — ver RISCOS no relatório.
--   - collected_by_user_id ON DELETE SET NULL (nullable): mesma lógica do
--     whatsapp_otp_send_log.owner_id (20261114120000) — perder o vínculo
--     "quem coletou" quando essa colaboradora é desligada/excluída nunca
--     deve apagar a PROVA do consentimento em si.
--   - IMUTABILIDADE (trigger, não só RLS): mesmo authenticated/anon
--     revogados, service_role (supabaseAdmin) BYPASSA RLS e teria ALL
--     grant — sem o trigger, um bug num código futuro que chame
--     `.update()`/`.delete()` por engano apagaria prova silenciosamente.
--     DELETE DIRETO (`DELETE FROM client_consents ...`) é SEMPRE bloqueado,
--     para qualquer papel, sem excessão nenhuma (nem service_role) — a
--     "limpeza por exclusão de conta" só ANONIMIZA (UPDATE), nunca apaga a
--     linha diretamente. Única passagem: quando o DELETE chega aqui como
--     efeito CASCADE de excluir o `clients` ou o `auth.users` pai (owner_id/
--     client_id acima são ON DELETE CASCADE) — nesse caso o gatilho deixa
--     passar, porque o pai referenciado já não existe mais no momento em
--     que o gatilho roda (a cascata do Postgres já removeu o pai antes de
--     disparar o DELETE em cascata no filho); um DELETE direto nunca tem
--     essa condição (o pai continua existindo), então nunca escapa pela
--     mesma checagem. UPDATE só passa pelo caminho dedicado
--     purge_client_consent_pii() (GUC de sessão aura_consent.cleanup_active,
--     setada só dentro dessa função — nunca por nenhum outro caminho) E só
--     nas 3 colunas de PII (signer_name/evidence_ip/evidence_user_agent) —
--     qualquer outra coluna tocada durante esse caminho também lança erro
--     (prova mínima tipo/escolha/versão/data/fonte nunca pode mudar).
--   - RLS: DUAS policies de leitura, mesmo padrão de clients/
--     client_anamnesis/client_photos (20260727180855 + 20260825140000) —
--     "owner_all"/"*_own_all" (dona vê tudo do próprio salão, auth.uid() =
--     owner_id) SEMPRE existiu ao LADO de "*_staff_select"
--     (staff_can(owner_id,'clients','view'), só pra colaboradoras) — as
--     duas juntas, nunca uma só (staff_can() SOZINHA nunca cobre a dona,
--     que não tem linha própria em team_members). SEM policy de INSERT/
--     UPDATE/DELETE para authenticated (proposital, nem pra dona) — toda
--     gravação passa por supabaseAdmin nas server functions (Parte 2 da
--     fase), depois de checar permissão em código (staff_can/'clients'/
--     'edit', mesmo padrão de client-optout-reactivation.functions.ts).
--
-- Idempotente (CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE
-- FUNCTION, DROP POLICY/TRIGGER IF EXISTS antes de recriar) — seguro
-- reaplicar. Aditiva: nenhuma tabela/coluna/política existente é tocada.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- ===================== SEÇÃO A — tabela =====================
CREATE TABLE IF NOT EXISTS public.client_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (
    consent_type IN ('terms_privacy', 'health_data', 'image_use', 'marketing', 'whatsapp_reminders')
  ),
  choice text NOT NULL CHECK (choice IN ('granted', 'denied', 'granted_no_face')),
  -- Slug real da rota do texto legal mostrado no momento do aceite — ex.:
  -- 'termo-consentimento', 'politica-de-privacidade', 'termos-de-uso' (as
  -- 3 rotas reais hoje, src/routes/*.tsx). Não há 1:1 fixo entre
  -- consent_type e document_key nesta fase — quem grava decide os dois,
  -- cada um com seu próprio CHECK; a tela futura (1B/1C) decide o
  -- pareamento de verdade.
  document_key text NOT NULL CHECK (
    document_key IN ('termo-consentimento', 'politica-de-privacidade', 'termos-de-uso')
  ),
  -- Vem SEMPRE do servidor (src/lib/legal-versions.ts), nunca de parâmetro
  -- do chamador — ver recordClientConsent/recordMyClientConsent (Parte 2).
  document_version text NOT NULL,
  source text NOT NULL CHECK (source IN ('portal', 'studio_device', 'professional_assisted')),
  collected_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Opcional por decisão da dona (15/11/2026) — a assinatura real é a
  -- caixa de aceite + data; isto nunca é exigido pelo servidor.
  signer_name text NULL,
  evidence_ip text NULL,
  evidence_user_agent text NULL,
  CONSTRAINT client_consents_no_face_only_image_use
    CHECK (choice <> 'granted_no_face' OR consent_type = 'image_use'),
  CONSTRAINT client_consents_user_agent_len
    CHECK (evidence_user_agent IS NULL OR char_length(evidence_user_agent) <= 300)
);

CREATE INDEX IF NOT EXISTS client_consents_client_type_idx
  ON public.client_consents (client_id, consent_type, created_at DESC);
CREATE INDEX IF NOT EXISTS client_consents_owner_idx
  ON public.client_consents (owner_id);

-- ===================== SEÇÃO B — RLS e grants =====================
ALTER TABLE public.client_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_consents TO authenticated;
GRANT ALL ON public.client_consents TO service_role;

-- A dona (owner_id = auth.uid()) vê tudo do próprio salão — mesmo padrão
-- de clients_own_all/anamnesis_own_all/photos_own_all (20260727180855):
-- staff_can() SOZINHA nunca cobriria a dona (ela não tem linha própria em
-- team_members).
DROP POLICY IF EXISTS client_consents_owner_select ON public.client_consents;
CREATE POLICY client_consents_owner_select ON public.client_consents FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS client_consents_staff_select ON public.client_consents;
CREATE POLICY client_consents_staff_select ON public.client_consents FOR SELECT TO authenticated
  USING (staff_can(owner_id, 'clients', 'view'));
-- Sem policy de INSERT/UPDATE/DELETE para authenticated/anon (proposital)
-- — toda gravação passa pelas server functions com supabaseAdmin, depois
-- de checar staff_can(owner_id, 'clients', 'edit') em código (Parte 2).

-- ===================== SEÇÃO C — imutabilidade (gatilho) =====================
-- DELETE: bloqueado SEMPRE, para qualquer papel, sem excessão — nem
-- service_role. client_consents nunca perde uma linha; "limpar" é só
-- anonimizar via UPDATE (ver purge_client_consent_pii abaixo).
-- UPDATE: bloqueado a menos que a sessão tenha a GUC local
-- aura_consent.cleanup_active = 'on' — e, mesmo nesse caminho, só pode
-- tocar signer_name/evidence_ip/evidence_user_agent; qualquer outra coluna
-- diferente entre OLD e NEW (inclusive created_at/choice/consent_type/
-- document_version/source/owner_id/client_id/collected_by_user_id) lança
-- erro. Essa GUC só é setada dentro de purge_client_consent_pii() — nunca
-- por nenhum outro caminho do app.
-- SECURITY DEFINER (diferente dos gatilhos de automations/journeys, que só
-- comparam NEW/OLD da própria linha): este precisa de SELECT em
-- public.clients/auth.users pra distinguir cascade de delete direto (ver
-- comentário abaixo) — nunca deve depender do papel que disparou o
-- DELETE/UPDATE ter GRANT nessas duas tabelas.
CREATE OR REPLACE FUNCTION public.client_consents_block_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Deixa passar SÓ quando este DELETE é efeito CASCADE de excluir o
    -- `clients`/`auth.users` pai (owner_id/client_id são ON DELETE
    -- CASCADE) — nesse instante o pai referenciado JÁ não existe mais (a
    -- cascata do Postgres remove o pai antes de disparar o DELETE em
    -- cascata no filho). Um DELETE direto nunca encontra essa condição,
    -- porque o pai continua existindo — nunca escapa por aqui.
    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id)
       OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.owner_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING
      ERRCODE = 'UC001',
      MESSAGE = 'AURA_CONSENT_IMMUTABLE: client_consents é somente-inserção; nenhum registro pode ser excluído diretamente.';
  END IF;

  -- TG_OP = 'UPDATE'
  IF current_setting('aura_consent.cleanup_active', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UC001',
      MESSAGE = 'AURA_CONSENT_IMMUTABLE: client_consents é somente-inserção; use purge_client_consent_pii para anonimizar por exclusão de conta.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.consent_type IS DISTINCT FROM OLD.consent_type
     OR NEW.choice IS DISTINCT FROM OLD.choice
     OR NEW.document_key IS DISTINCT FROM OLD.document_key
     OR NEW.document_version IS DISTINCT FROM OLD.document_version
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.collected_by_user_id IS DISTINCT FROM OLD.collected_by_user_id
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'UC002',
      MESSAGE = 'AURA_CONSENT_CLEANUP_SCOPE: a limpeza por exclusão de conta só pode alterar signer_name, evidence_ip e evidence_user_agent.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.client_consents_block_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_10_client_consents_block_mutation ON public.client_consents;
CREATE TRIGGER trg_10_client_consents_block_mutation
  BEFORE UPDATE OR DELETE ON public.client_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.client_consents_block_mutation();

-- ===================== SEÇÃO D — caminho de limpeza (exclusão de conta) =====================
-- Único caminho que pode "editar" uma linha de client_consents: zera
-- SOMENTE signer_name/evidence_ip/evidence_user_agent de TODAS as linhas
-- de um client_id — tipo/escolha/versão/data/fonte nunca mudam (prova
-- mínima de que o consentimento aconteceu). Não apaga nenhuma linha
-- (DELETE continua bloqueado pelo gatilho acima, inclusive aqui).
-- service_role apenas (REVOKE/GRANT abaixo) — chamado pela etapa de
-- exclusão de conta/cliente (fora de escopo desta fase 1A: nenhum fluxo
-- existente chama esta função ainda).
CREATE OR REPLACE FUNCTION public.purge_client_consent_pii(_client_id uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _affected integer;
BEGIN
  PERFORM set_config('aura_consent.cleanup_active', 'on', true);
  UPDATE public.client_consents
  SET signer_name = NULL,
      evidence_ip = NULL,
      evidence_user_agent = NULL
  WHERE client_id = _client_id
    AND (signer_name IS NOT NULL OR evidence_ip IS NOT NULL OR evidence_user_agent IS NOT NULL);
  GET DIAGNOSTICS _affected = ROW_COUNT;
  PERFORM set_config('aura_consent.cleanup_active', 'off', true);
  RETURN _affected;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_client_consent_pii(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_client_consent_pii(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
