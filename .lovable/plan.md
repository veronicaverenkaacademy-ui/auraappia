
# Fase 14 — Gestão da Equipe (Team Management + RBAC)

Vamos construir o módulo **Equipe** do AURA com uma arquitetura de **Papéis e Permissões (RBAC)** desde o dia 1 — igual Google Workspace, Notion e Stripe. Começamos com dois papéis (**Administrador** e **Colaborador**), mas o sistema aceita novos papéis via configuração, sem tocar em código.

## 1. Arquitetura de Papéis e Permissões

Tabelas no backend (Lovable Cloud):

```text
app_role          enum      → 'admin' | 'staff'  (extensível: manager, receptionist, finance…)
user_roles        tabela    → (user_id, role)         RLS via has_role()
team_members      tabela    → perfil profissional ligado a auth.users
team_permissions  tabela    → matriz granular (member_id, resource, action, allowed)
audit_log         tabela    → quem/quando/o quê/dispositivo
commissions       tabela    → regras por serviço/categoria/produto
goals             tabela    → metas diária/semanal/mensal/anual
payroll_entries   tabela    → bonificações, descontos, adiantamentos
```

Todas com **RLS**, `GRANT` explícito e função `has_role()` security-definer (padrão AURA).

**Recursos protegidos** (visualizar/criar/editar/excluir/exportar…): `agenda`, `clients`, `services`, `finance`, `marketing`, `stock`, `bi`, `settings`, `team`, `whatsapp`, `aura_ia`.
Um `staff` recebe defaults restritos; o admin abre exceções pela matriz.

## 2. Cadastro de Colaborador

Botão **+ Adicionar Colaborador** abre drawer com:
Foto, Nome, Telefone, E-mail, Senha inicial, Cargo, Profissão, Cor da agenda, Comissão (% ou R$), Meta mensal, Status (Ativo/Inativo/Férias/Desligado).

Ao salvar: cria conta em `auth.users` (server function com service-role), grava em `team_members` e `user_roles` (`staff` por padrão), gera credenciais copiáveis/compartilháveis por WhatsApp.

## 3. Primeiro Acesso do Colaborador

Fluxo obrigatório em `/onboarding`:
1. Trocar senha
2. Aceitar Termos de Uso
3. Aceitar Política de Privacidade
4. Completar perfil (foto, bio, Instagram)
Só depois libera o app.

## 4. Rotas e Navegação

**Novas rotas:**
```text
/_authenticated/equipe                → Dashboard da equipe (admin)
/_authenticated/equipe/$id            → Perfil do colaborador
/_authenticated/equipe/permissoes     → Matriz RBAC
/_authenticated/equipe/comissoes      → Regras de comissão
/_authenticated/equipe/metas          → Metas e ranking
/_authenticated/equipe/folha          → Folha de pagamento
/_authenticated/equipe/auditoria      → Log de auditoria
/_authenticated/meu-espaco            → Painel pessoal do colaborador
/_authenticated/onboarding            → Primeiro acesso
/l/$slug                              → Link público de agendamento por colaborador
```

Sidebar ganha item **Equipe** (visível só para admin) via novo hook `usePermissions()`. Colaboradores só veem: Meu Espaço, Agenda, Clientes (dos próprios atendimentos), Serviços (protocolos), Notificações.

## 5. Telas Principais (design Apple/Linear/Stripe)

- **Equipe (admin)** — Abas: Colaboradores · Papéis e Permissões · Metas · Comissões · Folha de Pagamento · Ranking · Auditoria. KPIs no topo (ativos, agenda hoje, meta média, comissão a pagar, convites pendentes).
- **Perfil do colaborador** — foto, status, contato, agenda cor, comissão, meta, botão redefinir senha, alternar papel, ver auditoria individual.
- **Matriz de Permissões** — tabela recurso × ação com toggles; presets (Administrador, Colaborador, custom futuro).
- **Meu Espaço (colaborador)** — Cards: Agenda de hoje, Próximos atendimentos, Horários livres, Metas com anel de progresso, Comissão estimada (se permitido), Link + QR Code, Histórico pessoal, Estatísticas (confirmação, pontualidade, avaliações), Perfil.
- **Link público** `/l/$slug` — Landing minimalista mostrando só os horários do colaborador, reutiliza o fluxo existente de `/`.

## 6. Comissões, Metas e Folha

