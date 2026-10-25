// Desafio GET de verificação do webhook da Meta (hub.mode/hub.verify_token/
// hub.challenge) — extraído de webhook-meta.server.ts para um módulo puro,
// sem dependências, só pra poder ser testado com o runner simples do Node
// (webhook-meta.server.ts importa módulos sem extensão .ts, resolvidos só
// pelo bundler do Vite em produção — por isso não pode ser importado
// diretamente pelo `node --test`). Comportamento idêntico ao original.
export function handleWebhookVerification(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}
