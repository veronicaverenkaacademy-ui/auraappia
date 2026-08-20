// Implementação Meta WhatsApp Cloud API (oficial) do WhatsAppProvider — único
// arquivo que conhece os endpoints/payloads específicos da Graph API da Meta.
// Nada fora deste arquivo deve fazer fetch direto pra graph.facebook.com.
//
// Modelo de conexão é bem diferente da Evolution: não há pareamento por QR
// Code nem estado assíncrono "connecting" — o número já é provisionado e
// verificado diretamente no Meta Business Manager (fora do AURA) antes de
// qualquer chamada aqui. O access token é POR CONEXÃO — cada profissional
// tem o seu próprio, vindo de ref.instanceToken (whatsapp_instances.instance_token,
// coluna já existente, só reaproveitada) — nunca um token único
// compartilhado entre contas. `createConnection` é a única exceção: não
// recebe `ref` (a interface WhatsAppProvider não passa token pra ela), então
// ainda usa META_WHATSAPP_ACCESS_TOKEN como fallback só pra essa função —
// hoje não é chamada por nenhum fluxo real, ver comentário na própria função.
//
// Endpoints usados (Graph API):
//   - GET  /{phone-number-id}?fields=...   → identidade/status real do número
//   - POST /{phone-number-id}/messages     → envio de texto
// Webhook (configurado manualmente no Meta Developer Console, fora do AURA):
// ver webhook-meta.server.ts.
//
// Versão da Graph API: cada versão da Meta fica ativa por ~2 anos a partir do
// lançamento da PRÓXIMA versão, não da sua própria data — hardcode direto
// vira dívida técnica silenciosa (o endpoint simplesmente para de responder
// um dia, sem aviso no código). DEFAULT_GRAPH_API_VERSION é só o "sem
// configuração" — o valor real de produção deve vir de
// META_GRAPH_API_VERSION, ajustável sem deploy de código quando a Meta
// avançar de versão. v26.0 confirmado como a versão atual em
// developers.facebook.com/docs/graph-api/changelog/versions (lançada em
// 29/07/2026) no momento em que este arquivo foi escrito.
import type {
  ConnectedIdentityResult,
  CreateConnectionResult,
  ProviderInstanceRef,
  QrCodeResult,
  SendTextResult,
  WebhookParseResult,
  WhatsAppConnectionState,
  WhatsAppProvider,
} from "../provider";
import { normalizePhoneBR } from "@/lib/phone";

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_GRAPH_API_VERSION = "v26.0";

function getGraphApiBase(): string {
  const version = process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
  return `https://graph.facebook.com/${version}`;
}

// Só usado por createConnection (não recebe ref, ver comentário na função) —
// nenhuma outra função lê env var pra token; todas as outras usam
// ref.instanceToken (por conexão, por profissional).
function getGlobalAccessTokenFallback(): string | null {
  return process.env.META_WHATSAPP_ACCESS_TOKEN || null;
}

