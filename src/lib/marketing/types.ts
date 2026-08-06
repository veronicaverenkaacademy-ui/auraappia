// Tipos compartilhados do módulo Marketing (Fase 2 — CRUD real de
// automações e jornadas). Nenhum envio real acontece ainda; os campos de
// desempenho seguem os "Estados Inteligentes": ausência de dado nunca vira
// "0", sempre um estado textual (ver SmartState).

export type Channel = "whatsapp" | "sms" | "email" | "push" | "instagram";

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

export type Automation = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  icon: string;
  category: string;
  channel: Channel;
  active: boolean;
  trigger_description: string;
  audience_description: string;
  max_frequency_per_day: number;
  allowed_hours_start: string;
  allowed_hours_end: string;
  message_body: string;
  message_buttons: string[];
  source_template_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Journey = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  segment_key: string;
  segment_config: Record<string, number>;
  active: boolean;
  source_template_id: string | null;
  created_at: string;
  updated_at: string;
};

export type JourneyStep = {
  id: string;
  owner_id: string;
  journey_id: string;
  position: number;
  offset_label: string;
  channel: Channel;
  title: string;
  detail: string | null;
  message_body: string;
  created_at: string;
  updated_at: string;
};

export type AutomationTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string;
  category: string;
  is_recommended: boolean;
  sort_order: number;
  channel: Channel;
  trigger_description: string;
  audience_description: string;
  max_frequency_per_day: number;
  allowed_hours_start: string;
  allowed_hours_end: string;
  message_body: string;
  message_buttons: string[];
};

export type JourneyStepTemplate = {
  id: string;
  journey_template_id: string;
  position: number;
  offset_label: string;
  channel: Channel;
  title: string;
  detail: string | null;
  message_body: string;
};

export type JourneyTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  is_recommended: boolean;
  sort_order: number;
  segment_key: string;
  segment_config: Record<string, number>;
  steps: JourneyStepTemplate[];
};

/**
 * Estados Inteligentes: todo card de desempenho tem exatamente um destes.
 * "no_history" = configurada mas nunca teve envio real. "active" = tem pelo
 * menos 1 envio registrado. "paused" = toggle desligado (independente de
 * ter ou não histórico).
 */
export type SmartState = "no_history" | "active" | "paused";

export type PerformanceMetrics = {
  sentCount: number;
  deliveryRate: number | null;
  readRate: number | null;
  responseRate: number | null;
  revenueAttributed: number | null;
  lastSendAt: string | null;
};

export type AutomationWithMetrics = Automation & {
  state: SmartState;
  metrics: PerformanceMetrics;
};

export type JourneyWithMetrics = Journey & {
  state: SmartState;
  metrics: PerformanceMetrics;
  activeClients: number;
};

export type JourneyDetail = JourneyWithMetrics & {
  steps: (JourneyStep & { metrics: PerformanceMetrics })[];
};

export type MarketingOverview = {
  activeAutomations: number;
  totalAutomations: number;
  activeJourneys: number;
  totalJourneys: number;
  state: SmartState; // agregado — "paused" nunca se aplica aqui, só no_history/active
  sentToday: number | null;
  deliveryRate: number | null;
  responseRate: number | null;
  attributedRevenue: number | null;
  recoveredClients: number | null;
};

export type MarketingAIInsight = {
  hasConfig: boolean; // false = nenhuma automação/jornada cadastrada ainda
  hasHistory: boolean; // false = configurado mas sem envio real ainda
  message: string;
};
