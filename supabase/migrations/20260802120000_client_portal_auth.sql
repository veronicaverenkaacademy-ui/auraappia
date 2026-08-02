-- Portal da cliente: vincula uma cliente (linha em public.clients) à sua própria conta
-- de autenticação (auth.users), para que ela possa ENTRAR e VER seus próprios dados
-- (cadastro e agendamentos) via /l/:slug. Esta migração é somente leitura para a
-- cliente: nenhuma política nova concede INSERT/UPDATE/DELETE a ela. A vinculação em
-- si (gravar user_id em clients) é feita só pela função de servidor
-- linkClientAccount, que roda com service role — a cliente nunca escreve direto na
-- tabela clients.

ALTER TABLE public.clients
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX clients_user_id_idx ON public.clients(user_id);

-- Evita duas linhas de clients do mesmo salão (owner_id) vinculadas à mesma conta.
CREATE UNIQUE INDEX clients_owner_user_unique_idx ON public.clients(owner_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE POLICY clients_self_read ON public.clients FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY appointments_client_read ON public.appointments FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM public.clients WHERE user_id = auth.uid()));

-- team_members não tinha NENHUMA política para o papel anon/authenticated-sem-vínculo
-- ler o perfil de uma profissional — ou seja, /l/:slug nunca funcionou de fato para uma
-- visitante anônima real (só "funcionava" no editor quando a própria dona, já
-- autenticada, testava a própria página). Em vez de abrir uma política ampla em
-- team_members (que exporia telefone, e-mail, comissão e monthly_goal — dados sensíveis
-- do negócio — a qualquer pessoa com a chave anon), criamos uma view somente com os
-- campos já usados publicamente pela página de agendamento.
CREATE VIEW public.public_professionals AS
SELECT
  id,
  owner_id,
  full_name,
  role_title,
  bio,
  instagram,
  avatar_url,
  agenda_color,
  booking_slug
FROM public.team_members
WHERE status = 'active' AND booking_slug IS NOT NULL;

GRANT SELECT ON public.public_professionals TO anon, authenticated;
