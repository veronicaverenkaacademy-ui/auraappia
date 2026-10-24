# Achado lateral: `owner_id = uid()` em escritas do app inteiro (não corrigido, só documentado)

Descoberto em 06/10/2026 investigando o item 1.5 da Fase 1 do Sistema de Automações
(owner-resolution pra `createBlankAutomation`/`createJourney`/etc.). **Nenhuma das
funções abaixo foi alterada** — este documento é material pra decisão futura, não um
changelog de correção.

## O padrão

Toda função de escrita fora do Sistema A (que usa `createServerFn` + `context.userId`)
usa, em vez disso, um client Supabase direto do browser (`src/integrations/supabase/
client.ts`) e resolve `owner_id` chamando `uid()` — que é literalmente `(await
supabase.auth.getSession()).data.session.user.id`, ou seja, **o uid de quem está
logado agora**, nunca o uid do dono do estabelecimento quando quem está logado é uma
colaboradora.

## Por que isso não dá erro (e por que é pior do que dar erro)

As tabelas abaixo têm **duas policies simultâneas** por comando, por design aditivo
(a migration de `staff_access.sql` nunca tocou as policies antigas):

```
<tabela>_own_all   FOR ALL  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id)
<tabela>_staff_*   FOR SELECT/INSERT/UPDATE  USING/WITH CHECK (staff_can(owner_id, '<resource>', '<ação>') [+ condições extra])
```

Como `owner_id` no INSERT vem de `uid()` (o próprio chamador), a condição
`auth.uid() = owner_id` da policy `_own_all` **é sempre verdadeira, tautologicamente**
— `owner_id` e `auth.uid()` são sempre o mesmo valor por construção, não importa quem
está chamando. Então o INSERT **sempre passa pela policy antiga, nunca precisa
chegar a `staff_can()`**. Duas consequências:

1. **Dado vai para o owner_id errado, silenciosamente.** Uma Gerente que cria um
   agendamento grava `appointments.owner_id` = o próprio uid da Gerente, não o do
   salão. Essa linha nunca aparece pra dona, nunca aparece pra outra colaboradora do
   mesmo salão (o `team_members` delas aponta pro owner_id real, não pro uid da
   Gerente) — fica órfã, só visível pra própria Gerente (porque as leituras dela
   também caem na mesma policy `auth.uid() = owner_id`, agora comparando contra o
   valor errado que ela mesma gravou).
2. **`access_level_permissions` não é de fato aplicado nessas escritas.** Mesmo uma
   Recepcionista com `'create'=false` em `agenda` (seed real, conferido na Fase 0)
   consegue chamar `createAppointment()` com sucesso — a policy `_own_all` nunca
   consulta `staff_can()`, então o "não pode criar" nunca é de fato checado nesse
   caminho. Não é um furo entre estabelecimentos (ela nunca vê/edita dado de outro
   owner_id real), é a permissão de criar ser ignorada dentro do próprio caminho
   trivial.

## Onde isso acontece (verificado por grep + `pg_policies`, não presumido)

| Arquivo:linha | Função | Tabela | Policy `_own_all` confirmada | Policy `staff_can` que a UI deveria ter obrigado passar por |
|---|---|---|---|---|
| `src/lib/agenda.ts:188` | `createAppointment` | `appointments` | `appointments_own_all` | `appointments_staff_insert` (`agenda`,`create`) |
| `src/lib/agenda.ts:263` | `completeAppointment` (materiais) | `appointment_materials` | `appointment_materials_own_all` | `appointment_materials_staff_insert` (`agenda`,`edit`) |
| `src/lib/agenda.ts:365` | `createBlock` | `agenda_blocks` | `agenda_blocks_own_all` | `agenda_blocks_staff_insert` (`agenda`,`create`) |
| `src/lib/finance.ts:82` | `upsertSettings` | `finance_settings` | `finance_settings_own_all` | **nenhuma** — staff nunca tem acesso de escrita a finance_settings, mesmo via bug |
| `src/lib/finance.ts:88` | `upsertTx` | `finance_transactions` | `finance_tx_own_all` | **nenhuma policy de INSERT/UPDATE staff** (só SELECT existe) |
| `src/lib/finance.ts:102` | `upsertGoal` | `finance_goals` | `finance_goals_own_all` | **nenhuma** |
| `src/lib/inventory.ts:66` | `upsertSupplier` | `suppliers` | `suppliers_own_all` | **nenhuma** |
| `src/lib/inventory.ts:98` | `addBatch` | `product_batches` | `product_batches_own_all` | **nenhuma** |
| `src/lib/inventory.ts:121` | `registerWaste` | `stock_movements` | `stock_movements_own_all` | **nenhuma** |
| `src/lib/catalog.ts:97-98` | `upsertProduct` | `products` | `products_own_all` | **nenhuma** |
| `src/lib/catalog.ts:110,128` | movimento de compra | `stock_movements` | idem acima | **nenhuma** |
| `src/lib/catalog.ts:134,141` | `registerWaste`-like (ajuste) | `stock_movements` | idem acima | **nenhuma** |
| `src/lib/catalog.ts:160-161` | `upsertService` | `services` | `services_own_all` | **nenhuma INSERT/UPDATE** (só SELECT existe) |
| `src/lib/catalog.ts:182,184` | materiais do serviço | `service_materials` | `service_materials_own_all` | **nenhuma** |

Nas 11 últimas linhas da tabela (finance/inventory/catalog), não existe NENHUMA
policy `staff_can` de escrita hoje — ou seja, mesmo corrigindo o `owner_id`, staff
ainda não teria acesso de escrita a essas tabelas (só a bug de atribuição seria
resolvida). Em `agenda.ts` (3 primeiras linhas), as policies `staff_can` de INSERT
**já existem e funcionariam corretamente** se o `owner_id` enviado fosse o do dono —
é nessas 3 que a correção teria efeito prático imediato pra Gerente/Recepcionista com
permissão de `create`/`edit` em `agenda`.

## O que NÃO foi feito (de propósito, fora do escopo autorizado)

- Nenhuma dessas 14 funções foi alterada.
- Nenhuma policy foi tocada.
- `clients.ts` (função de criar cliente) não foi auditado neste levantamento — o
  mesmo padrão provavelmente se repete (`clients_own_all` existe e tem o mesmo
  formato), mas não confirmei o arquivo/linha exatos; se for relevante, precisa de
  uma passada dedicada.

## Decisão pendente pra uma fase futura

Resolver isso corretamente exige um padrão de "owner_id da escrita" único e
compartilhado por todo o app (provavelmente o mesmo `resolveOwnerIdForWrite` criado
agora só para `marketing.functions.ts`, promovido para um lugar comum e usado por
`agenda.ts`/`finance.ts`/`inventory.ts`/`catalog.ts`/`clients.ts`), decidido e
revisado como seu próprio projeto — não uma correção incidental dentro da Fase 1 de
Automações.
