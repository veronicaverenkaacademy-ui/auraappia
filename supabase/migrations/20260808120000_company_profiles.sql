-- Perfil público de empresa — identidade pública do negócio (nome, categoria, descrição,
-- contatos, endereço, horário, logo, capa), usada pela Landing Pública do Portal da
-- Cliente (/l/:slug). Não é o company_id de tenancy discutido na Constituição de Dados
-- do AURA — é 1:1 por owner_id, no mesmo padrão de toda tabela existente. Se um dia a
-- Alternativa 3 daquele documento (company_id opcional para redes/franquias) for
-- implementada, esta tabela é candidata natural a ganhar essa coluna depois.
--
-- owner_id é a própria chave primária (mesmo padrão de public.profiles.id), reforçando
-- 1:1 sem precisar de uma coluna id separada nem de um UNIQUE extra.

CREATE TABLE public.company_profiles (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$' AND length(slug) BETWEEN 2 AND 60),
  display_name text NOT NULL,
  category text,
  description text,
  city text,
  state text,
  address text,
  phone text,
  whatsapp text,
  instagram text,
  facebook text,
  tiktok text,
  open_hours_text text,
  logo_url text,
  cover_image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_profiles TO authenticated;
GRANT ALL ON public.company_profiles TO service_role;

ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_profiles_own_all ON public.company_profiles
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Reaproveita o trigger já criado para public.profiles — não recria a função.
CREATE TRIGGER company_profiles_updated_at
BEFORE UPDATE ON public.company_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Mesmo padrão de public.public_professionals (20260802120000_client_portal_auth.sql):
-- nunca abrir a tabela real para anon, só uma view com o subconjunto público.
CREATE VIEW public.public_company_profiles AS
SELECT
  owner_id,
  slug,
  display_name,
  category,
  description,
  city,
  state,
  address,
  phone,
  whatsapp,
  instagram,
  facebook,
  tiktok,
  open_hours_text,
  logo_url,
  cover_image_url
FROM public.company_profiles;

GRANT SELECT ON public.public_company_profiles TO anon, authenticated;
