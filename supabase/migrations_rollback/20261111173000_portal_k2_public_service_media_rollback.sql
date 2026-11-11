-- Rollback de 20261111173000_portal_k2_public_service_media.sql — devolve
-- public_services exatamente à forma anterior (sem image_path/category_id)
-- e remove a view nova public_portal_categories. Nenhuma coluna de tabela
-- foi criada por essa migração (image_path/category_id em services e a
-- tabela portal_service_categories já existiam desde 20261109020000) — só
-- views são desfeitas aqui.
--
-- CORREÇÃO (revisão pedida pela dona): a versão anterior deste arquivo usava
-- `CREATE OR REPLACE VIEW public.public_services` com MENOS colunas que a
-- view atual (sem image_path/category_id) — isso FALHA no PostgreSQL com o
-- erro "cannot drop columns from view" (CREATE OR REPLACE VIEW só pode
-- ACRESCENTAR colunas no final, nunca remover nenhuma). A forma correta de
-- "encolher" uma view é DROP + CREATE.
--
-- Antes de aplicar essa troca, foi confirmado em leitura (pg_depend, busca
-- textual em pg_get_viewdef de toda view, pg_get_functiondef de toda função,
-- e pg_policies) que NADA depende de public_services — nenhuma outra view,
-- função ou policy a referencia. Por isso o DROP abaixo é seguro SEM
-- CASCADE (se algo dependesse dela, o DROP sem CASCADE falharia sozinho,
-- travando a migração em vez de arrastar uma remoção não revisada).
--
-- reloptions (security_invoker/security_barrier) e owner, lidos em produção
-- antes desta correção: public_services tem reloptions NULL (nenhuma das
-- duas opções definida — mesmo padrão de public_professionals/
-- public_company_profiles) e owner "postgres". O CREATE VIEW abaixo não
-- declara nenhuma opção (mantém reloptions NULL, igual ao original) — e o
-- ALTER VIEW ... OWNER TO explícito garante o owner correto independente de
-- qual role execute esta migração (DROP+CREATE, ao contrário de CREATE OR
-- REPLACE, não preserva o owner original automaticamente — ele vira quem
-- rodou o CREATE, a menos que seja corrigido explicitamente como abaixo).
BEGIN;

DROP VIEW IF EXISTS public.public_services;

CREATE VIEW public.public_services AS
SELECT id, owner_id, name, description, price, duration_min, color
FROM public.services
WHERE active = true;

ALTER VIEW public.public_services OWNER TO postgres;

GRANT SELECT ON public.public_services TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_services FROM anon, authenticated;

DROP VIEW IF EXISTS public.public_portal_categories;

NOTIFY pgrst, 'reload schema';

COMMIT;
