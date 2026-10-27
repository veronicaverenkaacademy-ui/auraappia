# Templates da Meta (WhatsApp Business) — nomes/textos REAIS

Gerado a partir de `src/lib/marketing/system-templates.ts` (fonte única —
não edite este arquivo sem editar a fonte primeiro).

**ALINHAMENTO COM A META REAL (27/10/2026):** até 26/10/2026 este
documento era o material de SUBMISSÃO (antes de qualquer aprovação),
usando a chave interna (`lembrete_24h` etc.) também como nome do
template na Meta — nunca foi conferido contra o que a Meta de fato
aprovou. Isso causou o erro 132001 ("Template inexistente") em
produção. Os nomes/textos/botões foram corrigidos pros REAIS, tirados
dos prints do Gerenciador do WhatsApp da conta "AURA agendaia WABA".

**MODELOS _v2 (27/10/2026, mesmo dia):** depois do fix acima, a Meta
passou a responder com erro 132000 (quantidade de variáveis não bate).
A tela "Editar modelo" (não a de preview) revelou a causa:
`lembrete_24hrs_antes`/`lembrete_2hrs_antes` têm "Tipo de variável:
Nome" com `{{}}` literalmente vazio — nunca receberam nome de variável
na criação — enquanto o app sempre mandou parâmetro POSICIONAL
(`{{1}}`, `{{2}}`...). **O tipo de variável não pode ser alterado num
template já aprovado** — a única saída é criar um template novo. A dona
criou `lembrete_24h_v2`/`lembrete_2h_v2` com "Tipo de variável: Número"
(posicional real, igual ao que o app sempre mandou) e submeteu à Meta
em 27/10/2026 (pt_BR, categoria Utilidade). Os nomes/textos abaixo já
são os dos modelos `_v2` — **pendentes de aprovação no momento desta
mudança**.

**⚠️ GATILHO DE MERGE: o PR que troca o código para os nomes `_v2` só
deve ser mesclado DEPOIS que a Meta aprovar os dois (a dona avisa
quando acontecer). Mesclar antes da aprovação traz de volta o erro
132001 (nome inexistente) — pior que o 132000 atual, que pelo menos
prova que o nome é encontrado.**

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

- **Nome do template (Meta):** `lembrete_24h_v2` — pendente de aprovação (submetido 27/10/2026)
- **Idioma:** pt_BR
- **Categoria:** Utilidade (UTILITY)
- **Tipo de variável:** Número (posicional) — diferente do modelo antigo (`lembrete_24hrs_antes`, "Nome", nunca usado de verdade)
- **Cabeçalho:** nenhum
- **Rodapé:** nenhum
- **Gatilho (não submetido à Meta, só uso interno):** 24 horas antes do horário marcado

**Corpo do texto (literal, exatamente como submetido):**
```
Olá, {{1}}! 💛 Passando para lembrar que amanhã você tem um horário reservado para {{2}}, às {{3}}, no {{4}}. Estamos te esperando! Por favor, confirme sua presença abaixo.
```

**Ordem das variáveis:** 1=nome da cliente, 2=serviço, 3=horário, 4=nome do salão — nenhuma decoração extra no valor (o "Olá, " já é texto fixo do corpo).

**Exemplo:** Maria, Cílios fio a fio, 14:30, Studio Aura

**Botões (resposta rápida, nesta ORDEM — cada um com a ação/payload correspondente):** Confirmar (confirm) | Cancelar (cancel) | Reagendar (reschedule)

**Mensagem final (dados fictícios, como a cliente lê):**
```
Olá, Maria! 💛 Passando para lembrar que amanhã você tem um horário reservado para Cílios fio a fio, às 14:30, no Studio Aura. Estamos te esperando! Por favor, confirme sua presença abaixo.
```

---

## 2. lembrete_2h

- **Nome do template (Meta):** `lembrete_2h_v2` — pendente de aprovação (submetido 27/10/2026)
- **Idioma:** pt_BR
- **Categoria:** Utilidade (UTILITY)
- **Tipo de variável:** Número (posicional) — mesma observação do lembrete_24h_v2
- **Cabeçalho:** nenhum
- **Rodapé:** nenhum
- **Gatilho (não submetido à Meta, só uso interno):** 2 horas antes do horário marcado

**Corpo do texto (literal, exatamente como submetido):**
```
Olá, {{1}}! 💛 Seu horário de {{2}} é hoje, às {{3}}, no {{4}}. Estamos te esperando! Se tiver algum imprevisto, é só nos avisar por aqui.
```

