// Função pura que monta as variáveis posicionais ({{1}}..{{4}}) dos templates
// lembrete_24h/lembrete_2h, na ORDEM EXATA aprovada pela Meta — confirmada
// contra o texto-fonte único (src/lib/marketing/system-templates.ts):
//   lembrete_24h: {{1}}=nome, {{2}}=hora,    {{3}}=serviço, {{4}}=local
//   lembrete_2h:  {{1}}=nome, {{2}}=serviço, {{3}}=hora,    {{4}}=local
// As duas ordens são DIFERENTES entre si — nunca assumir que são iguais.
//
// Sem I/O (nenhuma chamada a banco/rede) — quem chama (M4) já resolve
// clientFullName/serviceName/venueName/timezone antes de invocar isto.
import { formatTimeBR } from "./templates.ts";

export type ReminderTemplateKey = "lembrete_24h" | "lembrete_2h";

export type BuildReminderVariablesInput = {
  templateKey: ReminderTemplateKey;
  clientFullName: string | null;
  serviceName: string | null;
  /** ISO 8601 com horário do agendamento. */
  startsAtIso: string;
  /** Fuso do estabelecimento (company_profiles.timezone). */
  timezone: string;
  /**
   * Nome exibido no lugar do estabelecimento ({{4}}) — segue o mesmo
   * precedente já usado no envio legado (renderMessageForJob em
   * scheduler.server.ts): nome da profissional vinculada ao agendamento
   * quando houver, senão o nome do estabelecimento. Resolvido por quem
   * chama, nunca aqui (função pura).
   */
  venueName: string | null;
};

export type BuildReminderVariablesResult =
  { ok: true; variables: string[] } | { ok: false; error: string };

const MAX_PARAM_LENGTH = 60;
const FALLBACK_CLIENT_NAME = "cliente";
const FALLBACK_SERVICE_NAME = "seu horário";
const FALLBACK_VENUE_NAME = "seu salão";

/**
 * Nenhum parâmetro de template da Meta pode ter quebra de linha, tabulação
 * ou runs de espaço — colapsa qualquer run de espaço em branco (2 ou mais,
 * o que já cobre "4+ espaços seguidos" com margem) em um único espaço, apara
 * as pontas, e nunca devolve string vazia (cai no fallback). Corta no limite
 * de tamanho só depois de resolver o fallback, pra nunca truncar pro vazio.
 */
function sanitizeParam(raw: string, fallback: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const withFallback = collapsed.length > 0 ? collapsed : fallback;
  return withFallback.length > MAX_PARAM_LENGTH
    ? withFallback.slice(0, MAX_PARAM_LENGTH).trim()
    : withFallback;
}

/** Primeiro nome só — nomes compostos da cliente não cabem/não soam bem no template. */
function firstNameOf(fullName: string | null): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return FALLBACK_CLIENT_NAME;
  return trimmed.split(/\s+/)[0];
}

export function buildReminderTemplateVariables(
  input: BuildReminderVariablesInput,
): BuildReminderVariablesResult {
  const startsAt = new Date(input.startsAtIso);
  if (Number.isNaN(startsAt.getTime())) {
    return {
      ok: false,
      error: "Data/hora do agendamento inválida — não é possível montar o lembrete.",
    };
  }

  let time: string;
  try {
    time = formatTimeBR(input.startsAtIso, input.timezone);
  } catch {
    return { ok: false, error: "Fuso horário do estabelecimento inválido." };
  }

  const clientName = sanitizeParam(firstNameOf(input.clientFullName), FALLBACK_CLIENT_NAME);
  const serviceName = sanitizeParam(input.serviceName ?? "", FALLBACK_SERVICE_NAME);
  const venueName = sanitizeParam(input.venueName ?? "", FALLBACK_VENUE_NAME);
  const sanitizedTime = sanitizeParam(time, time);

  // Nenhuma variável vazia chega até aqui (sanitizeParam sempre cai num
  // fallback não-vazio) — esta checagem é só uma segunda trava explícita,
  // documentando a garantia em vez de confiar silenciosamente nela.
  if ([clientName, serviceName, venueName, sanitizedTime].some((v) => v.length === 0)) {
    return { ok: false, error: "Não foi possível montar uma variável obrigatória do template." };
  }

  if (input.templateKey === "lembrete_24h") {
    return { ok: true, variables: [clientName, sanitizedTime, serviceName, venueName] };
  }
  return { ok: true, variables: [clientName, serviceName, sanitizedTime, venueName] };
}
