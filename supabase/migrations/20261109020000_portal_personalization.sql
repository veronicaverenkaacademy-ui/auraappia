-- FASE K1a-1 (09/11/2026): bastidores da personalização do Portal Público
-- (/l/:slug) — tabelas, bucket e funções de rascunho/publicação. NÃO MUDA
-- NADA visível ainda: o portal real (l.$slug.tsx) continua lendo só
-- company_profiles, como hoje — só a K1b (fase seguinte) liga a leitura do
-- publicado. ESTE ARQUIVO AINDA NÃO FOI APLICADO EM PRODUÇÃO — só roda
-- quando a dona enviar a mensagem "AUTORIZO APLICAR MIGRAÇÃO FASE K1".
--
-- Modelo escolhido (Etapa 0, item 2.8): UMA linha por empresa em
-- portal_configurations, com duas famílias de colunas espelhadas
-- (draft_* / published_*) em vez de duas tabelas/linhas — torna a
-- publicação um único UPDATE atômico (copia draft_* -> published_*), sem
-- precisar sincronizar duas linhas. "Desfazer última publicação" (1 nível)
-- é uma única coluna jsonb (previous_published) com o published_* anterior
-- — portal_desfazer_publicacao() troca (swap) published_* <->
-- previous_published, o que também permite "refazer" chamando de novo.
--
-- Permissão (achado da Etapa 0, item 2.5): editar company_profiles hoje é
-- EXCLUSIVO da dona — RLS owner_id=auth.uid() + is_admin(auth.uid()) no
-- servidor, sem nenhum staff_can envolvido (não existe recurso
-- 'empresa'/'portal' em team_permissions/access_level_permissions).
-- portal_configurations segue exatamente a mesma regra — nenhuma permissão
-- nova é inventada.
--
-- Armazenamento (achado da Etapa 0, item 2.4): bucket novo "portal-media"
-- (não mexe no "company-assets" existente, que guarda só logo/capa da aba
-- Empresa). Caminho opaco {portal_media_key}/{espaço}/{uuid}.{ext} — ao
-- contrário de company-assets (que usa {owner_id}/logo), o identificador de
-- pasta aqui NUNCA é o auth.uid() real, evitando expor o id interno da
-- conta em URLs públicas. portal_media_key é gerado automaticamente por
-- empresa (coluna nova em company_profiles, 1 por linha, já existente —
-- ALTER TABLE ADD COLUMN com DEFAULT volátil recalcula um valor por linha,
-- nunca repete o mesmo uuid em todas).
--
-- Fotos de serviço/categoria/profissional (item 3.2) NÃO entram no
-- draft/publish: atualizam na hora, igual preço/nome de um serviço hoje —
-- não existe "rascunho" de foto de serviço, só do portal como um todo.
--
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING),
-- sem DROP destrutivo, RLS ligada em tudo que é novo, GRANT/REVOKE
-- explícitos, funções de escrita negadas para anon, SECURITY DEFINER com
-- search_path fixo. NOTIFY pgrst no final (padrão do projeto).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- =====================================================================================
-- 1 — funções auxiliares puras (validação), reaproveitadas em vários CHECKs
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.portal_hex_color_valid(p_hex text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_hex ~ '^#[0-9a-f]{6}$';
$$;

-- Formato {portal_media_key}/{espaço}/{uuid}.{ext} — os únicos "espaços"
-- válidos são os definidos no app (item 3.3); nunca ".." nem barra dupla
-- (o padrão exige exatamente 2 segmentos entre as barras, cada um
-- validado por si, então não há como escapar da estrutura).
CREATE OR REPLACE FUNCTION public.portal_media_path_valid(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo|logo-light|cover|banner|services|professionals|categories)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$';
$$;

-- Luminância relativa WCAG (coeficientes sRGB padrão) e razão de contraste
-- — ESPELHA o validador TS equivalente (src/lib/portal-contrast.ts, K1a-2),
-- mesmo padrão já usado pelo projeto para regras de negócio duplicadas
-- (apply_whatsapp_central_reply espelha central-reply-decision.ts): o TS é
-- quem valida em tempo real na tela, esta função é o backstop que
-- portal_publicar() reconfirma antes de publicar, nunca confiando só na
-- checagem client-side.
CREATE OR REPLACE FUNCTION public.portal_relative_luminance(p_hex text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH rgb AS (
    SELECT
      ('x' || substr(p_hex, 2, 2))::bit(8)::int AS r,
      ('x' || substr(p_hex, 4, 2))::bit(8)::int AS g,
      ('x' || substr(p_hex, 6, 2))::bit(8)::int AS b
  ),
  lin AS (
    SELECT
      CASE WHEN r / 255.0 <= 0.03928 THEN r / 255.0 / 12.92 ELSE power((r / 255.0 + 0.055) / 1.055, 2.4) END AS rl,
      CASE WHEN g / 255.0 <= 0.03928 THEN g / 255.0 / 12.92 ELSE power((g / 255.0 + 0.055) / 1.055, 2.4) END AS gl,
      CASE WHEN b / 255.0 <= 0.03928 THEN b / 255.0 / 12.92 ELSE power((b / 255.0 + 0.055) / 1.055, 2.4) END AS bl
    FROM rgb
  )
  SELECT 0.2126 * rl + 0.7152 * gl + 0.0722 * bl FROM lin;
$$;

CREATE OR REPLACE FUNCTION public.portal_contrast_ratio(p_hex_a text, p_hex_b text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (GREATEST(la, lb) + 0.05) / (LEAST(la, lb) + 0.05)
  FROM (
    SELECT public.portal_relative_luminance(p_hex_a) AS la, public.portal_relative_luminance(p_hex_b) AS lb
  ) s;
$$;

-- =====================================================================================
-- 2 — company_profiles.portal_media_key (identificador opaco de pasta)
-- =====================================================================================
ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS portal_media_key uuid NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_profiles_portal_media_key_key'
  ) THEN
    ALTER TABLE public.company_profiles ADD CONSTRAINT company_profiles_portal_media_key_key UNIQUE (portal_media_key);
  END IF;
END $$;

COMMENT ON COLUMN public.company_profiles.portal_media_key IS
  'Pasta opaca da empresa no bucket portal-media (FASE K1, 11/2026) — nunca o auth.uid() real, ao contrário do bucket company-assets antigo. Gerado automaticamente, nunca editável pela dona.';

-- =====================================================================================
-- 3 — bucket portal-media + políticas de storage
-- =====================================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('portal-media', 'portal-media', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- (storage.foldername(name))[1] é o primeiro segmento do caminho — aqui é
-- o portal_media_key (texto), nunca o auth.uid(). own_folder confere que
-- quem está logada é a DONA (is_admin) da empresa dona daquela chave —
-- equipe nunca sobe/apaga mídia do portal (item 2.5).
CREATE OR REPLACE FUNCTION public.portal_media_own_folder(p_folder text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_profiles cp
    WHERE cp.portal_media_key::text = p_folder
      AND cp.owner_id = auth.uid()
      AND public.is_admin(auth.uid())
  );
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'portal_media_own_select') THEN
    CREATE POLICY "portal_media_own_select" ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'portal-media' AND public.portal_media_own_folder((storage.foldername(name))[1]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'portal_media_own_insert') THEN
    CREATE POLICY "portal_media_own_insert" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'portal-media' AND public.portal_media_own_folder((storage.foldername(name))[1]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'portal_media_own_update') THEN
    CREATE POLICY "portal_media_own_update" ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'portal-media' AND public.portal_media_own_folder((storage.foldername(name))[1]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'portal_media_own_delete') THEN
    CREATE POLICY "portal_media_own_delete" ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'portal-media' AND public.portal_media_own_folder((storage.foldername(name))[1]));
  END IF;
END $$;
-- Leitura pública dos arquivos vem do bucket ser public=true (URL direta,
-- sem passar por RLS) — a policy de SELECT acima é só para a API de
-- Storage conseguir devolver os metadados no INSERT...RETURNING (mesmo bug
-- já corrigido em company-assets, ver PRs #35/#78: sem SELECT, todo upload
-- falhava com erro genérico de RLS). Nenhuma policy de listagem de bucket
-- é criada (list() não é usado pelo app; a API de Storage já nega por
-- padrão sem uma policy explícita).

-- =====================================================================================
-- 4 — portal_configurations (1 linha por empresa, draft + published)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.portal_configurations (
  owner_id uuid PRIMARY KEY REFERENCES public.company_profiles(owner_id) ON DELETE CASCADE,

  -- RASCUNHO
  draft_theme_key text,
  draft_color_primary text,
  draft_color_secondary text,
  draft_color_button text,
  draft_color_button_text text,
  draft_color_text text,
  draft_color_background text,
  draft_font_key text NOT NULL DEFAULT 'system',
  draft_cover_title text,
  draft_cover_subtitle text,
  draft_banner_text text,
  draft_important_title text,
  draft_important_text text,
  draft_welcome_message text,
  draft_show_shortcuts boolean NOT NULL DEFAULT true,
  draft_show_banner boolean NOT NULL DEFAULT true,
  draft_show_services boolean NOT NULL DEFAULT true,
  draft_show_important boolean NOT NULL DEFAULT true,
  draft_show_professionals boolean NOT NULL DEFAULT true,
  draft_show_location boolean NOT NULL DEFAULT true,
  draft_show_footer boolean NOT NULL DEFAULT true,
  draft_logo_path text,
  draft_logo_light_path text,
  draft_cover_path text,
  draft_banner_path text,

  -- PUBLICADO (espelha o rascunho; tudo NULL até a 1ª publicação)
  published_theme_key text,
  published_color_primary text,
  published_color_secondary text,
  published_color_button text,
  published_color_button_text text,
  published_color_text text,
  published_color_background text,
  published_font_key text,
  published_cover_title text,
  published_cover_subtitle text,
  published_banner_text text,
  published_important_title text,
  published_important_text text,
  published_welcome_message text,
  published_show_shortcuts boolean,
  published_show_banner boolean,
  published_show_services boolean,
  published_show_important boolean,
  published_show_professionals boolean,
  published_show_location boolean,
  published_show_footer boolean,
  published_logo_path text,
  published_logo_light_path text,
  published_cover_path text,
  published_banner_path text,

  previous_published jsonb,
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),

  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT portal_configurations_draft_colors_check CHECK (
    (draft_color_primary IS NULL OR public.portal_hex_color_valid(draft_color_primary)) AND
    (draft_color_secondary IS NULL OR public.portal_hex_color_valid(draft_color_secondary)) AND
    (draft_color_button IS NULL OR public.portal_hex_color_valid(draft_color_button)) AND
    (draft_color_button_text IS NULL OR public.portal_hex_color_valid(draft_color_button_text)) AND
    (draft_color_text IS NULL OR public.portal_hex_color_valid(draft_color_text)) AND
    (draft_color_background IS NULL OR public.portal_hex_color_valid(draft_color_background))
  ),
  CONSTRAINT portal_configurations_published_colors_check CHECK (
    (published_color_primary IS NULL OR public.portal_hex_color_valid(published_color_primary)) AND
    (published_color_secondary IS NULL OR public.portal_hex_color_valid(published_color_secondary)) AND
    (published_color_button IS NULL OR public.portal_hex_color_valid(published_color_button)) AND
    (published_color_button_text IS NULL OR public.portal_hex_color_valid(published_color_button_text)) AND
    (published_color_text IS NULL OR public.portal_hex_color_valid(published_color_text)) AND
    (published_color_background IS NULL OR public.portal_hex_color_valid(published_color_background))
  ),
  CONSTRAINT portal_configurations_font_key_check CHECK (
    draft_font_key IN ('system', 'serif_fine', 'geometric_sans', 'humanist_sans') AND
    (published_font_key IS NULL OR published_font_key IN ('system', 'serif_fine', 'geometric_sans', 'humanist_sans'))
  ),
  CONSTRAINT portal_configurations_draft_text_lengths_check CHECK (
    (draft_cover_title IS NULL OR char_length(draft_cover_title) <= 80) AND
    (draft_cover_subtitle IS NULL OR char_length(draft_cover_subtitle) <= 160) AND
    (draft_banner_text IS NULL OR char_length(draft_banner_text) <= 100) AND
    (draft_important_title IS NULL OR char_length(draft_important_title) <= 60) AND
    (draft_important_text IS NULL OR char_length(draft_important_text) <= 600) AND
    (draft_welcome_message IS NULL OR char_length(draft_welcome_message) <= 300)
  ),
  CONSTRAINT portal_configurations_published_text_lengths_check CHECK (
    (published_cover_title IS NULL OR char_length(published_cover_title) <= 80) AND
    (published_cover_subtitle IS NULL OR char_length(published_cover_subtitle) <= 160) AND
    (published_banner_text IS NULL OR char_length(published_banner_text) <= 100) AND
    (published_important_title IS NULL OR char_length(published_important_title) <= 60) AND
    (published_important_text IS NULL OR char_length(published_important_text) <= 600) AND
    (published_welcome_message IS NULL OR char_length(published_welcome_message) <= 300)
  ),
  CONSTRAINT portal_configurations_draft_paths_check CHECK (
    (draft_logo_path IS NULL OR public.portal_media_path_valid(draft_logo_path)) AND
    (draft_logo_light_path IS NULL OR public.portal_media_path_valid(draft_logo_light_path)) AND
    (draft_cover_path IS NULL OR public.portal_media_path_valid(draft_cover_path)) AND
    (draft_banner_path IS NULL OR public.portal_media_path_valid(draft_banner_path))
  ),
  CONSTRAINT portal_configurations_published_paths_check CHECK (
    (published_logo_path IS NULL OR public.portal_media_path_valid(published_logo_path)) AND
    (published_logo_light_path IS NULL OR public.portal_media_path_valid(published_logo_light_path)) AND
    (published_cover_path IS NULL OR public.portal_media_path_valid(published_cover_path)) AND
    (published_banner_path IS NULL OR public.portal_media_path_valid(published_banner_path))
  )
);

