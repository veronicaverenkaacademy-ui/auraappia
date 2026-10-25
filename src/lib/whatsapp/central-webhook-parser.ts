// Parser puro (sem I/O) do payload bruto do webhook da Meta — normaliza
// entry[].changes[].value (pode haver VÁRIOS entry/changes/messages/statuses
// na MESMA requisição; processa todos, nunca só o primeiro) em uma lista
// plana de eventos. Nunca lança exceção para payload malformado/inesperado —
// ignora o que não reconhece (e sinaliza em `unrecognized`, só para
// diagnóstico, nunca inventa conteúdo).
//
// Amostras de payload usadas nos testes (tests/central-webhook-parser.test.ts)
// foram CONSTRUÍDAS POR MIM com base no formato documentado publicamente da
// Cloud API (não são uma captura real — sem acesso a webhook real neste
// ambiente) — SUPOSIÇÃO quanto ao formato exato de cada tipo de mensagem,
// exceto texto/button, cujo formato já era usado por webhook-meta.server.ts
// antes desta mudança (esse sim, CONFIRMADO NO CÓDIGO já em produção).
export type CentralInboundEvent =
  | {
      kind: "button";
      phoneNumberId: string;
      messageId: string;
      fromPhone: string;
      contextId: string | null;
      buttonPayload: string;
      buttonText: string;
      occurredAt: string;
    }
  | {
      kind: "text";
      phoneNumberId: string;
      messageId: string;
      fromPhone: string;
      contextId: string | null;
      text: string;
      occurredAt: string;
    }
  | {
      kind: "other";
      phoneNumberId: string;
      messageId: string;
      fromPhone: string;
      contextId: string | null;
      mediaType: string;
      occurredAt: string;
    }
  | {
      kind: "status";
      phoneNumberId: string;
      wamid: string;
      status: "sent" | "delivered" | "read" | "failed";
      errorCode: number | null;
      occurredAt: string;
    };

export type ParseResult = {
  events: CentralInboundEvent[];
  unrecognized: Array<{ reason: string; payloadShape: string[] }>;
};

const KNOWN_MESSAGE_TYPES = new Set([
  "text",
  "button",
  "audio",
  "image",
  "sticker",
  "location",
  "reaction",
  "document",
  "video",
  "contacts",
]);
const KNOWN_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

