-- Fluxo de agendamento do Portal da Cliente: cadastro estendido, horário de
-- funcionamento estruturado, e leitura pública de serviços.

-- 1. Campos opcionais de cadastro da cliente (nome/telefone/email/nascimento já
--    existiam; faltavam CPF, "como conheceu" e o timestamp de aceite dos Termos —
--    mesmo padrão de profiles.terms_accepted_at, mas para a cliente, não a
--    profissional).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS how_found text,
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

-- 2. Horário de funcionamento estruturado — não existia em lugar nenhum além de
--    texto livre (company_profiles.open_hours_text) e um shape de localStorage
--    nunca conectado à Agenda real. Necessário para o cálculo de horários livres
--    do agendamento público respeitar de fato o expediente. Chave = dia da semana
--    (mon..sun); valor null = fechado; {open,close} em "HH:MM". Default: Seg-Sex
--    9h-19h, Sáb 9h-13h, Dom fechado — mesmo horário já usado como placeholder em
--    CompanySettings.openHours.
ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT
    '{"mon":{"open":"09:00","close":"19:00"},"tue":{"open":"09:00","close":"19:00"},"wed":{"open":"09:00","close":"19:00"},"thu":{"open":"09:00","close":"19:00"},"fri":{"open":"09:00","close":"19:00"},"sat":{"open":"09:00","close":"13:00"},"sun":null}'::jsonb;

-- 3. Leitura pública de serviços (para a Landing escolher serviço, sem login) — só
--    os campos relevantes, mesmo padrão de public_professionals/public_company_profiles.
-- IMPORTANTE (lição do incidente corrigido em 20260808030000): GRANT SELECT numa view
-- NÃO revoga os privilégios de INSERT/UPDATE/DELETE que o Supabase concede por padrão
-- a anon/authenticated em todo objeto novo do schema public — sem o REVOKE abaixo, a
-- view nasceria com a mesma brecha de escrita cross-tenant já corrigida antes.
CREATE VIEW public.public_services AS
SELECT id, owner_id, name, description, price, duration_min, color
FROM public.services
WHERE active = true;

GRANT SELECT ON public.public_services TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_services FROM anon, authenticated;

-- 4. public_professionals (20260802120000_client_portal_auth.sql) exigia
--    booking_slug IS NOT NULL — certo para o link individual antigo, errado para a
--    escolha de profissional dentro do agendamento da empresa: uma colaboradora
--    ativa sem booking_slug configurado simplesmente sumiria da lista (e também já
--    sumia, como efeito colateral, do mapeamento de nome em clientPortal.ts
--    fetchMyAppointments). booking_slug continua existindo na view, só deixa de ser
--    obrigatório — segue reservado para pré-seleção futura via querystring
--    (/l/:slug?pro=booking_slug), não para gatear visibilidade.
DROP VIEW public.public_professionals;
CREATE VIEW public.public_professionals AS
SELECT id, owner_id, full_name, role_title, bio, instagram, avatar_url, agenda_color, booking_slug
FROM public.team_members
WHERE status = 'active';

GRANT SELECT ON public.public_professionals TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_professionals FROM anon, authenticated;
