# WhatsApp — MVP via Evolution API (provisório)

Integração **provisória** de WhatsApp para confirmações e lembretes automáticos de
agendamento, usando o próprio número da profissional via [Evolution API](https://doc.evolution-api.com)
(conexão por QR Code, como o WhatsApp Web). Destinada a um grupo pequeno de teste
(~5-10 profissionais) antes de uma integração oficial via Meta Cloud API/360dialog.

Toda a lógica específica da Evolution fica isolada em
`src/lib/whatsapp/providers/evolution.server.ts`, atrás da interface `WhatsAppProvider`
(`src/lib/whatsapp/provider.ts`). Trocar para Meta/360dialog no futuro significa escrever
um novo arquivo implementando essa interface e registrá-lo no mapa de providers de
`src/lib/whatsapp/message-service.server.ts` — nada em agenda, clientes ou notificações
precisa mudar.

## Separado do Communication Service (Fase 1/Sprint 2)

Este MVP **não** reaproveita `src/lib/communication/` (`conversations`, `messages`,
`message_templates`, `communication_provider_config`) — aquela camada foi desenhada para
BSPs (360dialog/Meta), sem conceito de pareamento de dispositivo por QR Code, que a
Evolution exige estruturalmente. As tabelas deste MVP (`whatsapp_instances`,
`notification_jobs`, `whatsapp_messages`) são novas e específicas. Reconciliar as duas
camadas fica para quando a integração oficial substituir esta.

## 1. Como configurar a Evolution API

Este MVP não provisiona a Evolution API em si — só o código que fala com ela. Você
precisa de uma instância própria rodando (self-hosted, ex. via Docker) ou um provedor
gerenciado.

### Variáveis de ambiente (server-side, nunca commitadas)

| Variável | Uso |
|---|---|
| `EVOLUTION_API_URL` | URL base da sua instância Evolution (ex: `https://evolution.seudominio.com`) |
| `EVOLUTION_GLOBAL_API_KEY` | Chave global do painel Evolution — nunca a mesma coisa que o token de uma instância específica |
| `EVOLUTION_WEBHOOK_URL` | URL completa que a Evolution deve chamar em eventos, incluindo o segredo: `https://seuapp.com/webhooks/evolution/<EVOLUTION_WEBHOOK_SECRET>` |
| `EVOLUTION_WEBHOOK_SECRET` | Segredo embutido no caminho da URL do webhook (única forma de autenticação do webhook — Evolution self-hosted não tem handshake padronizado como a Cloud API da Meta) |
| `CRON_SECRET` | Bearer token exigido pelo endpoint `/api/cron/whatsapp-reminders` |

No Cloudflare Workers: `wrangler secret put EVOLUTION_GLOBAL_API_KEY` (e as demais),
nunca em `.env` versionado.

### ⚠️ Endpoints assumidos, não verificados

Não há nenhuma instância Evolution provisionada neste ambiente de desenvolvimento — os
endpoints implementados em `evolution.server.ts` seguem a documentação pública da v2
(`doc.evolution-api.com`), mas a Evolution tem múltiplas versões com pequenas diferenças
de payload. **Antes do primeiro teste real**, confirme contra a versão efetivamente
instalada:

- `POST /instance/create`
- `GET /instance/connect/{instanceName}`
- `GET /instance/connectionState/{instanceName}`
- `DELETE /instance/logout/{instanceName}`
- `POST /message/sendText/{instanceName}`
- Formato dos eventos de webhook (`CONNECTION_UPDATE`, `MESSAGES_UPSERT`)

Se algum payload vier diferente do esperado, o ponto de ajuste é só esse arquivo.

## 2. Como conectar uma profissional

1. No app: **Mais → WhatsApp (Lembretes)**.
2. Clicar em **Conectar WhatsApp**.
3. Escanear o QR Code exibido: WhatsApp → Configurações → Aparelhos conectados →
   Conectar aparelho.
4. A tela atualiza sozinha (poll a cada 4s) assim que o webhook confirmar a conexão.
5. Testar com o botão **Testar envio**, informando um número.

Cada conta (`owner_id`) tem no máximo uma conexão (`whatsapp_instances`, chave primária
= `owner_id`). O nome da instância é sempre `aura-{owner_id}`.

## 3. Como testar

Verificação local sem API real (não há credencial nem instância provisionada neste
ambiente):

```bash
npx tsc --noEmit
npx eslint src/lib/whatsapp/
npm run build
node --experimental-strip-types --test caminho/para/verify-whatsapp-evolution.mts
```

O último comando roda testes com `fetch` mockado (payload, headers, erro HTTP, timeout,
ausência de credencial, parsing de webhook) — não requer test runner instalado no
projeto (usa `node:test`, nativo do Node 22+).

Teste real end-to-end (só possível com Evolution provisionada e credenciais reais):
conectar → escanear QR → criar cliente/serviço/agendamento → confirmar → rodar o cron →
verificar mensagem recebida no WhatsApp de teste → repetir para lembretes 24h/2h →
cancelar/reagendar e confirmar que lembretes obsoletos não disparam.

## 4. Como diagnosticar

- **Conexão**: `whatsapp_instances.status`/`last_error` (via `getWhatsAppStatus`, nunca
  consulta direto — a tabela não tem policy de leitura pra `authenticated`).
- **Webhook**: logs do endpoint (`console.error`/`console.warn` em
  `webhook-evolution.server.ts`) — confirmar que `EVOLUTION_WEBHOOK_SECRET` bate com o
  segredo na URL configurada na Evolution.
- **Envio**: tabela `whatsapp_messages` (status, `error_message`, `provider_message_id`).
- **Fila/scheduler**: tabela `notification_jobs` (status, `attempts`, `last_error`,
  `next_attempt_at`) — `status='failed'` com `attempts = max_attempts` significa que
  esgotou o retry (1min → 5min → 15min).
- **Cron**: resposta JSON de `POST /api/cron/whatsapp-reminders` (`{ scan, processed }`)
  — `scan.enqueued` e `processed.sent/failed/cancelled`.

## 5. Scheduler — não existe cron nativo no projeto

O build (`nitro`/`wrangler`, gerado automaticamente por `@lovable.dev/vite-tanstack-config`)
não expõe configuração de Cloudflare Cron Triggers nesta versão. A solução adotada foi um
endpoint HTTP autenticado, chamado por um cron **externo** — escolha um:

- [cron-job.org](https://cron-job.org) (gratuito) — `POST` a cada 5 minutos pra
  `https://seuapp.com/api/cron/whatsapp-reminders`, header
  `Authorization: Bearer <CRON_SECRET>`.
- GitHub Actions com `schedule:` no workflow.
- `pg_cron` + `pg_net` do Supabase, se preferir manter tudo dentro do banco (precisa
  habilitar as extensões).

## 6. Idempotência — como funciona

- **Confirmação**: enfileirada por um **trigger de banco** (`trg_appointments_enqueue_whatsapp`,
  migration `20260811090000`) na transição `-> confirmed`, único ponto que nenhum dos
  dois caminhos de escrita de `appointments` (client-side via RLS, server-side via
  `service_role` no Portal) consegue contornar.
- **Lembretes 24h/2h**: descobertos pelo scan do cron (`scanAndEnqueueReminders`), dentro
  de uma janela de tolerância de ±6min em torno do horário exato.
- **Nunca duplica**: índice único em `notification_jobs (appointment_id, type)` — cron
  duplicado, trigger refirando ou corrida entre os dois nunca criam dois jobs pro mesmo
  lembrete/confirmação.
- **Nunca dois workers pegam o mesmo job**: `claim_notification_jobs` (função Postgres)
  usa `FOR UPDATE SKIP LOCKED` — reivindicação atômica mesmo com cron sobreposto ou
  worker reiniciando no meio.
- **Cancelamento/reagendamento**: o mesmo trigger cancela jobs de lembrete pendentes ao
  cancelar, e zera `reminder_24h_sent_at`/`reminder_2h_sent_at` ao mudar `starts_at` ou
  `status`, deixando o próximo scan recalcular do zero contra o novo horário.

## 7. Como trocar para Meta Cloud API/360dialog depois

1. Criar `src/lib/whatsapp/providers/meta.server.ts` (ou `dialog360.server.ts`)
   implementando `WhatsAppProvider` (`provider.ts`) — mesmo contrato
   (`createConnection`, `getConnectionStatus`, `getQRCode`, `disconnect`, `sendText`,
   `handleWebhook`). BSPs não têm QR Code — `createConnection`/`getQRCode` viram
   fluxo de embedded signup ou aprovação de template, adaptado ao contrato existente.
2. Registrar no mapa `PROVIDERS` de `message-service.server.ts`.
3. `whatsapp_instances.provider` passa a aceitar o novo valor (hoje travado em
   `'evolution'` via `CHECK`).
4. Nada em `agenda.ts`, `booking.functions.ts`, no trigger de banco, no scheduler ou nas
   telas muda — todos falam só com `WhatsAppMessageService`/`WhatsAppProvider`.