- Comissão: % ou R$, por serviço/categoria/produto/pacote — cálculo automático quando `appointment.status = completed`.
- Metas: diária/semanal/mensal/anual com progresso em tempo real.
- Folha simplificada: soma comissões + bonificações − descontos − adiantamentos, exporta PDF/Excel.
- Ranking interno: faturamento, atendimentos, ticket médio, retenção, avaliação, produtividade (admin liga/desliga).

## 7. Auditoria e Notificações

- Trigger em cada mutação relevante grava `audit_log` (autor, ação, entidade, IP, user-agent, timestamp).
- Colaborador recebe notificação em: novo agendamento, remarcação, cancelamento, confirmação, mensagens da empresa.

## 8. Segurança

- RLS: colaborador só enxerga próprios `appointments`, `commissions`, `goals`, `audit_log`.
- Server functions com `requireSupabaseAuth` + checagem `has_role('admin')` para operações sensíveis (criar colaborador, alterar papel, ajustar permissões).
- Rota `_authenticated/equipe/*` protegida por `beforeLoad` que valida papel admin via contexto de auth.

## Detalhes técnicos

- **Backend:** 1 migração criando enum `app_role`, tabelas acima, RLS, `has_role()`, triggers de auditoria, GRANTs.
- **Server functions** (`src/lib/team.functions.ts`): `createTeamMember`, `updateRole`, `setPermission`, `resetPassword`, `computePayroll`.
- **Frontend:** hook `usePermissions()` lendo `user_roles` + `team_permissions` no bootstrap; guard `<RequirePermission resource action>`; helper `<AdminOnly>`.
- **Slug de link:** coluna `booking_slug` única em `team_members`; rota `/l/$slug` reaproveita componentes de `src/routes/index.tsx`.
- **Auditoria:** view `audit_log_enriched` juntando nomes; página com filtros (autor, recurso, período).

## Fora do escopo desta fase

- Login por SMS/Google/Apple/biometria para colaboradores (fica como próximo passo — hoje login por telefone+senha já cobre).
- Multi-unidade / multi-tenant hierárquico.
- Papéis extras (Recepcionista, Financeiro, Marketing, Gerente) — arquitetura pronta, mas só habilitamos Administrador e Colaborador nesta entrega.

Confirma que posso executar assim?

---

## Adendo (2026-08-25) — pendência descoberta: forma de pagamento ao finalizar comanda

Nota adicionada durante a implementação dos 3 níveis de acesso nomeados (Recepcionista/
Profissional/Gerente, que substituem o "Colaborador" genérico mencionado acima). Este
adendo documenta uma lacuna real encontrada, para não precisar ser redescoberta depois —
**não implementada ainda**.

**O que falta**: `completeAppointment(id)` (`src/lib/agenda.ts`) hoje só muda
`appointments.status` para `'completed'` — não recebe nenhum parâmetro de forma de
pagamento. O valor lançado em `finance_transactions` vem de `appointments.price` (definido
na criação do agendamento, não digitado na hora de finalizar). O gatilho
`record_appointment_revenue()` (`SECURITY DEFINER`, dispara em `AFTER INSERT OR UPDATE ON
appointments`) grava a receita automaticamente, mas a coluna `finance_transactions.method`
não está na lista de colunas que ele preenche — fica sempre `NULL`.

**Arquitetura recomendada para quando for implementada**: adicionar uma coluna
`appointments.payment_method`, capturada na UI no momento de finalizar, e fazer o próprio
`record_appointment_revenue()` ler essa coluna e gravar em `finance_transactions.method`
dentro do mesmo `INSERT` que já existe hoje — **nunca** uma escrita direta do
frontend/servidor em `finance_transactions`.

**Por que essa arquitetura importa**: mantém a mesma garantia de segurança que já existe
hoje (só o gatilho, com privilégio elevado, sempre vinculado ao `owner_id` correto do
próprio agendamento) e evita ter que criar uma política de RLS de `INSERT` nova em
`finance_transactions` para Recepcionista/Profissional — que teria risco real de erro
(permitir apontar para um `appointment_id` de outra conta, se a `WITH CHECK` for mal
escrita).

**Também não existe hoje**: pagamento dividido/parcelado — o gatilho insere uma única
linha por atendimento concluído, sem nenhum conceito de split. Se a feature de forma de
pagamento também precisar suportar isso no futuro, é uma decisão de produto adicional a
ser tomada na hora, não antecipada aqui.