**Ordem das variáveis (MESMA do lembrete_24h_v2 agora — unificado de propósito, diferente da rodada anterior):** 1=nome, 2=serviço, 3=horário, 4=salão

**Exemplo:** Maria, Cílios fio a fio, 14:30, Studio Aura

**Botões:** nenhum

**Mensagem final (dados fictícios, como a cliente lê):**
```
Olá, Maria! 💛 Seu horário de Cílios fio a fio é hoje, às 14:30, no Studio Aura. Estamos te esperando! Se tiver algum imprevisto, é só nos avisar por aqui.
```

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

## Status atual (banco de produção, confirmado por query somente-leitura em 27/10/2026)

| Template | meta_template_name (banco) | meta_status (banco) | active | Observação |
|---|---|---|---|---|
| lembrete_24h | `lembrete_24h` (igual ao template_key — desatualizado, nunca foi `lembrete_24hrs_antes` nem será `lembrete_24h_v2` automaticamente) | APPROVED | true | `meta_status=APPROVED` é só o valor padrão do seed, **não** reflete uma aprovação real verificada — nada no código lê essas 2 colunas para decidir o nome enviado ou o status exibido. |
| lembrete_2h | `lembrete_2h` (mesma observação) | APPROVED | true | idem |
| pos_avaliacao_google | não enviado pelo código ainda (Etapa 2) | — | — | não verificado nesta rodada |
| retorno_30_dias | não enviado pelo código ainda (Etapa 2) | — | — | não verificado nesta rodada |

Ver proposta de migration (não aplicada) para alinhar essas 2 colunas aos
nomes `_v2` no relatório/diário desta tarefa.

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

---

## Guia para criar modelos na Meta (evitar o erro 132000/132001 de novo)

Checklist antes de clicar em "Enviar para análise" no Gerenciador do
WhatsApp, baseado no que já deu errado 2 vezes (nome errado → 132001;
tipo de variável errado → 132000):

1. **Tipo de variável: sempre "Número"**, nunca "Nome". O app manda
   parâmetros posicionais (`{{1}}`, `{{2}}`...) — se o template for
   criado com "Nome", a Meta espera variáveis nomeadas de verdade
   (`{{saudacao}}`) e o parâmetro posicional não bate, mesmo que a
   contagem esteja certa.
2. **Variáveis sequenciais a partir de `{{1}}`**, sem pular número
   (`{{1}}`, `{{2}}`, `{{3}}`...) — nunca `{{2}}`, `{{4}}` sem `{{1}}`/`{{3}}`.
3. **O corpo nunca pode começar nem terminar com uma variável** — a Meta
   rejeita a submissão; sempre precisa de texto fixo nas duas pontas
   (ex.: "Olá, " antes de `{{1}}`, "." ou "!" depois da última).
4. **Nunca criar um cabeçalho com variável** — se o cabeçalho tiver
   `{{1}}`, ele passa a exigir um componente `header` no envio; os
   templates do AURA são sempre sem cabeçalho (texto fixo opcional ou
   nenhum), pra não precisar desse componente extra.
5. **Preencher os valores de exemplo** de cada variável antes de
   submeter — a Meta não aceita análise sem isso.
6. **Botões na ordem exata do contrato** (`system-templates.ts` →
   `buttons`/`buttonActions`) — a ordem que aparece no Gerenciador é a
   ordem que a Meta usa no `index` do envio; se a dona reordenar na
   Meta, o código do AURA também precisa ser atualizado (`buttonActions`
   na mesma ordem).
7. **Nome do template:** só `[a-z0-9_]`, sem espaço, sem acento, sem
   maiúscula. Conferir sempre no campo exato do Gerenciador antes de
   colar em `metaTemplateName` — um caractere errado só aparece como erro
   132001 depois de uma tentativa real de envio.
8. **Nunca editar um template já aprovado para mudar o tipo de
   variável** (nem outro atributo estrutural, como contagem de
   variáveis ou cabeçalho) — a Meta não permite essa edição depois da
   aprovação. A única saída é criar um template NOVO com nome
   versionado (`_v2`, `_v3`...) e trocar `metaTemplateName` no código
   para o novo nome, só depois da aprovação do novo.
9. **Antes de submeter, confirmar na tela de EDIÇÃO (não a de preview)**
   que o corpo mostra `{{1}}`, `{{2}}`... com os números certos — a tela
   de preview pode mostrar o texto renderizado com os exemplos e
   escondia, nas 2 vezes anteriores, que o corpo real tinha `{{}}` vazio.
