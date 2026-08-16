// Única porta de entrada pra marcar uma conexão WhatsApp como "connected" de
// verdade. Usada tanto pelo webhook quanto pelo polling do frontend
// (getWhatsAppStatus) — os dois convergem pra mesma regra: nenhum dos dois
// escreve "connected" diretamente; ambos só acionam reconcileWhatsAppConnection,
// que só confirma depois de consultar a Evolution de verdade (getConnectedIdentity,
// via /instance/fetchInstances) e comparar o número real com o
// expected_phone_number gravado quando a profissional pediu o código —
// nunca confiando isoladamente no status reportado pelo webhook.
//
// Proteção contra tentativa obsoleta: o attempt_id da linha é capturado no
// início (junto com owner_id e instance_name) e toda escrita final é
// condicionada aos três (WHERE owner_id = X AND attempt_id = Y AND
// instance_name = Z). Isso é um "compare-and-swap" atômico no próprio banco —
// não uma checagem em duas etapas (que teria uma janela de corrida entre
// reler e escrever): se uma tentativa mais nova já tiver substituído essa
// linha (createWhatsAppConnection grava um attempt_id novo a cada tentativa),
// o UPDATE abaixo afeta 0 linhas e o resultado é descartado como "stale",
// sem tocar em nada da tentativa atual.
import { evolutionWhatsAppProvider } from "./providers/evolution.server";
import { matchWhatsAppPhoneNumbers } from "./phone-identity";
import type { ProviderInstanceRef } from "./provider";

// Diagnóstico temporário (número mascarado — só quantidade de dígitos e os
// últimos 4). Nunca loga o número completo, nem instance_token/API keys.
function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "null";
  const digits = phone.replace(/\D/g, "");
  return `***${digits.slice(-4)} length=${digits.length}`;
}

export type ReconcileOutcome =
  | { outcome: "connected"; phoneNumber: string }
  | { outcome: "pending" }
  | { outcome: "rejected"; reason: string }
  | { outcome: "stale" };

export async function reconcileWhatsAppConnection(ownerId: string): Promise<ReconcileOutcome> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: row } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("instance_name, instance_token, instance_id, status, expected_phone_number, attempt_id")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (!row || row.status === "connected") return { outcome: "pending" };

  const { attempt_id: attemptId, instance_name: instanceName } = row;
  const ref: ProviderInstanceRef = {
    instanceName,
    instanceToken: row.instance_token,
    instanceId: row.instance_id,
  };

  const state = await evolutionWhatsAppProvider.getConnectionStatus(ref);
  if (state.status !== "connected") {
    console.log(
      `[WhatsApp] Reconcile: Evolution state is "${state.connectionState ?? state.status}" (owner ${ownerId})`,
    );
    return { outcome: "pending" };
  }

  const identity = await evolutionWhatsAppProvider.getConnectedIdentity(ref);
  if (!identity.ok) {
    console.error(`[WhatsApp] Reconcile: failed to fetch connected identity (owner ${ownerId})`);
    return { outcome: "pending" };
  }
  if (!identity.phoneNumber) {
    console.log(
      `[WhatsApp] Reconcile: Evolution reports open but no owner identity yet (owner ${ownerId})`,
    );
    return { outcome: "pending" };
  }

  if (!row.expected_phone_number) {
    const reason = "Número esperado não encontrado para esta tentativa.";
    console.error(`[WhatsApp] Reconcile: ${reason} (owner ${ownerId})`);
    const applied = await rejectConnection(ownerId, attemptId, instanceName, ref, reason);
    return applied ? { outcome: "rejected", reason } : { outcome: "stale" };
  }

  // Comparação de identidade: trata como equivalente o caso confirmado em
  // produção de a Evolution devolver o mesmo celular brasileiro sem o 9º
  // dígito (ver phone-identity.ts) — número genuinamente diferente continua
  // MISMATCH. Diagnóstico mascarado numa linha só; matchType só aparece em
  // MATCH, pra diferenciar igualdade exata de equivalência de 9º dígito.
  const matchResult = matchWhatsAppPhoneNumbers(row.expected_phone_number, identity.phoneNumber);
  console.log(
    `[WhatsApp] RECONCILE owner=${ownerId} attempt=${attemptId} instance=${instanceName} ` +
      `instanceId=${row.instance_id ?? "null"} expected=${maskPhone(row.expected_phone_number)} ` +
      `real=${maskPhone(identity.phoneNumber)} result=${matchResult.match ? "MATCH" : "MISMATCH"}` +
      (matchResult.match ? ` matchType=${matchResult.matchType}` : ""),
  );

  if (!matchResult.match) {
    const reason = "O número conectado não corresponde ao número informado.";
    console.error(`[WhatsApp] Reconcile: connected number mismatch (owner ${ownerId})`);
    const applied = await rejectConnection(ownerId, attemptId, instanceName, ref, reason);
    return applied ? { outcome: "rejected", reason } : { outcome: "stale" };
  }

  // Grava o número que a profissional informou (canônico/amigável), não a
  // representação técnica que a Evolution devolveu — o frontend deve mostrar
  // o que ela digitou, mesmo quando o MATCH veio da equivalência de 9º dígito.
  const { count } = await supabaseAdmin
    .from("whatsapp_instances")
    .update(
      {
        status: "connected",
        phone_number: row.expected_phone_number,
        expected_phone_number: null,
        last_error: null,
        last_connected_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("owner_id", ownerId)
    .eq("attempt_id", attemptId)
    .eq("instance_name", instanceName);

  if (!count) {
    console.log(
      `[WhatsApp] Reconcile: attempt superseded before persisting connected, discarding (owner ${ownerId})`,
    );
    return { outcome: "stale" };
  }

  console.log(`[WhatsApp] Reconcile: number confirmed, persisted connected (owner ${ownerId})`);
  return { outcome: "connected", phoneNumber: row.expected_phone_number };
}

/**
 * Grava "error" — só se essa ainda for a tentativa atual — e SÓ DEPOIS, se a
 * escrita aplicou de verdade, desconecta na Evolution. A ordem importa: como
 * instance_name é o mesmo em toda tentativa do owner (aura-<ownerId>),
 * chamar disconnect(ref) usa esse nome pra desligar "o que estiver
 * conectado ali agora" — se essa reconciliação já estiver obsoleta (uma
 * tentativa mais nova já assumiu o nome), desconectar primeiro derrubaria a
 * sessão da tentativa nova, não da antiga. Fazendo a escrita condicionada
 * (compare-and-swap atômico) ANTES, uma tentativa obsoleta nunca chega a
 * chamar disconnect: o UPDATE falha (0 linhas), a função retorna sem tocar
 * na Evolution, e a tentativa atual nunca é desconectada por engano.
 */
async function rejectConnection(
  ownerId: string,
  attemptId: string,
  instanceName: string,
  ref: ProviderInstanceRef,
  reason: string,
): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { count } = await supabaseAdmin
    .from("whatsapp_instances")
    .update(
      { status: "error", last_error: reason, expected_phone_number: null },
      { count: "exact" },
    )
    .eq("owner_id", ownerId)
    .eq("attempt_id", attemptId)
    .eq("instance_name", instanceName);

  if (!count) return false;

  await evolutionWhatsAppProvider.disconnect(ref).catch(() => undefined);
  return true;
}
