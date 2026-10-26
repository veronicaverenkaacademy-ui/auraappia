// Decisão pura (sem I/O) de "o que fazer com este job de lembrete central
// agora" — a única função que sabe as regras de negócio do M4; quem chama
// (central-reminder-scheduler.server.ts) só lê o banco, chama isto, e
// executa o veredito. Dois tipos de "não enviar":
//   - "hold_pending": condição de CONFIGURAÇÃO/operação (chave geral
//     desligada, automação não pronta, modo teste bloqueando este telefone)
//     — reversível, o job permanece pendente e NÃO conta como tentativa
//     real (quem chama desfaz o incremento de `attempts` da reivindicação).
//   - "skip_terminal": condição do PRÓPRIO agendamento/job (cancelado,
//     já passou, telefone inválido, atrasado demais, silêncio sem janela)
//     — nunca vai ficar diferente sozinho, marca como 'cancelled' de vez.
import type { ReminderTemplateKey } from "./central-template-variables.ts";

export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
export type MetaStatus = "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "REJECTED";
/** Resposta da cliente ao botão do WhatsApp (central-reply-decision.ts) — lida de novo aqui pra decidir se AINDA vale mandar o lembrete. */
export type ClientConfirmationStatus = "pending" | "confirmed" | "declined" | "reschedule_requested";

export type ReminderPolicyInput = {
  templateKey: ReminderTemplateKey;
  now: Date;
  appointmentStartsAt: Date;
  appointmentStatus: AppointmentStatus;
  clientConfirmationStatus: ClientConfirmationStatus;
  timezone: string;
  automationActive: boolean;
  automationMetaStatus: MetaStatus;
  automationMetaTemplateName: string | null;
  recipientPhoneValid: boolean;
  recipientPhoneE164: string;
  remindersEnabled: boolean;
  testMode: boolean;
  testPhones: readonly string[];
};

export type ReminderPolicyDecision =
  | { action: "send" }
  | { action: "hold_pending"; reason: string }
  | { action: "defer"; reason: string; deferToIso: string }
  | { action: "skip_terminal"; reason: string };

/**
 * Atraso máximo aceitável, expresso como "quanto ainda precisa faltar pro
 * atendimento" — serve tanto pro corte normal ("muito perto, não faz mais
 * sentido") quanto pra decidir se um job atrasado (gatilho que passou horas
 * sem rodar — ver Marco 0/3) ainda vale recuperar. Pedido explícito da dona:
 * 24h = 12h de folga mínima. Valor único, documentado, não escondido num
 * número solto no meio do código.
 */
export const MAX_LATE_24H_BEFORE_START_MS = 12 * 60 * 60 * 1000; // 12h
/**
 * Pro lembrete de 2h, "atraso curto, poucos minutos": o scheduled_for dele já
 * é starts_at-2h, então tolerar só 15min de atraso sobre esse instante
 * equivale a exigir que ainda faltem pelo menos 1h45 (105min) pro
 * atendimento — nunca depois do horário em si (checado separadamente).
 */
export const MAX_LATE_2H_BEFORE_START_MS = 105 * 60 * 1000; // 1h45 (= 15min de atraso tolerado sobre start-2h)

export const MAX_LATE_BEFORE_START_MS: Record<ReminderTemplateKey, number> = {
  lembrete_24h: MAX_LATE_24H_BEFORE_START_MS,
  lembrete_2h: MAX_LATE_2H_BEFORE_START_MS,
};

/**
 * Decisão da dona (26/10/2026): lembrete sai em QUALQUER horário do dia ou
 * da noite, sem horário de silêncio (há profissionais atendendo até as
 * 22h). As constantes e a lógica de silêncio ficam no código, DESLIGADAS —
 * documentadas, não usadas, pra não se perder caso a decisão mude no
 * futuro. Nunca ativar sem reautorizar com a dona.
 */
export const QUIET_HOURS_ENABLED = false;
export const QUIET_HOURS_START_LOCAL = 21; // 21:00
export const QUIET_HOURS_END_LOCAL = 7; // 07:00

function localHourIn(date: Date, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false }).format(
      date,
    ),
  );
}

/** Próximo 07:00 local (mesmo dia se ainda não passou, senão o de amanhã) — devolvido como instante UTC real. */
function nextQuietHoursEnd(now: Date, timezone: string): Date {
  // Estratégia simples e robusta a qualquer fuso: avança minuto a minuto não é
  // viável; em vez disso, testa os próximos 2 "07:00 locais" candidatos
  // construindo a partir da data local atual, formatada no fuso certo.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  // Offset do fuso no instante `now`, em minutos (diferença entre o relógio
  // local e UTC) — usado só para converter "07:00 local" num instante UTC.
  const offsetMinutes = (() => {
    const utcFormatted = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzFormatted = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    return Math.round((tzFormatted.getTime() - utcFormatted.getTime()) / 60000);
  })();

  const candidateUtcMs = Date.UTC(y, m - 1, d, QUIET_HOURS_END_LOCAL, 0, 0) - offsetMinutes * 60000;
  let candidate = new Date(candidateUtcMs);
  if (candidate.getTime() <= now.getTime()) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  return candidate;
}