function toOccurredAt(timestamp: unknown): string {
  const n = Number(timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

export function parseMetaWebhookEvents(payload: unknown): ParseResult {
  const events: CentralInboundEvent[] = [];
  const unrecognized: Array<{ reason: string; payloadShape: string[] }> = [];

  if (typeof payload !== "object" || payload === null) {
    return { events, unrecognized: [{ reason: "payload não é objeto", payloadShape: [] }] };
  }

  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return { events, unrecognized };

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: unknown } | null)?.value as
        | {
            metadata?: { phone_number_id?: unknown };
            messages?: unknown;
            statuses?: unknown;
          }
        | undefined;
      if (!value || typeof value !== "object") continue;

      const phoneNumberId = String(value.metadata?.phone_number_id ?? "");
      if (!phoneNumberId) continue; // nunca processa evento sem saber de qual número é

      if (Array.isArray(value.messages)) {
        for (const msg of value.messages as Array<Record<string, unknown>>) {
          const type = typeof msg.type === "string" ? msg.type : "";
          const messageId = typeof msg.id === "string" ? msg.id : "";
          const fromPhone = typeof msg.from === "string" ? msg.from : "";
          const contextId =
            typeof (msg.context as { id?: unknown } | undefined)?.id === "string"
              ? (msg.context as { id: string }).id
              : null;
          const occurredAt = toOccurredAt(msg.timestamp);

          if (!messageId || !fromPhone) {
            unrecognized.push({ reason: "mensagem sem id/from", payloadShape: Object.keys(msg) });
            continue;
          }

          if (type === "button") {
            const button = msg.button as { payload?: unknown; text?: unknown } | undefined;
            events.push({
              kind: "button",
              phoneNumberId,
              messageId,
              fromPhone,
              contextId,
              buttonPayload: typeof button?.payload === "string" ? button.payload : "",
              buttonText: typeof button?.text === "string" ? button.text : "",
              occurredAt,
            });
            continue;
          }

          if (type === "text") {
            const text = msg.text as { body?: unknown } | undefined;
            events.push({
              kind: "text",
              phoneNumberId,
              messageId,
              fromPhone,
              contextId,
              text: typeof text?.body === "string" ? text.body : "",
              occurredAt,
            });
            continue;
          }

          if (KNOWN_MESSAGE_TYPES.has(type)) {
            events.push({
              kind: "other",
              phoneNumberId,
              messageId,
              fromPhone,
              contextId,
              mediaType: type,
              occurredAt,
            });
            continue;
          }

          // Tipo desconhecido (a Meta pode introduzir novos) — nunca descarta
          // em silêncio sem registrar, mas também nunca inventa um
          // mediaType — cai em "other"/"unknown", visível na agenda como
          // "[mensagem]" genérico.
          events.push({
            kind: "other",
            phoneNumberId,
            messageId,
            fromPhone,
            contextId,
            mediaType: type || "unknown",
            occurredAt,
          });
        }
      }

      if (Array.isArray(value.statuses)) {
        for (const st of value.statuses as Array<Record<string, unknown>>) {
          const wamid = typeof st.id === "string" ? st.id : "";
          const status = typeof st.status === "string" ? st.status : "";
          if (!wamid || !KNOWN_STATUSES.has(status)) {
            unrecognized.push({
              reason: "status sem id/status reconhecível",
              payloadShape: Object.keys(st),
            });
            continue;
          }
          const errors = st.errors as Array<{ code?: unknown }> | undefined;
          const errorCode =
            Array.isArray(errors) && errors.length > 0 && typeof errors[0]?.code === "number"
              ? errors[0].code
              : null;
          events.push({
            kind: "status",
            phoneNumberId,
            wamid,
            status: status as "sent" | "delivered" | "read" | "failed",
            errorCode,
            occurredAt: toOccurredAt(st.timestamp),
          });
        }
      }
    }
  }

  return { events, unrecognized };
}

// Frases de várias palavras: risco baixo de falso positivo, comparação por
// substring é suficiente ("quero parar de receber" nunca aparece por
// acidente dentro de uma frase sobre outra coisa).
const STOP_PHRASES = ["quero parar de receber", "não quero receber", "nao quero receber"];
// Palavras isoladas: "parar"/"sair"/"stop" aparecem de verdade em frases que
// NÃO são pedido de parar ("não vou parar de ir aí", "estou saindo agora").
// Por isso exigem correspondência de PALAVRA INTEIRA (nunca substring dentro
// de outra palavra, ex.: "saindo" não é "sair"), e são descartadas quando
// antecedidas por uma negação nas até 2 palavras anteriores.
const STOP_WORDS = ["parar", "sair", "stop"];
const NEGATION_WORDS = ["nao", "nunca", "jamais"];
const NEGATION_LOOKBACK = 2;

/** Comparação tolerante a acento/caixa/pontuação — "PARAR", "Parar!", "não quero receber mensagens" etc.
 *  Regra: frases completas (STOP_PHRASES) batem por substring; palavras
 *  isoladas e ambíguas (STOP_WORDS) só contam se não houver negação
 *  ("não"/"nunca"/"jamais") nas 2 palavras imediatamente anteriores — ver
 *  "Decisões que dependem de você" no relatório para o raciocínio completo. */
export function looksLikeStopRequest(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (STOP_PHRASES.some((p) => normalized === p || normalized.includes(p))) return true;
  if (!normalized) return false;

  const words = normalized.split(/\s+/).map((w) => w.replace(/[.,!?;:]+$/g, ""));
  for (let i = 0; i < words.length; i++) {
    if (!STOP_WORDS.includes(words[i])) continue;
    const precedingWindow = words.slice(Math.max(0, i - NEGATION_LOOKBACK), i);
    if (precedingWindow.some((w) => NEGATION_WORDS.includes(w))) continue; // negado, não conta
    return true;
  }
  return false;
}