COMMENT ON TABLE public.portal_configurations IS
  'Rascunho e publicado da personalização visual do Portal Público, 1 linha por empresa (FASE K1, 11/2026). previous_published guarda o published_* anterior (1 nível de desfazer, via swap). Nenhuma coluna aqui é lida pelo portal real ainda — isso é K1b.';

ALTER TABLE public.portal_configurations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'portal_configurations' AND policyname = 'portal_configurations_own_all') THEN
    CREATE POLICY "portal_configurations_own_all" ON public.portal_configurations FOR ALL TO authenticated
      USING (owner_id = auth.uid())
      WITH CHECK (owner_id = auth.uid());
  END IF;
END $$;

REVOKE ALL ON public.portal_configurations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_configurations TO authenticated;

-- Backfill: 1 linha por empresa já existente, com os padrões acima (nunca
-- copia logo_url/cover_image_url da aba Empresa — são de outro bucket,
-- outro formato de caminho; o fallback pro valor atual acontece em tempo
-- de leitura na K1b, não aqui).
INSERT INTO public.portal_configurations (owner_id)
SELECT owner_id FROM public.company_profiles
ON CONFLICT (owner_id) DO NOTHING;

-- Empresa NOVA (cadastrada depois desta migração) também precisa de uma
-- linha — sem isto, só as empresas que já existiam no momento da migração
-- teriam portal_configurations, e portal_salvar_rascunho() de uma empresa
-- criada depois devolveria 'nao_encontrado' pra sempre (a função só faz
-- UPDATE, nunca INSERT). Dispara DEPOIS do INSERT em company_profiles —
-- mesmo ponto de inserção usado pelo cadastro da empresa hoje
-- (upsertCompanyProfile), então toda empresa nova já nasce com rascunho.
CREATE OR REPLACE FUNCTION public.portal_configurations_init()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.portal_configurations (owner_id) VALUES (NEW.owner_id)
  ON CONFLICT (owner_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS portal_configurations_auto_create ON public.company_profiles;
CREATE TRIGGER portal_configurations_auto_create
  AFTER INSERT ON public.company_profiles
  FOR EACH ROW EXECUTE FUNCTION public.portal_configurations_init();

-- =====================================================================================
-- 5 — portal_service_categories + colunas novas em services
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.portal_service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  image_path text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_service_categories_name_check CHECK (char_length(name) BETWEEN 1 AND 60),
  CONSTRAINT portal_service_categories_image_path_check CHECK (image_path IS NULL OR public.portal_media_path_valid(image_path))
);