function isInQuietHours(now: Date, timezone: string): boolean {
  const hour = localHourIn(now, timezone);
  // Janela "21:00 até 07:00" cruza a meia-noite.
  return hour >= QUIET_HOURS_START_LOCAL || hour < QUIET_HOURS_END_LOCAL;
}

/**
 * Compara pelos últimos 8 dígitos (mesma técnica já usada na conferência de
 * telefone remetente em central-webhook-handler.server.ts) — nunca exige
 * que a lista de teste (WHATSAPP_REMINDERS_TEST_PHONES, digitada à mão)
 * esteja no MESMO formato exato do telefone cadastrado da cliente (com/sem
 * +55, com/sem o 9º dígito, com/sem espaços e hífen). DEFEITO CORRIGIDO
 * (auditoria de testes desta etapa): antes comparava com `.includes()`
 * exato, que falhava silenciosamente pra qualquer diferença de formato.
 */
function isPhoneInTestList(recipientPhoneE164: string, testPhones: readonly string[]): boolean {
  const recipientDigits = recipientPhoneE164.replace(/\D/g, "");
  if (!recipientDigits) return false;
  const recipientLast8 = recipientDigits.slice(-8);
  return testPhones.some((p) => p.replace(/\D/g, "").slice(-8) === recipientLast8);
}

export function decideReminderJobAction(input: ReminderPolicyInput): ReminderPolicyDecision {
  if (!input.remindersEnabled) {
    return {
      action: "hold_pending",
      reason: "Chave geral de lembretes (WHATSAPP_REMINDERS_ENABLED) está desligada.",
    };
  }

  if (input.appointmentStatus !== "confirmed" && input.appointmentStatus !== "pending") {
    return {
      action: "skip_terminal",
      reason: `Agendamento não está mais ativo (status: ${input.appointmentStatus}).`,
    };
  }

  // Decisão da dona: se a cliente já tocou em "Confirmar presença" pelo
  // WhatsApp, o lembrete já cumpriu seu papel — não insistir de novo (vale
  // tanto pro 24h quanto pro 2h; um 2h ainda pendente quando ela já
  // confirmou pelo 24h não precisa sair).
  if (input.clientConfirmationStatus === "confirmed") {
    return {
      action: "skip_terminal",
      reason: "Cliente já confirmou presença pelo WhatsApp — lembrete não é mais necessário.",
    };
  }

  const msUntilAppointment = input.appointmentStartsAt.getTime() - input.now.getTime();
  if (msUntilAppointment <= 0) {
    return { action: "skip_terminal", reason: "Horário do agendamento já passou." };
  }

  if (
    !input.automationActive ||
    input.automationMetaStatus !== "APPROVED" ||
    !input.automationMetaTemplateName
  ) {
    return {
      action: "hold_pending",
      reason:
        "Automação de sistema ainda não está ativa/aprovada para envio (checado no momento do envio).",
    };
  }

  if (!input.recipientPhoneValid) {
    return { action: "skip_terminal", reason: "Telefone inválido." };
  }

  const maxLate = MAX_LATE_BEFORE_START_MS[input.templateKey];
  if (msUntilAppointment < maxLate) {
    return {
      action: "skip_terminal",
      reason: `Pulado: atraso. Falta menos que o mínimo aceitável (${Math.round(maxLate / 60000)} min) para o agendamento — o gatilho deve ter ficado tempo demais sem rodar.`,
    };
  }

  // QUIET_HOURS_ENABLED é false por decisão da dona (26/10/2026) — este
  // bloco nunca executa enquanto isso for true, mas fica pronto caso a
  // decisão seja revista (nunca reativar sem reautorizar com ela).
  if (QUIET_HOURS_ENABLED && isInQuietHours(input.now, input.timezone)) {
    const deferTo = nextQuietHoursEnd(input.now, input.timezone);
    const msUntilAppointmentAtDefer = input.appointmentStartsAt.getTime() - deferTo.getTime();
    if (
      deferTo.getTime() < input.appointmentStartsAt.getTime() &&
      msUntilAppointmentAtDefer >= maxLate
    ) {
      return {
        action: "defer",
        reason: "Horário de silêncio (21:00–07:00) — adiado para o fim do silêncio.",
        deferToIso: deferTo.toISOString(),
      };
    }
    return {
      action: "skip_terminal",
      reason: "Horário de silêncio sem janela válida antes do agendamento.",
    };
  }

  if (input.testMode && !isPhoneInTestList(input.recipientPhoneE164, input.testPhones)) {
    return { action: "hold_pending", reason: "Modo teste: telefone fora da lista de testes." };
  }

  return { action: "send" };
}
