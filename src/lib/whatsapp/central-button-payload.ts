// Formato curto e versionado do payload dos botões de quick_reply do
// lembrete_24h (único template com botões — lembrete_2h não tem, confirmado
// em src/lib/marketing/system-templates.ts). "v1|c|<id do thread>" — até 128
// caracteres (limite documentado pela Meta para payload de botão). Leitura
// tolerante a versões futuras: só exige que comece com "v" + dígitos, nunca
// trava em "v1" especificamente.
//
// SEGURANÇA (item M6 do pedido): este payload NUNCA é a fonte de verdade de
// qual agendamento/thread está em jogo — quem chama (M7) resolve o thread
// pelo `context.id` do webhook (= wamid da mensagem que a AURA mandou,
// gravado em whatsapp_central_threads.outbound_message_id) e só usa o
// threadId daqui como conferência extra. Payload adulterado/desconhecido
// nunca é confiado sozinho.
export type ButtonAction = "confirm" | "reschedule" | "cancel";

const ACTION_TO_CODE: Record<ButtonAction, string> = {
  confirm: "c",
  reschedule: "r",
  cancel: "x",
};

const CODE_TO_ACTION: Record<string, ButtonAction> = {
  c: "confirm",
  r: "reschedule",
  x: "cancel",
};

const MAX_PAYLOAD_LENGTH = 128;
const CURRENT_VERSION = "v1";

export type BuildButtonPayloadResult = { ok: true; payload: string } | { ok: false; error: string };

export function buildButtonPayload(action: ButtonAction, threadId: string): BuildButtonPayloadResult {
  const payload = `${CURRENT_VERSION}|${ACTION_TO_CODE[action]}|${threadId}`;
  if (payload.length > MAX_PAYLOAD_LENGTH) {
    return { ok: false, error: `Payload excede ${MAX_PAYLOAD_LENGTH} caracteres.` };
  }
  return { ok: true, payload };
}

export type ParsedButtonPayload =
  | { ok: true; version: string; action: ButtonAction; threadId: string }
  | { ok: false; reason: "too_long" | "malformed" | "unknown_action" | "missing_thread_id" };

/**
 * Leitura tolerante: aceita qualquer "v<N>" como versão (não só "v1"), desde
 * que o formato geral "versão|código|id" se mantenha — permite evoluir o
 * payload sem quebrar leitura de mensagens antigas ainda em trânsito no
 * momento de um deploy.
 */
export function parseButtonPayload(raw: string): ParsedButtonPayload {
  if (raw.length > MAX_PAYLOAD_LENGTH) return { ok: false, reason: "too_long" };

  const parts = raw.split("|");
  if (parts.length < 3) return { ok: false, reason: "malformed" };

  const [version, code, ...rest] = parts;
  if (!/^v\d+$/.test(version)) return { ok: false, reason: "malformed" };

  const action = CODE_TO_ACTION[code];
  if (!action) return { ok: false, reason: "unknown_action" };

  // join: o threadId (uuid) nunca contém "|" na prática, mas junta de volta
  // por segurança caso uma versão futura permita.
  const threadId = rest.join("|").trim();
  if (!threadId) return { ok: false, reason: "missing_thread_id" };

  return { ok: true, version, action, threadId };
}
