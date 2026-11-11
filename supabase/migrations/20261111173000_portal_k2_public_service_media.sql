-- FASE K2a — expõe na leitura pública (anon) só o que falta pro visual novo
-- do portal mostrar foto e categoria dos serviços: image_path/category_id em
-- public_services, e uma view nova só de leitura para
-- portal_service_categories. NENHUMA coluna privada (custo, notas, comissão,
-- dados de equipe) e NENHUM owner_id/uuid interno novo — o padrão já usado
-- aqui (ver 20260808070000_client_booking.sql) já expõe owner_id em
-- public_services/public_professionals, então repetir isso nas categorias é
-- consistente com o que já existe, não uma exposição nova.
--
-- image_path (serviços e categorias) já está no formato opaco
-- {portal_media_key}/{kind}/{fileId}.{ext} (CHECK portal_media_path_valid,
-- migração 20261109020000_portal_personalization.sql) — portal_media_key é
-- um UUID aleatório, nunca owner_id/auth.uid() real (ver comentário daquela
-- migração) — exatamente o mesmo dado que portal_obter_publico() já devolve
-- hoje em published_logo_path/published_cover_path. Não é uma exposição nova
-- de identificador interno, é o mesmo padrão já em produção.
--
-- description em public_services já é pública hoje (coluna já existe na view
-- desde 20260808070000) — nada a decidir aqui, só confirmado.
--
-- Sem security_invoker: mesmo padrão das views existentes (public_services,
-- public_professionals, public_company_profiles) — nenhuma delas define essa
-- opção, então rodam com o privilégio de quem criou a view (bypassa RLS da
-- tabela base) e a única fronteira de segurança é a lista de colunas + o
-- WHERE da própria view, não RLS. Por isso a lista de colunas abaixo é
-- deliberadamente mínima.
--
-- Isolamento entre empresas: igual ao padrão já existente — a view NÃO
-- filtra por empresa (nem public_services nem public_professionals fazem
-- isso); quem filtra por owner_id é sempre a consulta do app
-- (fetchPublicServices já faz `.eq("owner_id", ownerId)`). Esta migração não
-- piora nem melhora essa fronteira, só repete o padrão já auditado.

-- =====================================================================================
-- 1 — public_services: acrescenta image_path e category_id NO FINAL — todas
-- as colunas e a ordem atuais (id, owner_id, name, description, price,
-- duration_min, color) continuam exatamente iguais.
-- =====================================================================================
CREATE OR REPLACE VIEW public.public_services AS
SELECT id, owner_id, name, description, price, duration_min, color, image_path, category_id
FROM public.services
WHERE active = true;

GRANT SELECT ON public.public_services TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_services FROM anon, authenticated;

-- =====================================================================================
-- 2 — public_portal_categories: view nova, só leitura, só o necessário pros
-- chips de categoria (nome, ordem, foto). Sem "active"/"visível" — a tabela
-- base não tem esse conceito (uma categoria existe ou foi excluída, não tem
-- estado intermediário), então nenhum WHERE é necessário aqui.
-- =====================================================================================
CREATE OR REPLACE VIEW public.public_portal_categories AS
SELECT id, owner_id, name, image_path, sort_order
FROM public.portal_service_categories;

GRANT SELECT ON public.public_portal_categories TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_portal_categories FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