async function metaFetch(
  path: string,
  // accessToken ausente = endpoint que não usa Bearer (ex: troca de código,
  // que autentica via client_id/client_secret na própria query string).
  init: RequestInit & { accessToken?: string },
): Promise<{ status: number; body: unknown }> {
  const { accessToken, ...rest } = init;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${getGraphApiBase()}${path}`, {
      ...rest,
      headers: {
        "content-type": "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(rest.headers ?? {}),
      },
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // corpo vazio/não-JSON — segue com body null, quem chama decide o que fazer
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Código 131047 ("Re-engagement message") é a rejeição documentada da Meta
// quando se tenta mandar texto livre fora da janela de 24h de atendimento
// (nenhuma mensagem da cliente nas últimas 24h) — nesse caso é OBRIGATÓRIO
// usar um template aprovado, texto livre nunca funciona. Não é um erro
// aleatório de rede: é esperado e vai acontecer com frequência em produção
// pra confirmações/lembretes proativos, então a mensagem de erro anota isso
// explicitamente em vez de deixar quem lê o log adivinhar. Ver comentário
// sobre sendTemplate() acima de sendText().
const REENGAGEMENT_WINDOW_ERROR_CODE = 131047;

function extractErrorMessage(status: number, body: unknown): string {
  const parsed = body as { error?: { message?: string; type?: string; code?: number } };
  if (parsed?.error?.message) {
    const base = `Meta respondeu ${status}: ${parsed.error.message} (type=${parsed.error.type ?? "?"}, code=${parsed.error.code ?? "?"})`;
    if (parsed.error.code === REENGAGEMENT_WINDOW_ERROR_CODE) {
      return `${base} — fora da janela de 24h de atendimento, precisa de template aprovado (sendText nunca funciona aqui).`;
    }
    return base;
  }
  return `Meta respondeu ${status}: ${JSON.stringify(body).slice(0, 300)}`;
}

export type ExchangeCodeResult = { ok: true; accessToken: string } | { ok: false; error: string };

/**
 * Troca o código de autorização de curta duração que o Embedded Signup
 * devolve no navegador (FB.login → authResponse.code) por um access token de
 * longa duração — passo obrigatório do OAuth do Facebook Login (a Embedded
 * Signup é construída em cima dele), documentado em
 * developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation.
 * Único lugar do projeto que usa META_APP_ID/META_APP_SECRET — credenciais
 * do App da AURA na Meta (globais, não por profissional; diferente do
 * access token resultante, que é por conexão e nunca fica aqui, só é
 * devolvido pra quem chamou persistir).
 *
 * Nunca loga o code nem o token — só o resultado ok/erro.
 */
export async function exchangeCodeForAccessToken(code: string): Promise<ExchangeCodeResult> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return { ok: false, error: "META_APP_ID/META_APP_SECRET não configurados." };
  }

  try {
    const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
    const { status, body } = await metaFetch(`/oauth/access_token?${params.toString()}`, {
      method: "GET",
    });
    if (status < 200 || status >= 300) {
      return { ok: false, error: extractErrorMessage(status, body) };
    }
    const parsed = body as { access_token?: string };
    if (!parsed.access_token) {
      return { ok: false, error: "Meta não devolveu access_token na troca do código." };
    }
    return { ok: true, accessToken: parsed.access_token };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return {
        ok: false,
        error: `Timeout ao trocar o código na Meta Cloud API (${REQUEST_TIMEOUT_MS}ms).`,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao trocar o código na Meta Cloud API: ${msg}` };
  }
}

/**
 * Revoga o access token de uma conexão via GET /oauth/revoke (endpoint da
 * Meta pra revogação programática de tokens — client_id/client_secret são
 * as credenciais do App da AURA, o token é o da conexão sendo revogada).
 * Usado na exclusão de conta do profissional: sem isso, apagar a linha de
 * whatsapp_instances localmente não invalida o token do lado da Meta.
 *
 * Deliberadamente nunca lança erro — chamado durante exclusão de conta, e
 * uma falha de rede/token já inválido aqui não pode travar o resto da
 * exclusão. Quem chama decide se loga o resultado; nunca é motivo pra
 * abortar a exclusão da conta.
 */
