# WhatsApp central — lembretes 24h/2h e respostas de botão (Etapa 1)

## O que isto é, em linguagem simples

Todo lembrete de 24h e de 2h antes do horário sai agora por **um único
número da AURA** (o número central), usando os dois templates aprovados
pela Meta (`lembrete_24h`, `lembrete_2h`) — nunca mais pelo número de
WhatsApp de cada salão. O nome do salão/profissional entra como uma
variável do texto, não muda de onde a mensagem é enviada.

O `lembrete_24h` tem 3 botões (Confirmar presença, Reagendar, Cancelar). O
`lembrete_2h` não tem nenhum botão — qualquer resposta a ele é tratada como
"mensagem sem resposta" (texto livre).

## Arquitetura — de onde vem cada peça

```
Cron (a cada 5min, GitHub Actions)
  → /api/cron/whatsapp-reminders (cron-endpoint.server.ts)
    → scanAndEnqueueCentralReminders — cria o job quando o agendamento
      confirmado entra na janela de 24h/2h (só se WHATSAPP_REMINDERS_ENABLED=true)
    → processNotificationJobs (scheduler.server.ts)
      → job do tipo appointment_reminder_24h/2h é desviado para
        processCentralReminderJob (central-reminder-scheduler.server.ts)
        → decideReminderJobAction (central-reminder-policy.ts) decide:
          enviar / reter / adiar / pular — nunca a Meta é chamada se a
          decisão não for "enviar"
        → buildReminderTemplateVariables (central-template-variables.ts)
        → sendCentralTemplate (central-template-sender.server.ts)
          → checa freio de emergência (whatsapp_central_incidents)
          → resolveCentralSender (central-sender.server.ts) — lê
            META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID/ACCESS_TOKEN
          → grava "pending" em whatsapp_messages ANTES de chamar a Meta
          → (só lembrete_24h) abre whatsapp_central_threads
          → monta o JSON (central-meta-payload.ts) e chama a Meta
          → classifica o resultado (central-send-error-classifier.ts)
```

A resposta da cliente volta por `/webhooks/meta-whatsapp`
(webhook-meta.server.ts) — assinatura validada primeiro (qualquer POST,
central ou por salão), depois um bloco novo e independente processa só os
eventos do número central (central-webhook-handler.server.ts):

```
parseMetaWebhookEvents (central-webhook-parser.ts) → eventos normalizados
  → button: resolve pelo context.id (nunca só pelo payload) → confere
    telefone e thread → applyCentralThreadReply (RPC atômica,
    apply_whatsapp_central_reply, SELECT...FOR UPDATE no agendamento)
  → text/other: tenta correlacionar pelo context.id, senão pela última
    mensagem enviada àquele telefone em 7 dias — 0 ou 2+ candidatos vira
    mensagem órfã (whatsapp_central_orphan_messages)
  → status: nunca retrocede (shouldApplyIncomingStatus) — se o wamid ainda
    não existir localmente, fica em whatsapp_status_reconciliation
```

## Tabela de comportamento das respostas de botão (status × ação)

Fonte única de verdade: a função SQL `apply_whatsapp_central_reply`
(`supabase/migrations/`), espelhada por `central-reply-decision.ts`
(especificação pura, testada, NUNCA executada em produção — quem aplica
de verdade é a função SQL, atômica, com `SELECT ... FOR UPDATE` no
agendamento). Qualquer mudança de regra precisa ser feita nos dois
lugares.

Primeiro, uma checagem vale para QUALQUER ação, antes de tudo:

- Agendamento não encontrado (apagado de verdade) → `appointment_not_found`.
- Agendamento `completed` OU `no_show` OU `starts_at` já passou →
  `late_response` ("resposta tardia", nenhuma mudança).
- Horário do agendamento mudou desde que o lembrete foi enviado
  (`whatsapp_central_threads.appointment_starts_at_snapshot <>
  appointments.starts_at`) → `stale_reminder` ("lembrete desatualizado",
  nenhuma mudança, a thread é marcada `stale`).

Daí em diante, a decisão depende do **estado de confirmação atual**
(`client_confirmation_status`), não do status da thread — um segundo
toque (repetido, ou noutro botão da mesma mensagem) é reconhecido pelo
que o agendamento JÁ É:

| Estado atual (`client_confirmation_status`) | Ação: Confirmar | Ação: Cancelar | Ação: Reagendar |
|---|---|---|---|
| `pending` (nunca respondeu) | `status→confirmed`, grava `client_confirmed_at` | `status→cancelled` (`apply_cancel`/`apply_cancel_late` se faltar menos que `LATE_CANCEL_HOURS`) | não altera o agendamento, avisa 1x (`apply_reschedule_request`) |
| `confirmed` | nada muda, sem erro, sem aviso (`no_op_already_confirmed`) | cancela (`apply_cancel`/`_late`) | não altera, avisa (`apply_reschedule_request`) |
| `declined` (já cancelou) | não reabre, só avisa "quer manter, verifique" (`confirm_after_cancel`) | nada muda, sem aviso duplicado (`no_op_already_cancelled`) | sem regra específica → `late_response` |
| `reschedule_requested` | confirma (`apply_confirm`) | cancela (`apply_cancel`/`_late`) | não altera, avisa de novo SEM duplicar notificação (`apply_reschedule_request_repeat`) |

Toque repetido do MESMO evento (reentrega da Meta) é idempotente: a
mensagem inbound é gravada com índice único por `(provider,
provider_message_id)` ANTES de aplicar o efeito — uma reentrega nunca
reaplica a ação duas vezes. O `UPDATE` do agendamento é sempre
condicional (`WHERE id = ... AND <estado esperado>`) — zero linhas
mudadas nunca é tratado como sucesso silencioso.

A cliente NUNCA recebe resposta automática (decisão atual, mantida) — só
a dona/profissional é avisada, via `app_notifications`.

## Tabela de erros da Meta (classificação)

| Código | Significado (SUPOSIÇÃO — fonte secundária, não a doc. oficial da Meta lida ao vivo) | Classe | Freio de emergência |
|---|---|---|---|
| 190 | Token inválido/expirado | permanente | **global** |
| 80007 | Limite de taxa da conta (WABA) | transitório | **global** |
| 130429 | Limite de taxa de mensagens | transitório | **global** |
| 131048 | Restrição de spam no número | transitório | **global** |
| 132015 | Template pausado (qualidade baixa) | permanente | **só aquele template** |
| 132016 | Template desabilitado permanentemente | permanente | **só aquele template** |
| 131026 | Não entregável (número inválido etc.) | permanente | nenhum |
| 131047 | Fora da janela de 24h (não devia ocorrer em template) | permanente | nenhum |
| 132000/001/005/007/012 | Problema de payload/template | permanente | nenhum |
| 5xx / timeout antes da resposta | erro de rede/Meta | transitório | nenhum |
| timeout **depois** de mandar o POST | não sabemos se chegou | **incerto** — nunca reenviar sozinho | nenhum |
| 401/403 sem código específico | provável token | permanente | **global** (por segurança) |
| 429 sem código específico | provável limite de taxa | transitório | **global** (por segurança) |
| qualquer outro não mapeado | desconhecido | permanente (por segurança) | nenhum |

Quando o freio dispara, o lote inteiro para, os jobs voltam para
"pendente" (nunca "falhou"), e um incidente é registrado em
`whatsapp_central_incidents` com um log `[ALERTA-WHATSAPP-CENTRAL]` no
servidor — **isso não é um push/e-mail de verdade, só um log muito visível
e a própria tabela** (ver "Decisões que dependem de você" no relatório).

## Como ligar e desligar

| Variável | Padrão | Efeito |
|---|---|---|
| `WHATSAPP_REMINDERS_ENABLED` | **desligado** (precisa ser `"true"` literal) | Chave geral — desligada, nenhum job novo é criado nem enviado; jobs já existentes ficam retidos. |
| `WHATSAPP_REMINDERS_TEST_MODE` | **ligado** (só desliga com `"false"` literal) | Em modo teste, só telefones da lista recebem de verdade; os demais ficam retidos (não contam como tentativa). |
| `WHATSAPP_REMINDERS_TEST_PHONES` | vazio | Lista de telefones em E.164, separados por vírgula. |
| `META_WHATSAPP_CENTRAL_PHONE_NUMBER_ID` | — | phone_number_id do número central na Meta. |
| `META_WHATSAPP_CENTRAL_ACCESS_TOKEN` | — | Token permanente de usuário de sistema (ver relatório, nunca o temporário). |

Para desligar tudo de emergência: `WHATSAPP_REMINDERS_ENABLED=false` — nenhuma
mensagem nova sai, nada é perdido (os jobs continuam na fila).

## Como diagnosticar