COMMENT ON TABLE public.portal_service_categories IS
  'Categorias de serviço do Portal Público (ex.: "Cílios", "Sobrancelhas") — não existiam antes da FASE K1 (11/2026); cadastro de serviços não tinha conceito de categoria.';

ALTER TABLE public.portal_service_categories ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'portal_service_categories' AND policyname = 'portal_service_categories_own_all') THEN
    CREATE POLICY "portal_service_categories_own_all" ON public.portal_service_categories FOR ALL TO authenticated
      USING (owner_id = auth.uid())
      WITH CHECK (owner_id = auth.uid());
  END IF;
END $$;

REVOKE ALL ON public.portal_service_categories FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_service_categories TO authenticated;

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.portal_service_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_path text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_image_path_check') THEN
    ALTER TABLE public.services ADD CONSTRAINT services_image_path_check
      CHECK (image_path IS NULL OR public.portal_media_path_valid(image_path));
  END IF;
END $$;

COMMENT ON COLUMN public.services.category_id IS 'Categoria do Portal Público (FASE K1, 11/2026) — opcional, nunca obrigatório; serviço sem categoria continua funcionando normalmente em todo o resto do app.';
COMMENT ON COLUMN public.services.image_path IS 'Caminho no bucket portal-media (FASE K1, 11/2026) — atualiza na hora, não passa por rascunho/publicação.';