export async function revokeAccessToken(
  accessToken: string,
): Promise<{ ok: boolean; error?: string }> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return { ok: false, error: "META_APP_ID/META_APP_SECRET não configurados." };
  }

  try {
    const params = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      access_token: accessToken,
    });
    const { status, body } = await metaFetch(`/oauth/revoke?${params.toString()}`, {
      method: "GET",
    });
    if (status < 200 || status >= 300) {
      return { ok: false, error: extractErrorMessage(status, body) };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao revogar token na Meta Cloud API: ${msg}` };
  }
}

/**
 * Não existe operação de "criar instância" na Cloud API — o número é
 * provisionado no Meta Business Manager, fora do AURA. Esta função só
 * CONFIRMA que o phone_number_id informado (passado como instanceName, único
 * identificador que a Meta de fato usa) é válido e acessível com o access
 * token configurado, chamando GET /{phone-number-id} — nunca cria nada de
 * fato no lado da Meta.
 *
 * ATENÇÃO: esta função não recebe ProviderInstanceRef (a interface
 * WhatsAppProvider não passa token pra createConnection), então ainda lê
 * META_WHATSAPP_ACCESS_TOKEN — diferente de todo o resto deste arquivo, que
 * já usa token por conexão. Não é usada por nenhum fluxo real hoje (não há
 * chamador); quando um fluxo de conexão de verdade existir, ele deve validar
 * a identidade via getConnectedIdentity(ref) (que já recebe token por
 * conexão) em vez de createConnection.
 */
async function createConnection(instanceName: string): Promise<CreateConnectionResult> {
  const accessToken = getGlobalAccessTokenFallback();
  if (!accessToken) throw new Error("META_WHATSAPP_ACCESS_TOKEN não configurado.");

  const { status, body } = await metaFetch(`/${instanceName}?fields=id,display_phone_number`, {
    method: "GET",
    accessToken,
  });
  if (status < 200 || status >= 300) {
    throw new Error(extractErrorMessage(status, body));
  }
  const parsed = body as { id?: string };
  return { instanceName, instanceId: parsed.id ?? instanceName };
}

async function getConnectionStatus(ref: ProviderInstanceRef): Promise<WhatsAppConnectionState> {
  const accessToken = ref.instanceToken;
  if (!accessToken) {
    return {
      status: "error",
      connectionState: null,
      phoneNumber: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: "Access token não configurado para esta conexão.",
    };
  }
  if (!ref.instanceId) {
    return {
      status: "error",
      connectionState: null,
      phoneNumber: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: "phone_number_id não configurado para esta conexão.",
    };
  }

  try {
    const { status, body } = await metaFetch(
      `/${ref.instanceId}?fields=id,display_phone_number,verified_name`,
      { method: "GET", accessToken },
    );
    if (status < 200 || status >= 300) {
      return {
        status: "error",
        connectionState: null,
        phoneNumber: null,
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastError: extractErrorMessage(status, body),
      };
    }
    const parsed = body as { display_phone_number?: string };
    const digits = (parsed.display_phone_number ?? "").replace(/\D/g, "");
    return {
      status: "connected",
      connectionState: "graph_api_reachable",
      phoneNumber: digits ? normalizePhoneBR(digits) : null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "error",
      connectionState: null,
      phoneNumber: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastError: `Falha ao consultar a Meta Cloud API: ${msg}`,
    };
  }
}

async function getQRCode(): Promise<QrCodeResult> {
  return {
    ok: false,
    error:
      "Meta Cloud API não usa QR Code — a conexão é feita com Phone Number ID + Access Token, configurados diretamente no Meta Business Manager.",
  };
}

/**
 * Não existe "logout" na Cloud API (é uma API REST sem sessão persistente) —
 * o número continua registrado na Meta independente do AURA. Desconectar,
 * pro AURA, é só parar de usar esta instância pra enviar (quem chama já marca
 * status='disconnected' em whatsapp_instances depois desta chamada, mesmo
 * padrão de disconnectWhatsApp em whatsapp.functions.ts). Nunca chama a API
 * de deregistro do número — seria destrutivo pro número real da profissional.
 */
async function disconnect(): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

/**
 * Não existe "apagar instância" na Cloud API sem desregistrar o número de
 * verdade (ação destrutiva e fora de escopo). Local-only, mesmo raciocínio
 * de disconnect().
 */
async function deleteInstance(): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}

async function getConnectedIdentity(ref: ProviderInstanceRef): Promise<ConnectedIdentityResult> {
  const status = await getConnectionStatus(ref);
  if (status.status === "error") {
    return {
      ok: false,
      error: status.lastError ?? "Falha desconhecida ao consultar a Meta Cloud API.",
    };
  }
  return { ok: true, phoneNumber: status.phoneNumber };
}

/**
 * Preparação pra templates (não implementado nesta revisão — só a análise
 * de como caberia, sem tocar na interface WhatsAppProvider agora):
 *
 * A Cloud API só aceita texto livre dentro da janela de 24h de atendimento
 * (ver REENGAGEMENT_WINDOW_ERROR_CODE acima); fora dela, business-initiated
 * (confirmação de criação, lembrete 24h/2h, reagendamento/cancelamento)
 * PRECISA de um template pré-aprovado pela Meta (endpoint
 * POST /{phone-number-id}/messages com type:"template" em vez de type:"text").
 * A Evolution nunca teve essa exigência (não é a API oficial), então isso é
 * uma diferença real de comportamento entre os dois providers, não um
 * detalhe de implementação.
 *
 * Mudança de interface que isso exigiria, SE/QUANDO for implementado (só
 * proposta, não aplicada):
 *   - Adicionar um método OPCIONAL `sendTemplate?(ref, toPhoneE164,
 *     templateName, languageCode, params): Promise<SendTextResult>` em
 *     WhatsAppProvider (provider.ts) — opcional porque nem todo provider tem
 *     o conceito (Evolution não tem; ficaria undefined lá).
 *   - WhatsAppMessageService.sendMessage (message-service.server.ts) passaria
 *     a decidir entre `provider.sendText` e `provider.sendTemplate` — essa
 *     decisão fica TODA contida ali dentro, olhando o campo `type` que já
 *     existe em SendMessageInput; scheduler.server.ts e notification_jobs
 *     nunca precisam saber disso, continuam só chamando
 *     WhatsAppMessageService.sendMessage exatamente como hoje.
 *   - templates.ts ganharia, além dos renderXxx() de texto livre atuais, o
 *     nome/idioma/parâmetros do template aprovado correspondente — a decisão
 *     de QUAL usar (texto livre vs template) dependeria do provider ativo do
 *     owner (whatsapp_instances.provider), não do tipo de notification_job.
 * Nada disso está implementado agora — é só o mapa de onde a mudança entraria,
 * pra não exigir reescrever scheduler/notification_jobs quando chegar a hora.
 */
async function sendText(
  ref: ProviderInstanceRef,
  toPhoneE164: string,
  text: string,
): Promise<SendTextResult> {
  const accessToken = ref.instanceToken;
  if (!accessToken) return { ok: false, error: "Access token não configurado para esta conexão." };
  if (!ref.instanceId)
    return { ok: false, error: "phone_number_id não configurado para esta conexão." };

  const to = toPhoneE164.replace(/\D/g, "");

  try {
    const { status, body } = await metaFetch(`/${ref.instanceId}/messages`, {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text },
      }),
    });
    if (status < 200 || status >= 300) {
      return { ok: false, error: extractErrorMessage(status, body) };
    }
    const parsed = body as { messages?: Array<{ id?: string }> };
    return { ok: true, providerMessageId: parsed.messages?.[0]?.id ?? null };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: `Timeout ao chamar a Meta Cloud API (${REQUEST_TIMEOUT_MS}ms).` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Falha ao chamar a Meta Cloud API: ${msg}` };
  }
}

