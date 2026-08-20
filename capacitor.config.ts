import type { CapacitorConfig } from "@capacitor/cli";

// O AURA não é um app offline-first: quase toda funcionalidade real (login,
// agenda, financeiro, WhatsApp, exclusão de conta) depende de createServerFn
// rodando no Worker publicado (Cloudflare), não de arquivos estáticos
// embutidos no app. Por isso `server.url` aponta a WebView direto pra
// aplicação publicada de verdade, em vez de `webDir` apontar pra um build
// estático local — empacotar só o client bundle localmente não teria como
// funcionar sem o backend publicado alcançável mesmo assim, e complicaria
// sem necessidade (duas cópias do frontend pra manter sincronizadas).
//
// IMPORTANTE: server.url abaixo usa o domínio confirmado como o publicado
// de verdade nesta sessão (testado ao vivo contra ele em toda a integração
// do WhatsApp Embedded Signup). Se a Verônica tiver um domínio próprio
// customizado (ex: app.auraagendaia.com) apontado pra essa mesma publicação,
// trocar aqui antes de gerar o build real — confirmar antes de testar num
// dispositivo/simulador.
const config: CapacitorConfig = {
  appId: "com.auraagendaia.app",
  appName: "AURA",
  // webDir é obrigatório pro schema do Capacitor mesmo em modo server.url —
  // aponta pro output de build estático do TanStack Start só como fallback/
  // referência; a navegação real acontece via server.url abaixo.
  webDir: ".output/public",
  server: {
    url: "https://auraappia.lovable.app",
    cleartext: false,
  },
};

export default config;
