// Função pura que monta as variáveis posicionais ({{1}}..{{4}}) dos templates
// lembrete_24h/lembrete_2h — a ORDEM vem de SYSTEM_TEMPLATES[key].variableOrder
// (fonte única, src/lib/marketing/system-templates.ts), nunca hardcoded aqui.
// lembrete_24h e lembrete_2h têm ordens DIFERENTES entre si de propósito —
// nunca assumir que são iguais.
//
// Sem I/O (nenhuma chamada a banco/rede) — quem chama (M4) já resolve
// clientFullName/serviceName/venueName/timezone antes de invocar isto.
import { formatTimeBR } from "./templates.ts";
import { getSystemTemplate } from "../marketing/system-templates.ts";

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
const FALLBACK_SERVICE_NAME = "seu atendimento";
const FALLBACK_VENUE_NAME = "nosso estúdio";

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

/**
 * O corpo real aprovado na Meta não tem separador entre a variável 1 e o
 * texto fixo seguinte (lembrete_24h: "{{1}}Passando..."; lembrete_2h:
 * "Olá,{{1}}!💛..." — já com vírgula fixa antes da variável) — por isso o
 * PRÓPRIO VALOR da variável 1 precisa carregar o espaço/pontuação que falta,
 * pra ler como frase natural ("Maria! Passando..."/"Olá, Maria!💛...").
 * NÃO VERIFICADO: não há como confirmar neste ambiente (proibido chamar a
 * API da Meta) se a Meta apara espaços nas pontas do valor do parâmetro —
 * se aparar, o espaço de "{{1}}" some e o texto fica colado ("Maria!Passando"/
 * "Olá,Maria!💛"); ainda assim legível, só menos natural. Aplicado DEPOIS da
 * sanitização do nome puro (nunca antes — sanitizeParam apararia a borda
 * que estamos adicionando de propósito).
 */
const CLIENT_NAME_DECORATION: Record<ReminderTemplateKey, (name: string) => string> = {
  lembrete_24h: (name) => `${name}! `,
  lembrete_2h: (name) => ` ${name}`,
};

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

  // A decoração soma até 2 caracteres ao nome já sanitizado/truncado — corta
  // de novo se isso ultrapassar o limite (só afeta nomes já no limite
  // máximo, caso raríssimo; garante o invariante "nenhum parâmetro passa de
  // MAX_PARAM_LENGTH" mesmo depois da decoração).
  const decoratedClientName = CLIENT_NAME_DECORATION[input.templateKey](clientName).slice(
    0,
    MAX_PARAM_LENGTH,
  );
  const values: Record<string, string> = {
    client_name: decoratedClientName,
    time: sanitizedTime,
    service: serviceName,
    salon: venueName,
  };

  const template = getSystemTemplate(input.templateKey);
  const variables = template.variableOrder.map((slot) => {
    const value = values[slot];
    if (value === undefined) {
      throw new Error(`variableOrder de ${input.templateKey} pede um slot desconhecido: "${slot}"`);
    }
    return value;
  });

  return { ok: true, variables };
}
