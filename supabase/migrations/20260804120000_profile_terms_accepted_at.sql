-- Registro de aceite explícito dos Termos de Uso / Política de Privacidade no
-- cadastro da profissional (checkbox obrigatório na etapa 2, /auth?signup=true).
-- Guarda o timestamp exato de quando o checkbox foi marcado (evidência de
-- consentimento), não o momento da criação da conta em si.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
