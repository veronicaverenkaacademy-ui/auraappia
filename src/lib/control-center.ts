import { useEffect, useState } from "react";

export type CompanySettings = {
  fantasyName: string;
  legalName: string;
  cnpj: string;
  im: string;
  ie: string;
  address: string;
  cep: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  site: string;
  email: string;
  openHours: string;
  timezone: string;
  language: string;
  currency: string;
  dateFormat: string;
  timeFormat: string;
};

export type BrandSettings = {
  brandName: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  theme: "light" | "dark" | "auto";
  welcomeMessage: string;
  fontHeading: string;
  fontBody: string;
  borderRadius: number;
  portalCover: string;
};

export type AgendaSettings = {
  workDays: string[];
  openTime: string;
  closeTime: string;
  lunchStart: string;
  lunchEnd: string;
  bufferMin: number;
  cleaningMin: number;
  toleranceMin: number;
  requireConfirmation: boolean;
  allowReschedule: boolean;
  allowCancellation: boolean;
  cancellationHours: number;
  waitlist: boolean;
  autoFill: boolean;
  overbooking: boolean;
  onlineBooking: boolean;
};

export type AISettings = {
  autonomy: "respond" | "suggest" | "approve" | "auto";
  tone: "professional" | "friendly" | "playful" | "premium";
  language: string;
  creativity: number;
  memory: boolean;
  learning: boolean;
  modules: { agenda: boolean; crm: boolean; financeiro: boolean; estoque: boolean; marketing: boolean; whatsapp: boolean };
  forbidden: string[];
};

export type SecuritySettings = {
  twoFA: boolean;
  smsLogin: boolean;
  google: boolean;
  apple: boolean;
  sessionTimeoutMin: number;
  forcePasswordChangeDays: number;
  encryptionAtRest: boolean;
  lgpdConsent: boolean;
  auditLogs: boolean;
};

export type BackupSettings = {
  autoBackup: boolean;
  frequency: "daily" | "weekly" | "monthly";
  retentionDays: number;
  lastBackupAt: string | null;
  encrypted: boolean;
};

export type NotificationSettings = {
  channels: { push: boolean; whatsapp: boolean; sms: boolean; email: boolean };
  quietStart: string;
  quietEnd: string;
  dailyDigest: boolean;
  weeklyDigest: boolean;
  monthlyDigest: boolean;
  topics: { reminders: boolean; campaigns: boolean; ai: boolean; finance: boolean; agenda: boolean; stock: boolean };
};

export type ControlCenterState = {
  company: CompanySettings;
  brand: BrandSettings;
  agenda: AgendaSettings;
  ai: AISettings;
  security: SecuritySettings;
  backup: BackupSettings;
  notifications: NotificationSettings;
  onboarding: Record<string, boolean>;
};

const DEFAULTS: ControlCenterState = {
  company: {
    fantasyName: "",
    legalName: "",
    cnpj: "",
    im: "",
    ie: "",
    address: "",
    cep: "",
    city: "",
    state: "",
    country: "Brasil",
    phone: "",
    whatsapp: "",
    instagram: "",
    facebook: "",
    tiktok: "",
    site: "",
    email: "",
    openHours: "Seg a Sex, 9h às 19h",
    timezone: "America/Sao_Paulo",
    language: "pt-BR",
    currency: "BRL",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
  },
  brand: {
    brandName: "AURA",
    primaryColor: "#5C3A2E",
    secondaryColor: "#C9A583",
    accentColor: "#E8B84A",
    theme: "light",
    welcomeMessage: "Bem-vinda ao seu novo ritual.",
    fontHeading: "Instrument Serif",
    fontBody: "Inter",
    borderRadius: 20,
    portalCover: "",
  },
  agenda: {
    workDays: ["seg", "ter", "qua", "qui", "sex", "sab"],
    openTime: "09:00",
    closeTime: "19:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    bufferMin: 10,
    cleaningMin: 15,
    toleranceMin: 10,
    requireConfirmation: true,
    allowReschedule: true,
    allowCancellation: true,
    cancellationHours: 24,
    waitlist: true,
    autoFill: true,
    overbooking: false,
    onlineBooking: true,
  },
  ai: {
    autonomy: "suggest",
    tone: "premium",
    language: "pt-BR",
    creativity: 60,
    memory: true,
    learning: true,
    modules: { agenda: true, crm: true, financeiro: true, estoque: true, marketing: true, whatsapp: true },
    forbidden: ["Cancelar atendimentos sem confirmação", "Emitir estornos financeiros"],
  },
  security: {
    twoFA: false,
    smsLogin: true,
    google: true,
    apple: false,
    sessionTimeoutMin: 60,
    forcePasswordChangeDays: 0,
    encryptionAtRest: true,
    lgpdConsent: true,
    auditLogs: true,
  },
  backup: {
    autoBackup: false,
    frequency: "daily",
    retentionDays: 30,
    lastBackupAt: null,
    encrypted: true,
  },
  notifications: {
    channels: { push: true, whatsapp: true, sms: false, email: true },
    quietStart: "22:00",
    quietEnd: "07:00",
    dailyDigest: true,
    weeklyDigest: true,
    monthlyDigest: false,
    topics: { reminders: true, campaigns: true, ai: true, finance: true, agenda: true, stock: true },
  },
  onboarding: {
    company: false,
    hours: false,
    services: false,
    protocols: false,
    agenda: false,
    payments: false,
    whatsapp: false,
    portal: false,
    loyalty: false,
    legal: false,
    backup: false,
    twoFA: false,
  },
};

