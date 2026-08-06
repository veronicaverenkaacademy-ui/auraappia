-- Fase 2 do Marketing: automações e jornadas reais (CRUD por conta) + a
-- biblioteca de templates institucionais do AURA (mesma para todas as
-- contas, sem owner_id) + marketing_sends (histórico de envio, vazio até a
-- Fase 3 popular via Communication Service). Nenhuma automação dispara
-- mensagem de verdade ainda — isso é Fase 3.

-- Biblioteca de templates (institucional, leitura liberada, escrita só via
-- service_role/manual — não é conteúdo de conta).
CREATE TABLE public.automation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  icon text NOT NULL DEFAULT '💬',
  category text NOT NULL,
  is_recommended boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  channel text NOT NULL DEFAULT 'whatsapp',
  trigger_description text NOT NULL DEFAULT '',
  audience_description text NOT NULL DEFAULT '',
  max_frequency_per_day int NOT NULL DEFAULT 1,
  allowed_hours_start time NOT NULL DEFAULT '08:00',
  allowed_hours_end time NOT NULL DEFAULT '21:00',
  message_body text NOT NULL DEFAULT '',
  message_buttons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.journey_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'jornadas',
  is_recommended boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  segment_key text NOT NULL,
  segment_config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.journey_step_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_template_id uuid NOT NULL REFERENCES public.journey_templates(id) ON DELETE CASCADE,
  position int NOT NULL,
  offset_label text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  title text NOT NULL,
  detail text,
  message_body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journey_step_templates_journey_idx ON public.journey_step_templates (journey_template_id, position);

