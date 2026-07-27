export type Channel = "whatsapp" | "sms" | "email" | "push" | "instagram";

export type AutomationCategory =
  | "agenda"
  | "pos"
  | "fidelizacao"
  | "reativacao"
  | "datas"
  | "campanhas";

export type Automation = {
  id: string;
  name: string;
  description: string;
  icon: string; // emoji
  category: AutomationCategory;
  categoryLabel: string;
  channel: Channel;
  active: boolean;
  sentToday: number;
  metricLabel: string;
  metricValue: string;
  lastRun: string;
  nextRun: string;
  trigger: string;
  message: string;
  buttons?: string[];
  variables?: string[];
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "E-mail",
  push: "Push",
  instagram: "Instagram",
};

export const AVAILABLE_VARIABLES = [
  "nome",
  "procedimento",
  "profissional",
  "data",
  "hora",
  "endereço",
  "link_confirmacao",
  "link_reagendamento",
  "observações",
];

export const automations: Automation[] = [
  {
    id: "confirmacao-agendamento",
    name: "Confirmação do agendamento",
    description: "Enviada assim que a cliente reserva um horário",
    icon: "✅",
    category: "agenda",
    categoryLabel: "Agenda",
    channel: "whatsapp",
    active: true,
    sentToday: 14,
    metricLabel: "Taxa entrega",
    metricValue: "98%",
    lastRun: "há 12 min",
    nextRun: "no próximo agendamento",
    trigger: "Ao criar um novo agendamento",
    message:
      "Olá {{nome}}! Seu horário para {{procedimento}} está reservado para {{data}} às {{hora}} com {{profissional}}. Endereço: {{endereço}}.",
    buttons: ["Confirmar", "Reagendar", "Cancelar", "Ver localização"],
  },
  {
    id: "lembrete-24h",
    name: "Lembrete 24h antes",
    description: "Aviso automático um dia antes do atendimento",
    icon: "💬",
    category: "agenda",
    categoryLabel: "Agenda",
    channel: "whatsapp",
    active: true,
    sentToday: 12,
    metricLabel: "Confirmação",
    metricValue: "91%",
    lastRun: "hoje, 08:00",
    nextRun: "amanhã, 08:00",
    trigger: "24 horas antes do horário marcado",
    message:
      "Olá, {{nome}}! Passando para lembrar que amanhã às {{hora}} você tem um horário reservado para {{procedimento}}. Estamos te esperando! 💛",
    buttons: ["Confirmar presença", "Reagendar", "Cancelar", "Abrir localização", "Adicionar ao calendário"],
  },
  {
    id: "lembrete-2h",
    name: "Lembrete 2h antes",
    description: "Aviso rápido próximo ao horário",
    icon: "⏰",
    category: "agenda",
    categoryLabel: "Agenda",
    channel: "whatsapp",
    active: true,
    sentToday: 8,
    metricLabel: "Leitura",
    metricValue: "97%",
    lastRun: "hoje, 11:30",
    nextRun: "hoje, 15:00",
    trigger: "2 horas antes do horário marcado",
    message: "Estamos te esperando em breve! Seu atendimento começa às {{hora}}. 💛",
    buttons: ["Estou chegando"],
  },
  {
    id: "aviso-alteracao",
    name: "Aviso de horário alterado",
    description: "Notifica a cliente sempre que um horário é remarcado",
    icon: "🔄",
    category: "agenda",
    categoryLabel: "Agenda",
    channel: "whatsapp",
    active: true,
    sentToday: 1,
    metricLabel: "Aceite",
    metricValue: "100%",
    lastRun: "hoje, 10:12",
    nextRun: "sob demanda",
    trigger: "Ao alterar o horário de um agendamento",
    message:
      "Oi {{nome}}, seu horário de {{procedimento}} foi alterado para {{data}} às {{hora}}. Podemos confirmar?",
    buttons: ["Confirmar alteração", "Solicitar outro horário"],
  },
  {
    id: "aviso-cancelamento",
    name: "Aviso de cancelamento",
    description: "Informa a cliente quando um horário é cancelado",
    icon: "✖️",
    category: "agenda",
    categoryLabel: "Agenda",
    channel: "whatsapp",
    active: true,
    sentToday: 0,
    metricLabel: "Reagendam.",
    metricValue: "42%",
    lastRun: "ontem",
    nextRun: "sob demanda",
    trigger: "Ao cancelar um agendamento",
    message:
      "Oi {{nome}}, seu horário de {{procedimento}} em {{data}} foi cancelado. Quer remarcar para outra data?",
    buttons: ["Reagendar atendimento"],
  },
  {
    id: "pos-atendimento",
    name: "Pós-atendimento (2h depois)",
    description: "Mensagem carinhosa após o atendimento",
    icon: "💛",
    category: "pos",
    categoryLabel: "Pós-atendimento",
    channel: "whatsapp",
    active: true,
    sentToday: 6,
    metricLabel: "Resposta",
    metricValue: "72%",
    lastRun: "hoje, 13:40",
    nextRun: "hoje, 17:00",
    trigger: "2 horas após concluir o atendimento",
    message:
      "Foi um prazer cuidar de você hoje, {{nome}}! Esperamos que tenha amado o resultado do {{procedimento}}. 💛",
    buttons: ["Avaliar atendimento", "Agendar manutenção", "Ver cuidados"],
  },
  {
    id: "pos-primeiro",
    name: "Boas-vindas — 1ª visita",
    description: "Sequência exclusiva para novas clientes",
    icon: "✨",
    category: "pos",
    categoryLabel: "Pós-atendimento",
    channel: "whatsapp",
    active: true,
    sentToday: 2,
    metricLabel: "Retorno 30d",
    metricValue: "68%",
    lastRun: "hoje, 14:10",
    nextRun: "sob demanda",
    trigger: "Após o primeiro atendimento da cliente",
    message:
      "Parabéns pela sua primeira visita, {{nome}}! Seja muito bem-vinda à nossa família. 💛 Segue o manual de cuidados e um cupom especial para o seu próximo horário.",
    buttons: ["Baixar manual", "Agendar retorno", "Ver benefícios"],
  },
  {
    id: "google-reviews",
    name: "Solicitação Google Reviews",
    description: "Pede avaliação até 24h após o atendimento",
    icon: "⭐",
    category: "pos",
    categoryLabel: "Pós-atendimento",
    channel: "whatsapp",
    active: true,
    sentToday: 4,
    metricLabel: "Conversão",
    metricValue: "38%",
    lastRun: "hoje, 12:00",
    nextRun: "amanhã, 10:00",
    trigger: "24 horas após o atendimento concluído",
    message:
      "{{nome}}, sua opinião é muito importante para nós! Poderia deixar uma avaliação rapidinho no Google? 💛",
    buttons: ["Avaliar no Google"],
  },
  {
    id: "aniversario",
    name: "Mensagem de aniversário",
    description: "Envia parabéns + cupom automaticamente às 9h",
    icon: "🎂",
    category: "datas",
    categoryLabel: "Datas comemorativas",
    channel: "whatsapp",
    active: true,
    sentToday: 1,
    metricLabel: "Uso do cupom",
    metricValue: "54%",
    lastRun: "hoje, 09:00",
    nextRun: "amanhã, 09:00",
    trigger: "Todo dia às 09:00 para aniversariantes",
    message:
      "Feliz aniversário, {{nome}}! 🎉 Preparamos um mimo para você: 20% off no seu próximo atendimento este mês.",
    buttons: ["Resgatar cupom", "Agendar horário"],
  },
  {
    id: "reativacao-30",
    name: "Reativação — 30 dias",
    description: "Reconquista clientes que sumiram há 30 dias",
    icon: "🌸",
    category: "reativacao",
    categoryLabel: "Reativação",
    channel: "whatsapp",
    active: true,
    sentToday: 3,
    metricLabel: "Retorno",
    metricValue: "22%",
    lastRun: "hoje, 09:30",
    nextRun: "amanhã, 09:30",
    trigger: "30 dias sem retornar",
    message:
      "Oi {{nome}}, sentimos sua falta por aqui! Que tal marcar seu {{procedimento}} com um cupom exclusivo?",
    buttons: ["Agendar agora", "Ver disponibilidade"],
  },
  {
    id: "reativacao-60",
    name: "Reativação — 60 dias",
    description: "Campanha mais generosa para clientes distantes",
    icon: "💐",
    category: "reativacao",
    categoryLabel: "Reativação",
    channel: "whatsapp",
    active: false,
    sentToday: 0,
    metricLabel: "Retorno",
    metricValue: "14%",
    lastRun: "há 3 dias",
    nextRun: "pausada",
    trigger: "60 dias sem retornar",
    message: "{{nome}}, faz tempo! Preparamos 30% off e um brinde especial para te receber de volta. 💛",
    buttons: ["Quero voltar", "Falar com atendente"],
  },
  {
    id: "pontos-saldo",
    name: "Saldo de pontos mensal",
    description: "Avisa saldo e recompensas disponíveis",
    icon: "🎁",
    category: "fidelizacao",
    categoryLabel: "Fidelização",
    channel: "whatsapp",
    active: true,
    sentToday: 0,
    metricLabel: "Resgates",
    metricValue: "31%",
    lastRun: "há 2 dias",
    nextRun: "dia 1 do mês",
    trigger: "Todo dia 1 às 10:00",
    message:
      "Olá {{nome}}! Você tem 240 pontos AURA disponíveis. Faltam 60 pontos para o próximo brinde. 💛",
    buttons: ["Ver recompensas", "Agendar horário"],
  },
  {
    id: "indicacao",
    name: "Programa de indicação",
    description: "Gera link e QR Code exclusivos por cliente",
    icon: "🔗",
    category: "fidelizacao",
    categoryLabel: "Fidelização",
    channel: "whatsapp",
    active: true,
    sentToday: 0,
    metricLabel: "Indicações",
    metricValue: "12 este mês",
    lastRun: "há 1 dia",
    nextRun: "sob demanda",
    trigger: "Após o 2º atendimento da cliente",
    message:
      "{{nome}}, indique uma amiga e vocês duas ganham! Compartilhe seu link exclusivo e receba pontos + cashback.",
    buttons: ["Copiar link", "Baixar QR Code"],
  },
  {
    id: "cashback",
    name: "Aviso de cashback disponível",
    description: "Notifica saldo, uso e validade",
    icon: "💰",
    category: "fidelizacao",
    categoryLabel: "Fidelização",
    channel: "whatsapp",
    active: true,
    sentToday: 2,
    metricLabel: "Uso",
    metricValue: "47%",
    lastRun: "hoje, 10:00",
    nextRun: "amanhã, 10:00",
    trigger: "Sempre que houver saldo > R$ 20",
    message: "{{nome}}, você tem R$ 45 de cashback para usar até o fim do mês! 💛",
    buttons: ["Agendar horário", "Ver saldo"],
  },
];

