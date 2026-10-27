# Templates da Meta (WhatsApp Business) — nomes/textos REAIS

Gerado a partir de `src/lib/marketing/system-templates.ts` (fonte única —
não edite este arquivo sem editar a fonte primeiro).

**ALINHAMENTO COM A META REAL (27/10/2026):** até 26/10/2026 este
documento era o material de SUBMISSÃO (antes de qualquer aprovação),
usando a chave interna (`lembrete_24h` etc.) também como nome do
template na Meta — nunca foi conferido contra o que a Meta de fato
aprovou. Isso causou o erro 132001 ("Template inexistente") em
produção. Os nomes/textos/botões abaixo foram corrigidos pros REAIS,
tirados dos prints do Gerenciador do WhatsApp da conta "AURA agendaia
WABA" (status: Ativo, idioma pt_BR) — não é mais material de submissão,
é o retrato do que já está aprovado.

O **nome interno** (`template_key`, entre parênteses em cada título
abaixo) nunca muda — é o que vive em `automations.template_key` e
`notification_jobs.type`. O **nome na Meta** (campo `template.name` no
envio) é outro valor, independente, e é o que aparece como "Nome do
template (Meta)" abaixo.

Nem todo teste mecânico garante mais que este documento bate com a
migration 3 (`tests/system-templates.test.ts`) — a migration guarda o
estado ANTIGO de propósito (não foi alterada nesta rodada; ver proposta
de migration futura no relatório desta tarefa).

---

## 1. lembrete_24h

- **Nome do template (Meta):** `lembrete_24hrs_antes`
- **Idioma:** pt_BR
- **Categoria:** UTILITY
- **Cabeçalho (cadastrado na Meta, texto fixo, SEM variável):** "Olá" — nunca enviado como componente separado (um cabeçalho sem variável não precisa de componente no envio)
- **Gatilho (não submetido à Meta, só uso interno):** 24 horas antes do horário marcado

**Corpo do texto (começa direto na variável 1 — sem "Olá," no corpo, que já está no cabeçalho):**
```
{{1}}Passando para lembrar que amanhã, às {{2}}, você tem um horário reservado para {{3}} no {{4}}. Estamos te esperando! Por favor, confirme sua presença abaixo.
```

**Ordem das variáveis:** 1=nome da cliente (com "! " no final, pra ler como frase — o corpo não tem separador antes de "Passando"), 2=horário, 3=serviço, 4=nome do salão

**Exemplo:** "Marina! ", 14:00, Cílios Volume Russo, Studio Bella

**Botões (resposta rápida, nesta ORDEM — cada um com a ação/payload correspondente):** Confirmar (confirm) | Cancelar (cancel) | Reagendar (reschedule)

---

## 2. lembrete_2h

- **Nome do template (Meta):** `lembrete_2hrs_antes`
- **Idioma:** pt_BR
- **Categoria:** UTILITY
- **Cabeçalho (cadastrado na Meta, texto fixo, SEM variável):** "Ola" (sem acento) — mesma observação do lembrete_24h, nunca enviado como componente
- **Gatilho (não submetido à Meta, só uso interno):** 2 horas antes do horário marcado

**Corpo do texto (o corpo já tem "Olá," fixo, com vírgula, antes da variável 1):**
```
Olá,{{1}}!💛 Seu horário de {{2}} é hoje, às {{3}} , no {{4}}. Estamos te esperando! Se tiver algum imprevisto, é só nos avisar por aqui.
```

**Ordem das variáveis (DIFERENTE do lembrete_24h de propósito):** 1=nome (com espaço ANTES, pra separar de "Olá,"), 2=serviço, 3=horário, 4=salão

**Exemplo:** " Marina", Cílios Volume Russo, 14:00, Studio Bella

**Botões:** nenhum

---

## 3. pos_avaliacao_google

- **Nome do template (Meta):** `pedido_de_avaliao_` (18 caracteres exatos, sem "ç" nem "ã", termina com "_" — fácil de digitar errado)
- **Idioma:** pt_BR
- **Categoria:** UTILITY (a Meta pode reclassificar na aprovação, por ter um link externo)
- **Gatilho (não submetido à Meta, só uso interno):** depois do atendimento concluído — só na primeira vez da cliente
- **Status de envio:** ainda NÃO enviado pelo código (Etapa 2) — só mapeado nesta rodada

