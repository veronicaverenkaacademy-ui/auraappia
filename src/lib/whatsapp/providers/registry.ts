// Registro central de providers de WhatsApp — único lugar que sabe quais
// implementações existem. message-service.server.ts (envio/recebimento) e
// whatsapp.functions.ts (status/desconexão) usam este mesmo mapa — evita
// duas listas divergentes de "quais providers existem" (antes, cada arquivo
// tinha a sua própria versão: message-service.server.ts com um mapa
// completo, whatsapp.functions.ts com Evolution hardcoded).
import { evolutionWhatsAppProvider } from "./evolution.server";
import { metaCloudApiProvider } from "./meta-cloud-api.server";
import type { WhatsAppProvider } from "../provider";

export const PROVIDERS: Record<string, WhatsAppProvider> = {
  evolution: evolutionWhatsAppProvider,
  meta_cloud_api: metaCloudApiProvider,
};

export function getProvider(name: string): WhatsAppProvider | undefined {
  return PROVIDERS[name];
}
