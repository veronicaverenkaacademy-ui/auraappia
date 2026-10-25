# Fixtures de payload da Meta WhatsApp Cloud API

Nenhum destes arquivos é uma captura real de webhook (sem acesso a tráfego
real neste ambiente). Procedência de cada um:

- **Envelope geral** (`object`, `entry[].changes[].field/value`, `metadata`,
  `contacts`) e **mensagem de texto**: CONFIRMADO NO CÓDIGO — já era o
  formato lido por `webhook-meta.server.ts` antes desta etapa (produção
  real, caminho por salão).
- **Botão de template (quick reply)** (`type: "button"`, `button.payload`,
  `button.text`, `context.id`): confirmado por busca na documentação
  pública da Meta durante esta sessão (ver nota abaixo) — é o formato de
  "Direct Send"/template com quick-reply (diferente do formato
  `interactive.button_reply` usado em mensagens interativas enviadas pela
  própria Meta Business Platform, que este projeto não usa). `context.id`
  é o wamid da mensagem de template original enviada pela AURA.
- **Status** (`statuses[]` com `id`, `status`, `timestamp`, `errors[].code`):
  SUPOSIÇÃO — formato geral confirmado por uma referência de terceiro
  (mirror, não a doc oficial da Meta diretamente) durante a busca desta
  sessão; os nomes de campo batem com o que `central-webhook-parser.ts` já
  esperava antes desta etapa.
- **Mídia** (áudio, imagem, figurinha, localização, reação, documento):
  SUPOSIÇÃO — construído por mim com base no padrão geral conhecido da API
  (cada tipo usa uma chave com o próprio nome, ex. `audio: { id, mime_type }`,
  `location: { latitude, longitude }`, `reaction: { message_id, emoji }`),
  sem confirmação ponto-a-ponto de cada campo nesta sessão. O parser só lê
  `msg.type`, nunca o conteúdo interno de cada tipo de mídia — por isso o
  conteúdo exato desses objetos não afeta o comportamento testado.

IDs, telefones e nomes nestes arquivos são todos fictícios.