-- Tabelas reais por conta.
CREATE TABLE public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  icon text NOT NULL DEFAULT '💬',
  category text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  active boolean NOT NULL DEFAULT true,
  trigger_description text NOT NULL DEFAULT '',
  audience_description text NOT NULL DEFAULT 'Todas as clientes com agendamento futuro',
  max_frequency_per_day int NOT NULL DEFAULT 1,
  allowed_hours_start time NOT NULL DEFAULT '08:00',
  allowed_hours_end time NOT NULL DEFAULT '21:00',
  message_body text NOT NULL DEFAULT '',
  message_buttons text[] NOT NULL DEFAULT '{}',
  source_template_id uuid REFERENCES public.automation_templates(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automations_owner_idx ON public.automations (owner_id);

CREATE TABLE public.journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  segment_key text NOT NULL,
  segment_config jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  source_template_id uuid REFERENCES public.journey_templates(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journeys_owner_idx ON public.journeys (owner_id);

CREATE TABLE public.journey_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  journey_id uuid NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  position int NOT NULL,
  offset_label text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  title text NOT NULL,
  detail text,
  message_body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journey_steps_journey_idx ON public.journey_steps (journey_id, position);

-- Histórico de envio (vazio até a Fase 3). Só o Communication Service
-- (service_role) grava aqui — a conta nunca escreve diretamente, para não
-- ser possível forjar histórico de envio e falsear os Estados Inteligentes.
CREATE TABLE public.marketing_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  automation_id uuid REFERENCES public.automations(id) ON DELETE CASCADE,
  journey_step_id uuid REFERENCES public.journey_steps(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  revenue_attributed numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_sends_source_check CHECK (automation_id IS NOT NULL OR journey_step_id IS NOT NULL)
);
CREATE INDEX marketing_sends_owner_idx ON public.marketing_sends (owner_id, created_at DESC);
CREATE INDEX marketing_sends_automation_idx ON public.marketing_sends (automation_id);
CREATE INDEX marketing_sends_journey_step_idx ON public.marketing_sends (journey_step_id);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journeys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journey_steps TO authenticated;
GRANT SELECT ON public.marketing_sends TO authenticated;
GRANT SELECT ON public.automation_templates TO authenticated;
GRANT SELECT ON public.journey_templates TO authenticated;
GRANT SELECT ON public.journey_step_templates TO authenticated;
GRANT ALL ON public.automations TO service_role;
GRANT ALL ON public.journeys TO service_role;
GRANT ALL ON public.journey_steps TO service_role;
GRANT ALL ON public.marketing_sends TO service_role;
GRANT ALL ON public.automation_templates TO service_role;
GRANT ALL ON public.journey_templates TO service_role;
GRANT ALL ON public.journey_step_templates TO service_role;

-- RLS
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_step_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY automations_owner_all ON public.automations
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY journeys_owner_all ON public.journeys
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY journey_steps_owner_all ON public.journey_steps
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
-- Só SELECT para a conta — nenhuma policy de INSERT/UPDATE/DELETE para
-- authenticated (só o service_role, na Fase 3, grava aqui).
CREATE POLICY marketing_sends_owner_read ON public.marketing_sends
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
-- Templates: leitura liberada pra qualquer conta autenticada, escrita
-- nenhuma (catálogo institucional, gerenciado fora do app).
CREATE POLICY automation_templates_read_all ON public.automation_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY journey_templates_read_all ON public.journey_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY journey_step_templates_read_all ON public.journey_step_templates
  FOR SELECT TO authenticated USING (true);

-- updated_at
CREATE TRIGGER trg_automations_updated_at BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_journeys_updated_at BEFORE UPDATE ON public.journeys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_journey_steps_updated_at BEFORE UPDATE ON public.journey_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_automation_templates_updated_at BEFORE UPDATE ON public.automation_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_journey_templates_updated_at BEFORE UPDATE ON public.journey_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Seed: biblioteca de templates institucionais do AURA
-- ============================================================

INSERT INTO public.automation_templates
  (slug, name, description, icon, category, is_recommended, sort_order, trigger_description, audience_description, message_body, message_buttons)
VALUES
  ('confirmacao-imediata', 'Confirmação imediata', 'Enviada assim que a cliente reserva um horário', '✅', 'agenda', true, 1,
    'Ao criar um novo agendamento', 'Todas as clientes com agendamento futuro',
    'Olá {{nome}}! Seu horário para {{procedimento}} está reservado para {{data}} às {{hora}} com {{profissional}}. Endereço: {{endereço}}.',
    ARRAY['Confirmar','Reagendar','Cancelar','Ver localização']),
  ('lembrete-24h', 'Lembrete 24h antes', 'Aviso automático um dia antes do atendimento', '💬', 'agenda', true, 2,
    '24 horas antes do horário marcado', 'Todas as clientes com agendamento futuro',
    'Olá, {{nome}}! Passando para lembrar que amanhã às {{hora}} você tem um horário reservado para {{procedimento}}. Estamos te esperando! 💛',
    ARRAY['Confirmar presença','Reagendar','Cancelar','Abrir localização','Adicionar ao calendário']),
  ('lembrete-2h', 'Lembrete 2h antes', 'Aviso rápido próximo ao horário', '⏰', 'agenda', false, 3,
    '2 horas antes do horário marcado', 'Todas as clientes com agendamento futuro',
    'Estamos te esperando em breve! Seu atendimento começa às {{hora}}. 💛',
    ARRAY['Estou chegando']),
  ('agradecimento-pos-atendimento', 'Agradecimento pós-atendimento', 'Mensagem de agradecimento e pedido de avaliação após o atendimento', '💛', 'agenda', false, 4,
    '2 horas após concluir o atendimento', 'Todas as clientes com atendimento concluído',
    'Foi um prazer cuidar de você hoje, {{nome}}! Esperamos que tenha amado o resultado do {{procedimento}}. Poderia deixar uma avaliação rapidinho? 💛',
    ARRAY['Avaliar atendimento','Agendar manutenção','Ver cuidados']),
  ('cancelamento', 'Aviso de cancelamento', 'Informa a cliente quando um horário é cancelado', '✖️', 'agenda', false, 5,
    'Ao cancelar um agendamento', 'Cliente do agendamento cancelado',
    'Oi {{nome}}, seu horário de {{procedimento}} em {{data}} foi cancelado. Quer remarcar para outra data?',
    ARRAY['Reagendar atendimento']),
  ('remarcacao', 'Aviso de horário alterado', 'Notifica a cliente sempre que um horário é remarcado', '🔄', 'agenda', false, 6,
    'Ao alterar o horário de um agendamento', 'Cliente do agendamento alterado',
    'Oi {{nome}}, seu horário de {{procedimento}} foi alterado para {{data}} às {{hora}}. Podemos confirmar?',
    ARRAY['Confirmar alteração','Solicitar outro horário']),
  ('lista-de-espera', 'Lista de espera', 'Avisa quando abre um horário numa data com lista de espera', '📋', 'agenda', false, 7,
    'Quando um horário vago abrir numa data com lista de espera', 'Clientes na lista de espera da data',
    'Boa notícia, {{nome}}! Abriu um horário em {{data}} às {{hora}} para {{procedimento}}. Quer garantir?',
    ARRAY['Quero esse horário','Não, obrigada']),
  ('cliente-aniversariante', 'Cliente aniversariante', 'Envia parabéns + cupom automaticamente no dia', '🎂', 'aniversario', true, 8,
    'Todo dia às 09:00 para aniversariantes', 'Clientes aniversariantes do dia',
    'Feliz aniversário, {{nome}}! 🎉 Preparamos um mimo para você: 20% off no seu próximo atendimento este mês.',
    ARRAY['Resgatar cupom','Agendar horário']),
  ('cliente-inativa', 'Cliente inativa', 'Reconquista clientes que sumiram há um tempo', '🌸', 'reativacao', false, 9,
    '30 dias sem retornar', 'Clientes sem atendimento há 30+ dias',
    'Oi {{nome}}, sentimos sua falta por aqui! Que tal marcar seu {{procedimento}} com um cupom exclusivo?',
    ARRAY['Agendar agora','Ver disponibilidade']),
  ('cupom-expirando', 'Cupom expirando', 'Avisa a cliente que o cupom dela está prestes a vencer', '⏳', 'reativacao', false, 10,
    '3 dias antes do cupom da cliente vencer', 'Clientes com cupom ativo perto de expirar',
    '{{nome}}, seu cupom de desconto expira em breve! Não perca a chance de usar antes que acabe. 💛',
    ARRAY['Usar cupom agora']),
  ('pacote-acabando', 'Pacote acabando', 'Avisa quando restam poucas sessões do pacote da cliente', '📦', 'pacotes', false, 11,
    'Quando restarem 2 sessões do pacote da cliente', 'Clientes com pacote ativo perto do fim',
    '{{nome}}, seu pacote de {{procedimento}} está quase no fim! Restam poucas sessões — vamos agendar as próximas?',
    ARRAY['Agendar sessões restantes','Renovar pacote']),
  ('cashback-disponivel', 'Cashback disponível', 'Notifica saldo de cashback disponível para uso', '💰', 'financeiro', false, 12,
    'Sempre que houver saldo de cashback acima de R$ 20', 'Clientes com saldo de cashback',
    '{{nome}}, você tem cashback disponível para usar até o fim do mês! 💛',
    ARRAY['Agendar horário','Ver saldo']),
  ('fidelidade', 'Saldo de pontos e fidelidade', 'Avisa saldo de pontos e recompensas disponíveis', '🎁', 'fidelidade', false, 13,
    'Todo dia 1 às 10:00', 'Clientes participantes do programa de fidelidade',
    'Olá {{nome}}! Você tem pontos AURA disponíveis. Confira suas recompensas! 💛',
    ARRAY['Ver recompensas','Agendar horário']),
  ('recomendacao-automatica', 'Recomendação automática', 'A Aura identifica o momento ideal de recomendar um retorno', '🤖', 'aura_ia', false, 14,
    'Quando a Aura IA identificar o momento ideal para recomendar um retorno', 'Definido pela Aura IA por cliente',
    '{{nome}}, a Aura notou que já faz um tempo desde seu último {{procedimento}} — que tal agendar?',
    ARRAY['Agendar agora']),
  ('melhor-horario', 'Melhor horário', 'A Aura escolhe o horário de envio com melhor histórico de resposta da cliente', '⏱️', 'aura_ia', false, 15,
    'Quando a Aura IA identificar o melhor horário de envio com base no histórico da cliente', 'Definido pela Aura IA por cliente',
    'Oi {{nome}}! Separei um horário que costuma funcionar bem pra você: {{data}} às {{hora}}. Topa?',
    ARRAY['Confirmar horário','Ver outras opções']),
  ('cross-sell', 'Cross-sell', 'A Aura sugere um serviço complementar relevante', '✨', 'aura_ia', false, 16,
    'Quando a Aura IA identificar um serviço complementar relevante para a cliente', 'Definido pela Aura IA por cliente',
    '{{nome}}, muitas clientes que fazem {{procedimento}} também amam outros serviços complementares. Quer conhecer?',
    ARRAY['Saber mais','Agendar']),
  ('upsell', 'Upsell', 'A Aura sugere upgrade do serviço da cliente', '📈', 'aura_ia', false, 17,
    'Quando a Aura IA identificar oportunidade de upgrade no serviço da cliente', 'Definido pela Aura IA por cliente',
    '{{nome}}, que tal fazer upgrade do seu {{procedimento}} dessa vez? Vale a pena conferir os benefícios extras.',
    ARRAY['Ver upgrade','Não, obrigada']);

INSERT INTO public.journey_templates (id, slug, name, description, category, is_recommended, sort_order, segment_key, segment_config)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'nova-cliente', 'Nova cliente', 'Do primeiro agendamento até a fidelização', 'jornadas', true, 1,
    'nova_cliente', '{}'::jsonb),
  ('22222222-2222-4222-8222-222222222222', 'recorrente', 'Cliente recorrente', 'Ciclo natural de manutenção e retenção', 'jornadas', false, 2,
    'recorrente', '{"min_atendimentos": 3, "meses": 6}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', 'vip', 'Cliente VIP', 'Comunicação exclusiva e prioridade', 'jornadas', false, 3,
    'vip', '{"ltv_minimo": 3000}'::jsonb),
  ('44444444-4444-4444-8444-444444444444', 'inativa', 'Cliente inativa', 'Sequência progressiva de reengajamento', 'jornadas', false, 4,
    'inativa', '{"dias_inatividade": 30}'::jsonb);

INSERT INTO public.journey_step_templates (journey_template_id, position, offset_label, channel, title, detail)
VALUES
  ('11111111-1111-4111-8111-111111111111', 1, 'no agendamento', 'whatsapp', 'Confirmação', 'Envia dados do horário e localização'),
  ('11111111-1111-4111-8111-111111111111', 2, '24h antes', 'whatsapp', 'Lembrete 24h', 'Confirma presença com um clique'),
  ('11111111-1111-4111-8111-111111111111', 3, '2h antes', 'whatsapp', 'Lembrete 2h', 'Aviso curto próximo ao horário'),
  ('11111111-1111-4111-8111-111111111111', 4, '2h depois', 'whatsapp', 'Boas-vindas', 'Manual de cuidados + cupom de retorno'),
  ('11111111-1111-4111-8111-111111111111', 5, '24h depois', 'whatsapp', 'Pedido de avaliação', 'Pede avaliação da experiência'),
  ('11111111-1111-4111-8111-111111111111', 6, '7 dias depois', 'whatsapp', 'Programa de fidelidade', 'Convite para acumular pontos e cashback'),

  ('22222222-2222-4222-8222-222222222222', 1, 'no agendamento', 'whatsapp', 'Confirmação', 'Mensagem curta e direta'),
  ('22222222-2222-4222-8222-222222222222', 2, '24h antes', 'whatsapp', 'Lembrete 24h', 'Confirmação com um clique'),
  ('22222222-2222-4222-8222-222222222222', 3, 'após concluir', 'whatsapp', 'Pós-atendimento', 'Agradece e propõe manutenção'),
  ('22222222-2222-4222-8222-222222222222', 4, 'no ciclo médio', 'whatsapp', 'Aviso de manutenção', 'Convida no momento certo para retornar'),

  ('33333333-3333-4333-8333-333333333333', 1, 'no agendamento', 'whatsapp', 'Confirmação premium', 'Mensagem personalizada da profissional'),
  ('33333333-3333-4333-8333-333333333333', 2, 'sempre', 'whatsapp', 'Acesso antecipado', 'Novidades e campanhas antes de todos'),
  ('33333333-3333-4333-8333-333333333333', 3, 'mensal', 'whatsapp', 'Bônus VIP', 'Pontos em dobro e brindes exclusivos'),

  ('44444444-4444-4444-8444-444444444444', 1, '30 dias', 'whatsapp', 'Sentimos sua falta', 'Mensagem carinhosa + cupom leve'),
  ('44444444-4444-4444-8444-444444444444', 2, '60 dias', 'whatsapp', 'Oferta especial', '30% off + brinde de retorno'),
  ('44444444-4444-4444-8444-444444444444', 3, '90 dias', 'email', 'Última chamada', 'Benefício maior + agendamento com 1 clique'),
  ('44444444-4444-4444-8444-444444444444', 4, '120 dias', 'sms', 'Reengajamento final', 'SMS curto com link direto');