-- team_members.avatar_url já existe (usada por public_professionals) — só
-- ganha o mesmo CHECK de formato, sem mudar tipo/dado (tabela tem 1 linha
-- hoje, nenhuma com avatar_url preenchido — conferido antes de escrever
-- esta migração, sem risco de quebrar valor existente).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'team_members_avatar_url_check') THEN
    ALTER TABLE public.team_members ADD CONSTRAINT team_members_avatar_url_check
      CHECK (avatar_url IS NULL OR public.portal_media_path_valid(avatar_url) OR avatar_url ~ '^https?://');
  END IF;
END $$;
-- Aceita tanto o caminho novo (portal-media) quanto uma URL http(s) antiga
-- — nenhum dado existente é invalidado, e nada impede reverter pra uma URL
-- externa manualmente se um dia for preciso.

-- =====================================================================================
-- 6 — funções de rascunho/publicação (SECURITY DEFINER, search_path fixo)
-- =====================================================================================

-- Confere que o caminho (se presente) pertence à PRÓPRIA pasta da empresa
-- e que o objeto de fato existe no bucket — a única validação que um CHECK
-- de coluna não consegue fazer sozinho (precisa consultar outras tabelas).
CREATE OR REPLACE FUNCTION public.portal_validate_owned_path(p_path text, p_media_key text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_path IS NULL THEN
    RETURN NULL;
  END IF;
  IF split_part(p_path, '/', 1) <> p_media_key THEN
    RETURN 'caminho_invalido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'portal-media' AND name = p_path) THEN
    RETURN 'arquivo_inexistente';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_salvar_rascunho(p_config jsonb, p_version_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.portal_configurations;
  v_media_key text;
  v_err text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.version <> p_version_esperada THEN
    RETURN 'conflito_versao';
  END IF;

  SELECT portal_media_key::text INTO v_media_key FROM public.company_profiles WHERE owner_id = auth.uid();

  FOR v_err IN
    SELECT public.portal_validate_owned_path(p_config ->> col, v_media_key)
    FROM unnest(ARRAY['logo_path', 'logo_light_path', 'cover_path', 'banner_path']) AS col
  LOOP
    IF v_err IS NOT NULL THEN
      RETURN v_err;
    END IF;
  END LOOP;

  BEGIN
    -- "Salvar rascunho" é uma MESCLA, não uma substituição total: uma
    -- chamada só com as chaves alteradas (ex.: só 'welcome_message', vindo
    -- da seção "Textos" do painel) não pode apagar cor/fonte/imagens já
    -- salvas por outra seção. CASE WHEN p_config ? 'chave' distingue
    -- "chave ausente" (preserva o valor atual) de "chave presente, mesmo
    -- que vazia" (permite limpar o campo de propósito, inclusive imagem —
    -- enviar '' remove o caminho salvo). COALESCE sozinho (usado só nos
    -- booleans abaixo) não bastaria aqui: NULL por ausência e NULL por
    -- "campo realmente vazio" teriam o mesmo efeito, que é o que queremos
    -- para esses, mas NÃO para os campos de texto/cor/caminho.
    UPDATE public.portal_configurations SET
      draft_theme_key = CASE WHEN p_config ? 'theme_key' THEN NULLIF(p_config ->> 'theme_key', '') ELSE draft_theme_key END,
      draft_color_primary = CASE WHEN p_config ? 'color_primary' THEN NULLIF(p_config ->> 'color_primary', '') ELSE draft_color_primary END,
      draft_color_secondary = CASE WHEN p_config ? 'color_secondary' THEN NULLIF(p_config ->> 'color_secondary', '') ELSE draft_color_secondary END,
      draft_color_button = CASE WHEN p_config ? 'color_button' THEN NULLIF(p_config ->> 'color_button', '') ELSE draft_color_button END,
      draft_color_button_text = CASE WHEN p_config ? 'color_button_text' THEN NULLIF(p_config ->> 'color_button_text', '') ELSE draft_color_button_text END,
      draft_color_text = CASE WHEN p_config ? 'color_text' THEN NULLIF(p_config ->> 'color_text', '') ELSE draft_color_text END,
      draft_color_background = CASE WHEN p_config ? 'color_background' THEN NULLIF(p_config ->> 'color_background', '') ELSE draft_color_background END,
      draft_font_key = CASE WHEN p_config ? 'font_key' THEN COALESCE(NULLIF(p_config ->> 'font_key', ''), 'system') ELSE draft_font_key END,
      draft_cover_title = CASE WHEN p_config ? 'cover_title' THEN NULLIF(p_config ->> 'cover_title', '') ELSE draft_cover_title END,
      draft_cover_subtitle = CASE WHEN p_config ? 'cover_subtitle' THEN NULLIF(p_config ->> 'cover_subtitle', '') ELSE draft_cover_subtitle END,
      draft_banner_text = CASE WHEN p_config ? 'banner_text' THEN NULLIF(p_config ->> 'banner_text', '') ELSE draft_banner_text END,
      draft_important_title = CASE WHEN p_config ? 'important_title' THEN NULLIF(p_config ->> 'important_title', '') ELSE draft_important_title END,
      draft_important_text = CASE WHEN p_config ? 'important_text' THEN NULLIF(p_config ->> 'important_text', '') ELSE draft_important_text END,
      draft_welcome_message = CASE WHEN p_config ? 'welcome_message' THEN NULLIF(p_config ->> 'welcome_message', '') ELSE draft_welcome_message END,
      draft_show_shortcuts = COALESCE((p_config ->> 'show_shortcuts')::boolean, draft_show_shortcuts),
      draft_show_banner = COALESCE((p_config ->> 'show_banner')::boolean, draft_show_banner),
      draft_show_services = COALESCE((p_config ->> 'show_services')::boolean, draft_show_services),
      draft_show_important = COALESCE((p_config ->> 'show_important')::boolean, draft_show_important),
      draft_show_professionals = COALESCE((p_config ->> 'show_professionals')::boolean, draft_show_professionals),
      draft_show_location = COALESCE((p_config ->> 'show_location')::boolean, draft_show_location),
      draft_show_footer = COALESCE((p_config ->> 'show_footer')::boolean, draft_show_footer),
      draft_logo_path = CASE WHEN p_config ? 'logo_path' THEN NULLIF(p_config ->> 'logo_path', '') ELSE draft_logo_path END,
      draft_logo_light_path = CASE WHEN p_config ? 'logo_light_path' THEN NULLIF(p_config ->> 'logo_light_path', '') ELSE draft_logo_light_path END,
      draft_cover_path = CASE WHEN p_config ? 'cover_path' THEN NULLIF(p_config ->> 'cover_path', '') ELSE draft_cover_path END,
      draft_banner_path = CASE WHEN p_config ? 'banner_path' THEN NULLIF(p_config ->> 'banner_path', '') ELSE draft_banner_path END,
      version = version + 1,
      updated_at = now(),
      updated_by = auth.uid()
    WHERE owner_id = auth.uid() AND version = p_version_esperada;
  EXCEPTION WHEN check_violation THEN
    RETURN 'config_invalida';
  END;

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_publicar(p_version_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.portal_configurations;
  v_prev jsonb;
  v_text_color text;
  v_bg_color text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.version <> p_version_esperada THEN
    RETURN 'conflito_versao';
  END IF;

  -- Contraste mínimo 3:1 texto×fundo é BLOQUEANTE pra publicar (item 4.4) —
  -- só reconfirma quando os dois estão definidos; se algum estiver NULL, o
  -- front ainda não customizou cor nenhuma, então não há o que bloquear.
  v_text_color := COALESCE(v_row.draft_color_text, '#211c1a');
  v_bg_color := COALESCE(v_row.draft_color_background, '#f8f5f0');
  IF public.portal_contrast_ratio(v_text_color, v_bg_color) < 3.0 THEN
    RETURN 'contraste_insuficiente';
  END IF;

  v_prev := CASE WHEN v_row.published_at IS NULL THEN NULL ELSE jsonb_build_object(
    'theme_key', v_row.published_theme_key,
    'color_primary', v_row.published_color_primary,
    'color_secondary', v_row.published_color_secondary,
    'color_button', v_row.published_color_button,
    'color_button_text', v_row.published_color_button_text,
    'color_text', v_row.published_color_text,
    'color_background', v_row.published_color_background,
    'font_key', v_row.published_font_key,
    'cover_title', v_row.published_cover_title,
    'cover_subtitle', v_row.published_cover_subtitle,
    'banner_text', v_row.published_banner_text,
    'important_title', v_row.published_important_title,
    'important_text', v_row.published_important_text,
    'welcome_message', v_row.published_welcome_message,
    'show_shortcuts', v_row.published_show_shortcuts,
    'show_banner', v_row.published_show_banner,
    'show_services', v_row.published_show_services,
    'show_important', v_row.published_show_important,
    'show_professionals', v_row.published_show_professionals,
    'show_location', v_row.published_show_location,
    'show_footer', v_row.published_show_footer,
    'logo_path', v_row.published_logo_path,
    'logo_light_path', v_row.published_logo_light_path,
    'cover_path', v_row.published_cover_path,
    'banner_path', v_row.published_banner_path
  ) END;

  UPDATE public.portal_configurations SET
    published_theme_key = draft_theme_key,
    published_color_primary = draft_color_primary,
    published_color_secondary = draft_color_secondary,
    published_color_button = draft_color_button,
    published_color_button_text = draft_color_button_text,
    published_color_text = draft_color_text,
    published_color_background = draft_color_background,
    published_font_key = draft_font_key,
    published_cover_title = draft_cover_title,
    published_cover_subtitle = draft_cover_subtitle,
    published_banner_text = draft_banner_text,
    published_important_title = draft_important_title,
    published_important_text = draft_important_text,
    published_welcome_message = draft_welcome_message,
    published_show_shortcuts = draft_show_shortcuts,
    published_show_banner = draft_show_banner,
    published_show_services = draft_show_services,
    published_show_important = draft_show_important,
    published_show_professionals = draft_show_professionals,
    published_show_location = draft_show_location,
    published_show_footer = draft_show_footer,
    published_logo_path = draft_logo_path,
    published_logo_light_path = draft_logo_light_path,
    published_cover_path = draft_cover_path,
    published_banner_path = draft_banner_path,
    previous_published = v_prev,
    published_at = now(),
    published_by = auth.uid(),
    version = version + 1
  WHERE owner_id = auth.uid() AND version = p_version_esperada;

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (auth.uid(), auth.uid(), NULL, 'portal_published', 'portal_configurations', auth.uid()::text, NULL);

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_descartar_rascunho()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  UPDATE public.portal_configurations SET
    draft_theme_key = COALESCE(published_theme_key, 'system'),
    draft_color_primary = published_color_primary,
    draft_color_secondary = published_color_secondary,
    draft_color_button = published_color_button,
    draft_color_button_text = published_color_button_text,
    draft_color_text = published_color_text,
    draft_color_background = published_color_background,
    draft_font_key = COALESCE(published_font_key, 'system'),
    draft_cover_title = published_cover_title,
    draft_cover_subtitle = published_cover_subtitle,
    draft_banner_text = published_banner_text,
    draft_important_title = published_important_title,
    draft_important_text = published_important_text,
    draft_welcome_message = published_welcome_message,
    draft_show_shortcuts = COALESCE(published_show_shortcuts, true),
    draft_show_banner = COALESCE(published_show_banner, true),
    draft_show_services = COALESCE(published_show_services, true),
    draft_show_important = COALESCE(published_show_important, true),
    draft_show_professionals = COALESCE(published_show_professionals, true),
    draft_show_location = COALESCE(published_show_location, true),
    draft_show_footer = COALESCE(published_show_footer, true),
    draft_logo_path = published_logo_path,
    draft_logo_light_path = published_logo_light_path,
    draft_cover_path = published_cover_path,
    draft_banner_path = published_banner_path,
    version = version + 1,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE owner_id = auth.uid();

  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_desfazer_publicacao()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.portal_configurations;
  v_current jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN 'sem_permissao';
  END IF;

  SELECT * INTO v_row FROM public.portal_configurations WHERE owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrado';
  END IF;
  IF v_row.previous_published IS NULL THEN
    RETURN 'nada_para_desfazer';
  END IF;

  v_current := jsonb_build_object(
    'theme_key', v_row.published_theme_key,
    'color_primary', v_row.published_color_primary,
    'color_secondary', v_row.published_color_secondary,
    'color_button', v_row.published_color_button,
    'color_button_text', v_row.published_color_button_text,
    'color_text', v_row.published_color_text,
    'color_background', v_row.published_color_background,
    'font_key', v_row.published_font_key,
    'cover_title', v_row.published_cover_title,
    'cover_subtitle', v_row.published_cover_subtitle,
    'banner_text', v_row.published_banner_text,
    'important_title', v_row.published_important_title,
    'important_text', v_row.published_important_text,
    'welcome_message', v_row.published_welcome_message,
    'show_shortcuts', v_row.published_show_shortcuts,
    'show_banner', v_row.published_show_banner,
    'show_services', v_row.published_show_services,
    'show_important', v_row.published_show_important,
    'show_professionals', v_row.published_show_professionals,
    'show_location', v_row.published_show_location,
    'show_footer', v_row.published_show_footer,
    'logo_path', v_row.published_logo_path,
    'logo_light_path', v_row.published_logo_light_path,
    'cover_path', v_row.published_cover_path,
    'banner_path', v_row.published_banner_path
  );

  UPDATE public.portal_configurations SET
    published_theme_key = previous_published ->> 'theme_key',
    published_color_primary = previous_published ->> 'color_primary',
    published_color_secondary = previous_published ->> 'color_secondary',
    published_color_button = previous_published ->> 'color_button',
    published_color_button_text = previous_published ->> 'color_button_text',
    published_color_text = previous_published ->> 'color_text',
    published_color_background = previous_published ->> 'color_background',
    published_font_key = previous_published ->> 'font_key',
    published_cover_title = previous_published ->> 'cover_title',
    published_cover_subtitle = previous_published ->> 'cover_subtitle',
    published_banner_text = previous_published ->> 'banner_text',
    published_important_title = previous_published ->> 'important_title',
    published_important_text = previous_published ->> 'important_text',
    published_welcome_message = previous_published ->> 'welcome_message',
    published_show_shortcuts = (previous_published ->> 'show_shortcuts')::boolean,
    published_show_banner = (previous_published ->> 'show_banner')::boolean,
    published_show_services = (previous_published ->> 'show_services')::boolean,
    published_show_important = (previous_published ->> 'show_important')::boolean,
    published_show_professionals = (previous_published ->> 'show_professionals')::boolean,
    published_show_location = (previous_published ->> 'show_location')::boolean,
    published_show_footer = (previous_published ->> 'show_footer')::boolean,
    published_logo_path = previous_published ->> 'logo_path',
    published_logo_light_path = previous_published ->> 'logo_light_path',
    published_cover_path = previous_published ->> 'cover_path',
    published_banner_path = previous_published ->> 'banner_path',
    previous_published = v_current,
    published_at = now(),
    published_by = auth.uid(),
    version = version + 1
  WHERE owner_id = auth.uid();

  INSERT INTO public.audit_log (owner_id, actor_id, actor_name, action, resource, resource_id, details)
  VALUES (auth.uid(), auth.uid(), NULL, 'portal_publish_undone', 'portal_configurations', auth.uid()::text, NULL);

  RETURN 'ok';
END;
$$;

-- Leitura pública — só o PUBLICADO, só campos seguros (nunca owner_id,
-- nunca e-mail/telefone/fiscal). NULL (não erro) quando o slug não existe
-- ou a empresa nunca publicou nada — item 1.1 da K1b trata esse NULL como
-- "usa o comportamento atual do portal, sem nenhuma customização".
CREATE OR REPLACE FUNCTION public.portal_obter_publico(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'published_at', pc.published_at,
    'theme_key', pc.published_theme_key,
    'color_primary', pc.published_color_primary,
    'color_secondary', pc.published_color_secondary,
    'color_button', pc.published_color_button,
    'color_button_text', pc.published_color_button_text,
    'color_text', pc.published_color_text,
    'color_background', pc.published_color_background,
    'font_key', pc.published_font_key,
    'cover_title', pc.published_cover_title,
    'cover_subtitle', pc.published_cover_subtitle,
    'banner_text', pc.published_banner_text,
    'important_title', pc.published_important_title,
    'important_text', pc.published_important_text,
    'welcome_message', pc.published_welcome_message,
    'show_shortcuts', pc.published_show_shortcuts,
    'show_banner', pc.published_show_banner,
    'show_services', pc.published_show_services,
    'show_important', pc.published_show_important,
    'show_professionals', pc.published_show_professionals,
    'show_location', pc.published_show_location,
    'show_footer', pc.published_show_footer,
    'logo_path', pc.published_logo_path,
    'logo_light_path', pc.published_logo_light_path,
    'cover_path', pc.published_cover_path,
    'banner_path', pc.published_banner_path
  )
  FROM public.company_profiles cp
  JOIN public.portal_configurations pc ON pc.owner_id = cp.owner_id
  WHERE cp.slug = p_slug AND pc.published_at IS NOT NULL;
$$;

-- =====================================================================================
-- 7 — GRANTs das funções (escrita: só authenticated; leitura pública: + anon)
-- =====================================================================================
REVOKE ALL ON FUNCTION public.portal_salvar_rascunho(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_salvar_rascunho(jsonb, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.portal_publicar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_publicar(integer) TO authenticated;

REVOKE ALL ON FUNCTION public.portal_descartar_rascunho() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_descartar_rascunho() TO authenticated;

REVOKE ALL ON FUNCTION public.portal_desfazer_publicacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_desfazer_publicacao() TO authenticated;

REVOKE ALL ON FUNCTION public.portal_obter_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_obter_publico(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