- **Nenhum lembrete saindo**: confira `WHATSAPP_REMINDERS_ENABLED`, depois
  se há incidente aberto em `whatsapp_central_incidents` (`resolved_at IS NULL`).
- **Uma cliente específica não recebeu**: busque o telefone em
  `whatsapp_messages` (`provider='meta_cloud_api_central'`) — `status` e
  `error_message` dizem o motivo; `status='uncertain'` significa que
  esperamos o webhook confirmar.
- **Botão não fez nada**: veja os logs `[whatsapp:central]` — cada recusa
  (payload adulterado, telefone diferente, thread não encontrada) é logada
  com o motivo exato.

## O que a Etapa 2 vai reaproveitar

- `app_notifications` (dona/profissional) — pos_avaliacao_google e
  retorno_30_dias vão gerar o mesmo tipo de aviso quando chegar a hora.
- `central-send-error-classifier.ts`/`central-template-sender.server.ts` —
  mesma infraestrutura de envio, só troca o template/gatilho.
- `whatsapp_central_threads` — mesmo padrão de thread, se algum dia esses
  templates também tiverem botão.
- `looksLikeStopRequest` já existe e já notifica — **FASE LEMBRETES-1
  implementou o bloqueio de verdade** (`whatsapp_blocked_recipients`, ver
  seção abaixo); a notificação continua existindo, só o texto mudou pra
  refletir que o bloqueio já aconteceu.

## FASE LEMBRETES-1 — disparo confiável dos lembretes (24h/2h)

Achado central (mapa desta fase, 12/11/2026): o único "agendador" real é
`.github/workflows/whatsapp-cron.yml` (GitHub Actions, `schedule: "*/5 * * *
*"`) chamando `/api/cron/whatsapp-reminders`. Na prática ele NÃO roda a
cada 5 minutos — intervalo mediano medido de 300min entre execuções, 88%
com mais de 1h de buraco. Consequência real em produção: todos os
`appointment_reminder_2h` já criados terminaram `cancelled` (zero
`sent`) — a tolerância de atraso do lembrete de 2h (105min) é menor que o
buraco típico do gatilho.

Peças novas desta fase (migration
`20261112200000_whatsapp_reminders_reliable_dispatch.sql`, nada ligado
sem autorização):

- **pg_cron + pg_net** instalados (disponíveis nesta instância, nunca
  usados antes) — infraestrutura pra um agendador DENTRO do Postgres,
  chamando o MESMO endpoint. O `cron.schedule()` que liga isso de fato
  fica em `20261112210000_whatsapp_cron_schedule.sql`, comentado,
  esperando autorização própria.
- **`whatsapp_blocked_recipients`** — bloqueio real de opt-out por
  (owner_id, telefone). `central-webhook-handler.server.ts` grava um
  bloqueio quando `looksLikeStopRequest` dispara;
  `central-reminder-policy.ts` (`recipientBlocked`) nunca envia pra quem
  está bloqueado, nem em modo teste.
- **`whatsapp_cron_runs`** — histórico mínimo de execuções (início/fim/
  contagens, nunca telefone/texto), gravado por `central-cron-run-log.server.ts`
  a cada chamada do endpoint.
- **`recover_stuck_notification_jobs`** — recupera lembretes presos em
  `'processing'` (processo anterior caiu/deu timeout) sem nunca reenviar
  um que já tinha sido confirmado como entregue (reconcilia via
  `whatsapp_messages`); chamado por `central-stuck-job-recovery.server.ts`
  a cada execução do cron. Se o único registro for `'uncertain'` (timeout
  da Meta) há mais de 24h sem resolução, marca a mensagem como
  `'incerto_expirado'` e o job como `'failed'` — terminal, nunca reenviado
  sozinho — e avisa a dona no sino (uma vez por job).
- Comparação em tempo constante no endpoint (`central-constant-time-compare.ts`),
  aceitando `CRON_SECRET` (GitHub Actions) OU `CRON_SECRET_DB` (pg_net) —
  dois segredos INDEPENDENTES (`central-cron-auth.ts`): o GitHub Actions
  não permite reler um secret já salvo, então "usar o mesmo valor nos
  dois" nunca foi viável. `whatsapp_cron_runs.trigger_source` registra qual
  dos dois autenticou (github|db), nunca o valor.
- `net._http_response` (tabela interna do pg_net) já se limpa sozinha —
  confirmado via `pg_net.ttl = 6 hours` nesta instância — nenhuma limpeza
  extra foi adicionada.
