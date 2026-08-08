-- Achado crítico durante a verificação em produção da migration anterior
-- (20260808120000_company_profiles.sql): GRANT SELECT ... TO anon, authenticated numa
-- view não revoga os privilégios de INSERT/UPDATE/DELETE que o Supabase concede por
-- padrão (ALTER DEFAULT PRIVILEGES) a esses roles em todo objeto novo do schema public.
--
-- Como nenhuma dessas duas views é security_invoker, toda checagem de RLS na tabela por
-- trás delas roda com o privilégio do DONO da view (postgres, que tem BYPASSRLS) — não
-- do role que está de fato consultando. Ou seja: qualquer usuária autenticada (qualquer
-- cliente com sessão OTP, qualquer colaboradora, de QUALQUER conta) conseguia, em teoria,
-- fazer UPDATE/DELETE/INSERT em company_profiles e team_members através dessas views,
-- ignorando por completo owner_id = auth.uid() — escalonamento de privilégio entre
-- contas, na escrita, não só na leitura pública que era a intenção original.
--
-- public_company_profiles nasceu com essa falha nesta mesma sessão e foi corrigida em
-- produção antes de qualquer teste real acontecer. public_professionals tinha o mesmo
-- problema desde 20260802120000_client_portal_auth.sql — corrigido aqui também, já que
-- é a mesma causa raiz, mesma correção, mesmo nível de urgência.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.public_company_profiles FROM anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.public_professionals FROM anon, authenticated;
