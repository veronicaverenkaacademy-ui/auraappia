// Ações em agendamento cancelado (FASE D): "Chamar no WhatsApp", "Reativar
// agendamento" e "Remover da agenda". Funções puras, sem dependência de
// React/Supabase — extraído pra ser testável fora do navegador (mesmo
// motivo de agenda-week.ts / agenda-card-style.ts).
// Import relativo (não "@/lib/phone") de propósito: este arquivo precisa
// ser importável por `node --test` puro (sem o resolvedor de paths do
// Vite/TS) — mesmo motivo de agenda-week.ts. Os `import type` abaixo são
// apagados pelo `--experimental-strip-types` e não entram nessa restrição.
import { normalizePhoneBR, isValidPhoneBR } from "./phone.ts";
import type { AppointmentStatus } from "@/lib/agenda";
import type { ClientConfirmationStatus } from "@/lib/agenda-card-style";

// ---------- Filtro "removido da agenda" (visões Dia/Semana/Lista/Timeline) ----------

/**
 * Um agendamento só fica escondido das 4 visões da Agenda quando está
 * cancelado E foi explicitamente removido (agenda_removed_at preenchido) —
 * nunca por outro motivo, nunca sozinho. `agenda_removed_at` ausente da
 * linha (app novo lendo um banco ainda sem a migration da Fase D, já que
 * a consulta usa `SELECT *` e o PostgREST simplesmente omite a coluna que
 * não existe, sem erro) é tratado igual a NULL: nada escondido, modo
 * compatível automático.
 */
export function isHiddenFromAgenda(a: { status: AppointmentStatus; agenda_removed_at?: string | null }): boolean {
  return a.status === "cancelled" && a.agenda_removed_at != null;
}

// ---------- Texto da mensagem de WhatsApp ----------

/** "quarta-feira, 12/11" (ou "12/11/2027" se o ano for diferente do atual) + "14h"/"14h30". */
export function formatApptDateTimeForMessage(starts_at: Date, now: Date): { day: string; hour: string } {
  const weekday = starts_at.toLocaleDateString("pt-BR", { weekday: "long" }); // "quarta-feira", "sábado", "domingo" — já minúsculo
  const dd = String(starts_at.getDate()).padStart(2, "0");
  const mm = String(starts_at.getMonth() + 1).padStart(2, "0");
  const dateStr =
    starts_at.getFullYear() !== now.getFullYear() ? `${dd}/${mm}/${starts_at.getFullYear()}` : `${dd}/${mm}`;
  const h = starts_at.getHours();
  const m = starts_at.getMinutes();
  const hour = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
  return { day: `${weekday}, ${dateStr}`, hour };
}

/**
 * Versão da mensagem (Etapa D0d): só "client" (cancelado pela cliente,
 * status=cancelled + client_confirmation_status=declined) ou "unknown"
 * (qualquer outro caminho — inclusive o portal público, que hoje não grava
 * 'declined'). A versão "team" (cancelado pela equipe) NUNCA é usada: não
 * existe nenhum sinal confiável no banco/código que prove isso hoje
 * (nenhum audit_log, nenhuma coluna de origem) — confirmado na Etapa D0.
 */
export type CancelMessageVersion = "client" | "unknown";

export function resolveCancelMessageVersion(
  status: AppointmentStatus,
  clientConfirmationStatus: ClientConfirmationStatus | null | undefined,
): CancelMessageVersion {
  return status === "cancelled" && clientConfirmationStatus === "declined" ? "client" : "unknown";
}

function firstName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.split(" ")[0] : "";
}

/**
 * Monta o texto em português da mensagem de WhatsApp (Decisões da dona,
 * versões a/c — b nunca é usada, ver resolveCancelMessageVersion). Nunca
 * produz "undefined"/"null"/espaço duplo: nome e serviço ausentes caem nos
 * valores de reserva ("" / "atendimento").
 */
export function buildCancelWhatsappMessage(params: {
  version: CancelMessageVersion;
  clientFullName: string | null | undefined;
  serviceName: string | null | undefined;
  startsAt: Date;
  now: Date;
}): string {
  const name = firstName(params.clientFullName);
  const greeting = name ? `Oi, ${name}!` : "Oi!";
  const service = (params.serviceName ?? "").trim() || "atendimento";
  const { day, hour } = formatApptDateTimeForMessage(params.startsAt, params.now);
  const when = `${service} (${day} às ${hour})`;
  return params.version === "client"
    ? `${greeting} 💛 Vi que o seu horário de ${when} foi cancelado. Quer que eu te ajude a escolher um novo horário?`
    : `${greeting} 💛 Sobre o seu horário de ${when}, que está cancelado: quer que eu te ajude a escolher um novo horário?`;
}

// ---------- Link do WhatsApp ----------

/**
 * `null` quando o telefone está ausente/inválido (botão fica desabilitado
 * no app, com texto explicando por quê) — nunca inventa o 9º dígito
 * (normalizePhoneBR/isValidPhoneBR já existentes em src/lib/phone.ts, só
 * reaproveitados aqui).
 */
export function buildWhatsappLink(phone: string | null | undefined, message: string): string | null {
  if (!phone || !isValidPhoneBR(phone)) return null;
  const digitsOnly = normalizePhoneBR(phone).replace(/\D/g, "");
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}

// ---------- Mensagens de resultado (Reativar / Remover) ----------

/** Mapeia o retorno de reactivate_cancelled_appointment pra uma frase em português — nunca texto técnico. */
export function describeReactivateResult(result: string): string {
  switch (result) {
    case "horario_ocupado":
      return "Esse horário já foi ocupado por outro agendamento.";
    case "horario_passado":
      return "Não é possível reativar um horário que já passou.";
    case "nao_cancelado":
      return "Este agendamento já foi alterado por outra pessoa. Atualizamos a agenda.";
    case "sem_permissao":
      return "Você não tem permissão para fazer isso.";
    default:
      // nao_encontrado, erro de rede, função inexistente — tudo cai aqui.
      return "Não foi possível concluir agora. Tente novamente em instantes.";
  }
}

/** Mesmo princípio de describeReactivateResult, pros retornos de set_agenda_removed. */
export function describeSetRemovedResult(result: string): string {
  switch (result) {
    case "nao_cancelado":
      return "Este agendamento já foi alterado por outra pessoa. Atualizamos a agenda.";
    case "sem_permissao":
      return "Você não tem permissão para fazer isso.";
    default:
      return "Não foi possível concluir agora. Tente novamente em instantes.";
  }
}