**Corpo do texto (nome do estabelecimento é fixo "Studio" no texto aprovado, não é variável):**
```
Olá, {{1}}! 💛 Foi um prazer te atender hoje no Studio. Sua opinião é muito importante para nós! Se puder, deixe sua avaliação no Google por este link: {{2}} Agradecemos a sua confiança!
```

**Ordem das variáveis:** 1=nome, 2=link

**Exemplo:** Marina, https://g.page/r/exemplo/review

**Botões:** nenhum

**Observação:** o link ({{2}}) vem de `company_profiles.google_review_url`, cadastrado pela dona na tela da própria mensagem. Enquanto esse campo estiver vazio, o envio real (fora de escopo desta etapa) não pode ser ativado.

---

## 4. retorno_30_dias

- **Nome do template (Meta):** `retorno_30_dias` (igual à chave interna, neste caso — conferir não custa, nem sempre é assim)
- **Idioma:** pt_BR
- **Categoria:** MARKETING
- **Gatilho (não submetido à Meta, só uso interno):** cliente há mais de 30 dias sem atendimento concluído
- **Status de envio:** ainda NÃO enviado pelo código (Etapa 2) — só mapeado nesta rodada

**Corpo do texto (nome do estabelecimento também fixo "Studio" no texto aprovado):**
```
Olá, {{1}}! 💛 Sentimos sua falta no Studio. Já faz um tempinho desde o seu último atendimento. Que tal agendar seu retorno? Reserve seu horário pelo link: {{2}} Esperamos você em breve!
```

**Ordem das variáveis:** 1=nome, 2=link

**Exemplo:** Marina, https://auraappia.lovable.app/agendar/studio-bella

**Botões:** Parar de receber mensagens

---

## Nome na Meta no banco (`automations.meta_template_name`) — AINDA desatualizado

A coluna `automations.meta_template_name` no banco real ainda guarda os
nomes ANTIGOS (iguais ao `template_key`) — não foi escrita nesta rodada
(somente leitura autorizada no banco; ver proposta de migration no
relatório desta tarefa). Isso não quebra o envio: o código nunca leu
essa coluna pra decidir o nome enviado (só pra checar se está
preenchida, em `central-reminder-scheduler.server.ts`) — o nome real
vem sempre de `system-templates.ts` (ver acima). Mas a coluna no banco
hoje **não reflete a realidade** e pode confundir quem for direto na
tabela sem saber disso.

## Status atual (banco de produção)

| Template | meta_status | Observação |
|---|---|---|
| lembrete_24h | PENDING | Era a automação "Lembrete 24h antes" já instalada; convertida em mensagem de sistema pela migration 3, mantendo o estado de ativação que já tinha. |
| lembrete_2h | APPROVED | Nasce pausada (`active=false`) — ativação do envio automático é etapa futura, fora de escopo. |
| pos_avaliacao_google | PENDING | Nasce pausada. Precisa do link do Google cadastrado antes de poder ser ativada no futuro. |
| retorno_30_dias | PENDING | Nasce pausada. |

## Comando para atualizar o status quando a Meta decidir (item 3.5)

A dona não roda SQL — quando ela avisar "a Meta aprovou X" (ou rejeitou),
quem roda este UPDATE é o Claude Code, substituindo `<template_key>` e o
valor de `meta_status`/`rejection_reason` conforme o caso:

```sql
UPDATE public.automations
SET meta_status = 'APPROVED'        -- ou 'REJECTED', 'PENDING'
    -- , rejection_reason = 'motivo informado pela Meta'  -- só se REJECTED
WHERE template_key = '<lembrete_24h | lembrete_2h | pos_avaliacao_google | retorno_30_dias>'
  AND is_system = true
  AND deleted_at IS NULL;
```

Esse UPDATE roda como conexão privilegiada (`postgres`/`service_role`),
que é o único caminho que passa pela trava `trg_23_automations_protect_meta_fields`
(UR010) — é exatamente a mesma trava que impede qualquer outra pessoa de
mudar esse campo pela API.