const KEY = "aura.control-center.v1";

function read(): ControlCenterState {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      company: { ...DEFAULTS.company, ...(parsed.company ?? {}) },
      brand: { ...DEFAULTS.brand, ...(parsed.brand ?? {}) },
      agenda: { ...DEFAULTS.agenda, ...(parsed.agenda ?? {}) },
      ai: { ...DEFAULTS.ai, ...(parsed.ai ?? {}), modules: { ...DEFAULTS.ai.modules, ...((parsed.ai ?? {}).modules ?? {}) } },
      security: { ...DEFAULTS.security, ...(parsed.security ?? {}) },
      backup: { ...DEFAULTS.backup, ...(parsed.backup ?? {}) },
      notifications: {
        ...DEFAULTS.notifications,
        ...(parsed.notifications ?? {}),
        channels: { ...DEFAULTS.notifications.channels, ...((parsed.notifications ?? {}).channels ?? {}) },
        topics: { ...DEFAULTS.notifications.topics, ...((parsed.notifications ?? {}).topics ?? {}) },
      },
      onboarding: { ...DEFAULTS.onboarding, ...(parsed.onboarding ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

export function useControlCenter() {
  const [state, setState] = useState<ControlCenterState>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(read());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }, [state, hydrated]);

  return { state, setState, hydrated };
}

export type HealthCheck = {
  key: string;
  label: string;
  status: "ok" | "warn" | "danger";
  detail: string;
};

export function computeHealth(s: ControlCenterState): { score: number; checks: HealthCheck[]; onboardingPct: number } {
  const checks: HealthCheck[] = [];

  checks.push({
    key: "company",
    label: "Cadastro da empresa",
    status: s.company.fantasyName && s.company.cnpj ? "ok" : "warn",
    detail: s.company.fantasyName ? "Dados básicos preenchidos" : "Complete nome fantasia e CNPJ",
  });
  checks.push({
    key: "backup",
    label: "Backup automático",
    status: s.backup.autoBackup ? "ok" : "danger",
    detail: s.backup.autoBackup ? `Último backup: ${s.backup.lastBackupAt ?? "hoje"}` : "Ative o backup para proteger seus dados",
  });
  checks.push({
    key: "twoFA",
    label: "Autenticação em 2 fatores",
    status: s.security.twoFA ? "ok" : "warn",
    detail: s.security.twoFA ? "2FA ativo" : "Ative 2FA para proteger sua conta",
  });
  checks.push({
    key: "lgpd",
    label: "Conformidade LGPD",
    status: s.security.lgpdConsent ? "ok" : "danger",
    detail: s.security.lgpdConsent ? "Consentimentos coletados" : "Publique política e colete consentimentos",
  });
  checks.push({
    key: "portal",
    label: "Portal da Cliente",
    status: s.brand.portalCover ? "ok" : "warn",
    detail: s.brand.portalCover ? "Portal personalizado" : "Personalize a identidade do portal",
  });
  checks.push({
    key: "whatsapp",
    label: "WhatsApp Business",
    status: "warn",
    detail: "2 desconectadas. Verifique pendências",
  });
  checks.push({
    key: "audit",
    label: "Logs de auditoria",
    status: s.security.auditLogs ? "ok" : "warn",
    detail: s.security.auditLogs ? "Registrando ações" : "Logs desativados",
  });
  checks.push({
    key: "agenda",
    label: "Agenda pronta",
    status: s.agenda.onlineBooking ? "ok" : "warn",
    detail: s.agenda.onlineBooking ? "Agendamento online ativo" : "Ative o agendamento online",
  });

  const weight = { ok: 1, warn: 0.5, danger: 0 } as const;
  const raw = checks.reduce((sum, c) => sum + weight[c.status], 0);
  const score = Math.round((raw / checks.length) * 100);

  const onbTotal = Object.keys(s.onboarding).length;
  const onbDone = Object.values(s.onboarding).filter(Boolean).length;
  const onboardingPct = Math.round((onbDone / onbTotal) * 100);

  return { score, checks, onboardingPct };
}

export const ONBOARDING_STEPS: { key: keyof ControlCenterState["onboarding"]; label: string }[] = [
  { key: "company", label: "Cadastro da Empresa" },
  { key: "hours", label: "Horários de Funcionamento" },
  { key: "services", label: "Serviços Cadastrados" },
  { key: "protocols", label: "Motor de Protocolos" },
  { key: "agenda", label: "Agenda" },
  { key: "payments", label: "Formas de Pagamento" },
  { key: "whatsapp", label: "WhatsApp Business" },
  { key: "portal", label: "Portal da Cliente" },
  { key: "loyalty", label: "Programa de Fidelidade" },
  { key: "legal", label: "Documentos Legais" },
  { key: "backup", label: "Backup Automático" },
  { key: "twoFA", label: "Autenticação em Dois Fatores" },
];