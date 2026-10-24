# Submissão dos 4 templates à Meta (WhatsApp Business)

Gerado a partir de `src/lib/marketing/system-templates.ts` (fonte única —
não edite este arquivo sem editar a fonte primeiro; um teste
(`tests/system-templates.test.ts`) confere que o texto da migration bate
com a fonte, e este documento usa exatamente os mesmos textos).

Este documento é o material para submeter os 4 templates ao Business
Manager da Meta (WhatsApp → Modelos de mensagem). Cada mensagem já está
salva no banco no formato posicional (`{{1}}`, `{{2}}`...), igual ao
exigido pela Meta.

---

## 1. lembrete_24h

- **Nome do template (Meta):** `lembrete_24h`
- **Idioma:** pt_BR
- **Categoria:** UTILITY
- **Gatilho (não submetido à Meta, só uso interno):** 24 horas antes do horário marcado

**Corpo do texto:**
```
Olá, {{1}}! 💛 Passando para lembrar que amanhã, às {{2}}, você tem um horário reservado para {{3}} no {{4}}. Estamos te esperando! Por favor, confirme sua presença abaixo.
```

**Exemplos das variáveis (nesta ordem):** Marina, 14:00, Cílios Volume Russo, Studio Bella

**Botões:** Confirmar presença | Reagendar | Cancelar

---

## 2. lembrete_2h

- **Nome do template (Meta):** `lembrete_2h`
- **Idioma:** pt_BR
- **Categoria:** UTILITY
- **Gatilho (não submetido à Meta, só uso interno):** 2 horas antes do horário marcado

**Corpo do texto:**
```
Olá, {{1}}! 💛 Seu horário de {{2}} é hoje, às {{3}}, no {{4}}. Estamos te esperando! Se tiver algum imprevisto, é só nos avisar por aqui.
```

**Exemplos das variáveis (nesta ordem):** Marina, Cílios Volume Russo, 14:00, Studio Bella

**Botões:** nenhum

---

## 3. pos_avaliacao_google

- **Nome do template (Meta):** `pos_avaliacao_google`
- **Idioma:** pt_BR
- **Categoria:** UTILITY (a Meta pode reclassificar na aprovação, por ter um link externo)
- **Gatilho (não submetido à Meta, só uso interno):** depois do atendimento concluído — só na primeira vez da cliente

**Corpo do texto:**
```
Olá, {{1}}! 💛 Foi um prazer te atender hoje no {{2}}. Sua opinião é muito importante para nós! Se puder, deixe sua avaliação no Google por este link: {{3}} Agradecemos a sua confiança!
```

**Exemplos das variáveis (nesta ordem):** Marina, Studio Bella, https://g.page/r/exemplo/review

**Botões:** nenhum

**Observação:** o link ({{3}}) vem de `company_profiles.google_review_url`, cadastrado pela dona na tela da própria mensagem. Enquanto esse campo estiver vazio, o envio real (fora de escopo desta etapa) não pode ser ativado.

---

## 4. retorno_30_dias

- **Nome do template (Meta):** `retorno_30_dias`
- **Idioma:** pt_BR
- **Categoria:** MARKETING
- **Gatilho (não submetido à Meta, só uso interno):** cliente há mais de 30 dias sem atendimento concluído

**Corpo do texto:**
```
Olá, {{1}}! 💛 Sentimos sua falta no {{2}}. Já faz um tempinho desde o seu último atendimento. Que tal agendar seu retorno? Reserve seu horário pelo link: {{3}} Esperamos você em breve!
```

**Exemplos das variáveis (nesta ordem):** Marina, Studio Bella, https://auraappia.lovable.app/agendar/studio-bella

**Botões:** Parar de receber mensagens

---

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
