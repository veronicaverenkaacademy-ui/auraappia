-- ROLLBACK de 20261109020000_portal_personalization.sql — remove tudo o
-- que a migração criou, na ordem inversa (funções antes das tabelas que
-- elas referenciam, políticas antes do bucket). Idempotente (IF EXISTS em
-- tudo), seguro rodar de novo ou mesmo se a migração nunca tiver sido
-- aplicada.
--
-- Depois deste rollback:
--   - Portal real (l.$slug.tsx): nenhuma mudança — nunca leu nada desta
--     migração (K1b é quem liga essa leitura, fase seguinte).
--   - services.category_id/image_path, team_members.avatar_url (CHECK):
--     removidos/revertidos — se a K1b já tiver sido aplicada e algum
--     serviço tiver foto/categoria, esse dado é perdido (comportamento
--     esperado de desfazer a feature, nenhum dado ANTERIOR à migração é
--     tocado).
--   - portal_configurations, portal_service_categories: apagadas por
--     completo (DROP TABLE), junto com qualquer rascunho/publicação já
--     salvos.
--   - Bucket portal-media: os ARQUIVOS enviados não são apagados por este
--     rollback (storage.buckets/objects não são tocados aqui de propósito
--     — apagar arquivos é uma decisão maior, feita à parte se necessário);
--     só as políticas de acesso são removidas, então o bucket fica
--     inacessível por RLS até alguém recriar as políticas ou apagar o
--     bucket manualmente.
--   - company_profiles.portal_media_key: removida (nenhuma outra coluna
--     dependia dela fora desta feature).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

-- 7 — GRANTs somem junto com as funções (DROP FUNCTION já revoga tudo).

-- 6 — funções de rascunho/publicação
DROP FUNCTION IF EXISTS public.portal_obter_publico(text);
DROP FUNCTION IF EXISTS public.portal_desfazer_publicacao();
DROP FUNCTION IF EXISTS public.portal_descartar_rascunho();
DROP FUNCTION IF EXISTS public.portal_publicar(integer);
DROP FUNCTION IF EXISTS public.portal_salvar_rascunho(jsonb, integer);
DROP FUNCTION IF EXISTS public.portal_validate_owned_path(text, text);

-- 5 — colunas novas em services/team_members + portal_service_categories
ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_avatar_url_check;

ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_image_path_check;
ALTER TABLE public.services
  DROP COLUMN IF EXISTS image_path,
  DROP COLUMN IF EXISTS category_id;

DROP TABLE IF EXISTS public.portal_service_categories;

-- 4 — portal_configurations (+ trigger de auto-criação em company_profiles)
DROP TRIGGER IF EXISTS portal_configurations_auto_create ON public.company_profiles;
DROP FUNCTION IF EXISTS public.portal_configurations_init();
DROP TABLE IF EXISTS public.portal_configurations;

-- 3 — políticas de storage + bucket portal-media (o bucket em si e os
-- objetos dentro dele NÃO são apagados aqui — ver nota no topo).
DROP POLICY IF EXISTS "portal_media_own_delete" ON storage.objects;
DROP POLICY IF EXISTS "portal_media_own_update" ON storage.objects;
DROP POLICY IF EXISTS "portal_media_own_insert" ON storage.objects;
DROP POLICY IF EXISTS "portal_media_own_select" ON storage.objects;
DROP FUNCTION IF EXISTS public.portal_media_own_folder(text);

-- 2 — company_profiles.portal_media_key
ALTER TABLE public.company_profiles DROP CONSTRAINT IF EXISTS company_profiles_portal_media_key_key;
ALTER TABLE public.company_profiles DROP COLUMN IF EXISTS portal_media_key;

-- 1 — funções auxiliares puras
DROP FUNCTION IF EXISTS public.portal_contrast_ratio(text, text);
DROP FUNCTION IF EXISTS public.portal_relative_luminance(text);
DROP FUNCTION IF EXISTS public.portal_media_path_valid(text);
DROP FUNCTION IF EXISTS public.portal_hex_color_valid(text);

NOTIFY pgrst, 'reload schema';

COMMIT;
