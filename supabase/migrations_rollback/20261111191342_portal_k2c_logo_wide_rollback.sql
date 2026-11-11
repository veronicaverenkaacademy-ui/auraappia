-- Rollback de 20261111191342_portal_k2c_logo_wide.sql — devolve
-- portal_media_path_valid, as 2 CHECK constraints e as 5 funções à forma
-- anterior (sem logo_wide_path), e remove as 2 colunas novas
-- (draft_logo_wide_path/published_logo_wide_path).
--
-- NENHUM dado das colunas ANTIGAS é perdido: as 5 funções recriadas abaixo
-- são byte-a-byte as mesmas de antes desta migração (mesmo código que já
-- estava em produção) — só deixam de mencionar logo_wide_path, nunca tocam
-- draft_logo_path/published_logo_path/cover/banner/etc. Um
-- previous_published que já tenha ganhado a chave "logo_wide_path" (de uma
-- publicação feita enquanto esta migração estava aplicada) mantém essa
-- chave extra no jsonb depois do rollback — inofensivo (as funções
-- revertidas simplesmente não leem essa chave), não é perda de dado, é só
-- uma chave que o código revertido ignora.

-- 1 — CHECK constraints de volta à forma sem logo_wide_path (precisa vir
-- antes de dropar as colunas, mesma ordem inversa da migração).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_configurations_draft_paths_check') THEN
    ALTER TABLE public.portal_configurations DROP CONSTRAINT portal_configurations_draft_paths_check;
  END IF;
  ALTER TABLE public.portal_configurations ADD CONSTRAINT portal_configurations_draft_paths_check CHECK (
    (draft_logo_path IS NULL OR public.portal_media_path_valid(draft_logo_path)) AND
    (draft_logo_light_path IS NULL OR public.portal_media_path_valid(draft_logo_light_path)) AND
    (draft_cover_path IS NULL OR public.portal_media_path_valid(draft_cover_path)) AND
    (draft_banner_path IS NULL OR public.portal_media_path_valid(draft_banner_path))
  );

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_configurations_published_paths_check') THEN
    ALTER TABLE public.portal_configurations DROP CONSTRAINT portal_configurations_published_paths_check;
  END IF;
  ALTER TABLE public.portal_configurations ADD CONSTRAINT portal_configurations_published_paths_check CHECK (
    (published_logo_path IS NULL OR public.portal_media_path_valid(published_logo_path)) AND
    (published_logo_light_path IS NULL OR public.portal_media_path_valid(published_logo_light_path)) AND
    (published_cover_path IS NULL OR public.portal_media_path_valid(published_cover_path)) AND
    (published_banner_path IS NULL OR public.portal_media_path_valid(published_banner_path))
  );
END $$;

-- 2 — colunas novas removidas (só o que esta migração criou).
ALTER TABLE public.portal_configurations
  DROP COLUMN IF EXISTS draft_logo_wide_path,
  DROP COLUMN IF EXISTS published_logo_wide_path;

-- 3 — portal_media_path_valid: regex sem "logo-wide".
CREATE OR REPLACE FUNCTION public.portal_media_path_valid(p_path text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo|logo-light|cover|banner|services|professionals|categories)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$';
$$;

-- 4 — portal_salvar_rascunho: forma anterior (sem logo_wide_path).
CREATE OR REPLACE FUNCTION public.portal_salvar_rascunho(p_config jsonb, p_version_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

-- 5 — portal_publicar: forma anterior.
CREATE OR REPLACE FUNCTION public.portal_publicar(p_version_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

-- 6 — portal_desfazer_publicacao: forma anterior.
CREATE OR REPLACE FUNCTION public.portal_desfazer_publicacao()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

-- 7 — portal_descartar_rascunho: forma anterior.
CREATE OR REPLACE FUNCTION public.portal_descartar_rascunho()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

-- 8 — portal_obter_publico: forma anterior.
CREATE OR REPLACE FUNCTION public.portal_obter_publico(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

NOTIFY pgrst, 'reload schema';
