-- Etapa 2 do cadastro (/auth?signup=true) ganhou um bloco opcional de endereço
-- (CEP, Cidade, Estado, Endereço). Não existia nenhuma coluna de endereço em
-- public.profiles até agora — os campos equivalentes em Configurações
-- (CompanyPanel/useControlCenter) são só client-side (localStorage), sem tabela
-- por trás. Estas colunas passam a ser o destino real desses dados, salvos junto
-- com o resto do perfil (full_name, business_name, phone, profession) no mesmo
-- upsert de applyPendingSignupData em src/routes/auth.tsx. País não tem coluna:
-- é fixo "Brasil" na UI, não editável, não precisa ser persistido.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS address text;
