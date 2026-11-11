-- Rollback de 20261111173000_portal_k2_public_service_media.sql — devolve
-- public_services exatamente à forma anterior (sem image_path/category_id)
-- e remove a view nova public_portal_categories. Nenhuma coluna de tabela
-- foi criada por essa migração (image_path/category_id em services e a
-- tabela portal_service_categories já existiam desde 20261109020000) — só
-- views são desfeitas aqui.

CREATE OR REPLACE VIEW public.public_services AS
SELECT id, owner_id, name, description, price, duration_min, color
FROM public.services
WHERE active = true;

GRANT SELECT ON public.public_services TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_services FROM anon, authenticated;

DROP VIEW IF EXISTS public.public_portal_categories;

NOTIFY pgrst, 'reload schema';