/**
 * Formato de webhook da Cloud API (entry[].changes[].value) — metadata.phone_number_id
 * identifica QUAL número recebeu (equivalente ao `instance` da Evolution),
 * usado por webhook-meta.server.ts pra resolver o owner_id via
 * whatsapp_instances.instance_id. messages[] só processa type="text" nesta
 * v1 (mesmo escopo do parser da Evolution, que também só lê texto) —
 * qualquer outro tipo é logado e ignorado, nunca inventa conteúdo.
 *
 * outgoingMessages sempre vazio, ao contrário da Evolution: lá a profissional
 * pode mandar mensagem pelo próprio app conectado (sessão pessoal), e isso
 * precisa ser capturado de volta pelo webhook. Na Cloud API o envio só
 * acontece pela API (sendText acima) — já fica registrado no momento do
 * envio por WhatsAppMessageService, sem precisar de captura via webhook.
 */
type MetaWebhookValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: Array<{
    from?: string;
    id?: string;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
  }>;
  // Recibos de entrega/leitura (sent/delivered/read/failed) de mensagens que
  // O AURA enviou — nunca mensagens recebidas. Deliberadamente nunca lido
  // como incomingMessages (a Meta separa isso em `statuses`, nunca em
  // `messages`, então não há ambiguidade de parsing possível aqui) — só
  // contado pra diagnóstico, nunca vira mensagem nem toca whatsapp_messages.
  statuses?: Array<{ status?: string }>;
};

async function handleWebhook(payload: unknown): Promise<WebhookParseResult> {
  const result: WebhookParseResult = {
    instanceName: null,
    connectionUpdate: null,
    incomingMessages: [],
    outgoingMessages: [],
    unrecognizedOutboundEvents: [],
  };

  const body = payload as { entry?: Array<{ changes?: Array<{ value?: MetaWebhookValue }> }> };
  const entries = body.entry ?? [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      if (phoneNumberId) result.instanceName = phoneNumberId;

      // Só diagnóstico (quantidade e status, nunca id/telefone/conteúdo) —
      // confirma que recibos de entrega chegam e prova que não estão sendo
      // processados como mensagem recebida.
      if (value.statuses?.length) {
        console.log(
          `[webhook:meta] ${value.statuses.length} evento(s) de status recebido(s) (${value.statuses
            .map((s) => s.status ?? "?")
            .join(",")}) — ignorados, nunca viram mensagem`,
        );
      }

      for (const msg of value.messages ?? []) {
        if (msg.type !== "text" || !msg.from) {
          console.log(
            `[webhook:meta] mensagem inbound ignorada (tipo não suportado: ${msg.type ?? "?"})`,
          );
          continue;
        }
        result.incomingMessages.push({
          fromPhone: msg.from,
          content: msg.text?.body ?? null,
          providerMessageId: msg.id ?? null,
          occurredAt: msg.timestamp
            ? new Date(Number(msg.timestamp) * 1000).toISOString()
            : new Date().toISOString(),
        });
      }
    }
  }

  return result;
}

export const metaCloudApiProvider: WhatsAppProvider = {
  name: "meta_cloud_api",
  createConnection,
  getConnectionStatus,
  getQRCode,
  disconnect,
  deleteInstance,
  getConnectedIdentity,
  sendText,
  handleWebhook,
};
