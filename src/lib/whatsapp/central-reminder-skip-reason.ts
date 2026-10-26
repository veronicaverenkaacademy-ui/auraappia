// M4 (observabilidade): categoriza o `last_error` já gravado em
// notification_jobs pelos motivos de "não enviar" conhecidos de
// decideReminderJobAction/sendCentralTemplate — pura (sem I/O), só texto
// entra, categoria sai. Nunca inclui telefone, nome ou qualquer dado da
// cliente: os textos de `last_error` que esta função lê também nunca
// carregam isso (são frases fixas sobre a REGRA, não sobre a pessoa).
export type ReminderSkipCategory =
  | "status_inelegivel"
  | "cliente_ja_confirmou"
  | "automacao_nao_pronta"
  | "telefone_invalido"
  | "modo_teste"
  | "chave_geral_desligada"
  | "atraso_excedido"
  | "incidente_aberto"
  | "outro";

const PATTERNS: ReadonlyArray<[RegExp, ReminderSkipCategory]> = [
  [/chave geral/i, "chave_geral_desligada"],
  [/cliente já confirmou/i, "cliente_ja_confirmou"],
  [/automação de sistema/i, "automacao_nao_pronta"],
  [/telefone inválido/i, "telefone_invalido"],
  [/pulado: atraso/i, "atraso_excedido"],
  [/freio de emergência/i, "incidente_aberto"],
  [/modo teste/i, "modo_teste"],
  [/não está mais ativo|já passou/i, "status_inelegivel"],
];

export function categorizeReminderSkipReason(
  lastError: string | null | undefined,
): ReminderSkipCategory | null {
  if (!lastError) return null;
  for (const [pattern, category] of PATTERNS) {
    if (pattern.test(lastError)) return category;
  }
  return "outro";
}

export const REMINDER_SKIP_CATEGORIES: readonly ReminderSkipCategory[] = [
  "status_inelegivel",
  "cliente_ja_confirmou",
  "automacao_nao_pronta",
  "telefone_invalido",
  "modo_teste",
  "chave_geral_desligada",
  "atraso_excedido",
  "incidente_aberto",
  "outro",
];

const REMINDER_JOB_TYPES = new Set(["appointment_reminder_24h", "appointment_reminder_2h"]);

/**
 * Pura: dado o que aconteceu com cada job claimado nesta execução (tipo,
 * resultado, e o last_error já gravado por processCentralReminderJob),
 * devolve a contagem por categoria — só conta held/cancelled dos DOIS tipos
 * de lembrete (24h/2h), nunca os outros tipos da fila compartilhada
 * (appointment_confirmation/appointment_created/test). Separada de
 * scheduler.server.ts pra poder testar a lógica de agregação sem precisar
 * importar aquele arquivo (que tem imports sem extensão, resolvidos pelo
 * bundler em produção mas não pelo `node` puro usado nos testes).
 */
export function tallyReminderSkipReasons(
  entries: ReadonlyArray<{ type: string; outcome: string; lastError: string | null | undefined }>,
): Record<ReminderSkipCategory, number> {
  const counts = emptyReminderSkipCounts();
  for (const entry of entries) {
    if (!REMINDER_JOB_TYPES.has(entry.type)) continue;
    if (entry.outcome !== "held" && entry.outcome !== "cancelled") continue;
    const category = categorizeReminderSkipReason(entry.lastError);
    if (category) counts[category]++;
  }
  return counts;
}

export function emptyReminderSkipCounts(): Record<ReminderSkipCategory, number> {
  return {
    status_inelegivel: 0,
    cliente_ja_confirmou: 0,
    automacao_nao_pronta: 0,
    telefone_invalido: 0,
    modo_teste: 0,
    chave_geral_desligada: 0,
    atraso_excedido: 0,
    incidente_aberto: 0,
    outro: 0,
  };
}