export const marketingStats = {
  activeAutomations: 18,
  totalAutomations: 22,
  sentToday: 47,
  deliveryRate: 92,
  responseRate: 64,
  responseTrend: 8,
  attributedRevenue: 3940,
  recoveredClients: 12,
};

export type JourneyStep = {
  id: string;
  time: string;
  channel: Channel;
  title: string;
  detail: string;
  metric?: string;
};

export type Journey = {
  id: string;
  name: string;
  description: string;
  audience: string;
  active: boolean;
  clients: number;
  conversion: string;
  steps: JourneyStep[];
};

export const journeys: Journey[] = [
  {
    id: "nova-cliente",
    name: "Nova cliente",
    description: "Do primeiro agendamento até a fidelização",
    audience: "Clientes com 1 atendimento",
    active: true,
    clients: 24,
    conversion: "72% retornam em 30d",
    steps: [
      { id: "s1", time: "no agendamento", channel: "whatsapp", title: "Confirmação", detail: "Envia dados do horário e localização" },
      { id: "s2", time: "24h antes", channel: "whatsapp", title: "Lembrete 24h", detail: "Confirma presença com um clique", metric: "91% confirmam" },
      { id: "s3", time: "2h antes", channel: "whatsapp", title: "Lembrete 2h", detail: "Aviso curto próximo ao horário" },
      { id: "s4", time: "2h depois", channel: "whatsapp", title: "Boas-vindas", detail: "Manual de cuidados + cupom de retorno" },
      { id: "s5", time: "24h depois", channel: "whatsapp", title: "Google Reviews", detail: "Pede avaliação da experiência", metric: "38% avaliam" },
      { id: "s6", time: "7 dias depois", channel: "whatsapp", title: "Programa de fidelidade", detail: "Convite para acumular pontos e cashback" },
    ],
  },
  {
    id: "recorrente",
    name: "Cliente recorrente",
    description: "Ciclo natural de manutenção e retenção",
    audience: "3+ atendimentos nos últimos 6 meses",
    active: true,
    clients: 148,
    conversion: "3,2 atendim./mês",
    steps: [
      { id: "s1", time: "no agendamento", channel: "whatsapp", title: "Confirmação", detail: "Mensagem curta e direta" },
      { id: "s2", time: "24h antes", channel: "whatsapp", title: "Lembrete 24h", detail: "Confirmação com um clique" },
      { id: "s3", time: "após concluir", channel: "whatsapp", title: "Pós-atendimento", detail: "Agradece e agenda manutenção" },
      { id: "s4", time: "no ciclo médio", channel: "whatsapp", title: "Aviso de manutenção", detail: "Convida no momento certo para retornar", metric: "64% aceitam" },
    ],
  },
  {
    id: "vip",
    name: "Cliente VIP",
    description: "Comunicação exclusiva e prioridade",
    audience: "LTV > R$ 3.000",
    active: true,
    clients: 12,
    conversion: "R$ 480 ticket médio",
    steps: [
      { id: "s1", time: "no agendamento", channel: "whatsapp", title: "Confirmação premium", detail: "Mensagem personalizada da profissional" },
      { id: "s2", time: "sempre", channel: "whatsapp", title: "Acesso antecipado", detail: "Novidades e campanhas antes de todos" },
      { id: "s3", time: "mensal", channel: "whatsapp", title: "Bônus VIP", detail: "Pontos em dobro e brindes exclusivos" },
    ],
  },
  {
    id: "inativa",
    name: "Cliente inativa",
    description: "Sequência progressiva de reengajamento",
    audience: "Sem atendimento há 30+ dias",
    active: true,
    clients: 36,
    conversion: "18% reativam",
    steps: [
      { id: "s1", time: "30 dias", channel: "whatsapp", title: "Sentimos sua falta", detail: "Mensagem carinhosa + cupom leve" },
      { id: "s2", time: "60 dias", channel: "whatsapp", title: "Oferta especial", detail: "30% off + brinde de retorno" },
      { id: "s3", time: "90 dias", channel: "email", title: "Última chamada", detail: "Benefício maior + agendamento com 1 clique" },
      { id: "s4", time: "120 dias", channel: "sms", title: "Reengajamento final", detail: "SMS curto com link direto" },
    ],
  },
];

export const aiInsights = [
  {
    highlight: "Lembretes enviados às 18h",
    text: "têm 22% mais confirmações do que às 09h. Quer ajustar o horário do lembrete 24h?",
  },
  {
    highlight: "WhatsApp supera SMS",
    text: "em taxa de resposta em 3,4x. Recomendo migrar as automações de reativação para WhatsApp.",
  },
  {
    highlight: "Pós-atendimento após 2h",
    text: "gera 68% mais avaliações positivas do que imediato. Já ativei esse tempo por padrão.",
  },
  {
    highlight: "Cupom no 1º atendimento",
    text: "aumentou o retorno em 30d de 51% para 72%. Vale replicar em outras jornadas.",
  },
];

export function getAutomation(id: string) {
  return automations.find((a) => a.id === id);
}

export function currency(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });
}