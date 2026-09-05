# Instruções para o Claude neste repositório

## Migrações de banco de dados: verificação obrigatória em produção

Descoberto em produção (02/08/2026): duas migrações (`client_portal_auth`,
`appointment_materials`) foram commitadas, mergeadas e o código que dependia delas foi
publicado — mas as migrações em si nunca chegaram a rodar no banco de dados real. O
arquivo `.sql` existir no repositório e estar mergeado **não significa** que ela foi
aplicada. Isso causou falhas silenciosas em produção que só foram descobertas quando a
dona testou manualmente.

Regra permanente, válida para qualquer migração nova ou alterada:

1. **Nunca declarar o trabalho concluído só porque o arquivo de migração foi criado e
   commitado.** "Arquivo criado" e "migração aplicada" são coisas diferentes.
2. Antes de reportar a migração como concluída, **verificar de fato no banco de
   produção** que ela foi aplicada — por exemplo, consultando se a tabela/coluna/view
   nova existe (`information_schema.tables` / `information_schema.columns`) e,
   idealmente, conferindo `supabase_migrations.schema_migrations` para confirmar que a
   versão da migração está registrada.
3. **Reportar essa confirmação por escrito**, no mesmo PR ou na mesma resposta, com a
   evidência (não só "deve ter aplicado" — mostrar o resultado da consulta).
4. **Se não houver como verificar com certeza** (ex.: sem acesso ao banco de produção
   naquele momento), **avisar isso explicitamente** à dona em vez de presumir que
   "arquivo criado = aplicado".

## Merge direto pelo GitHub (sem créditos da Lovable) + migração de banco

Descoberto em produção (03/08/2026): o PR #13 (colunas `consumption_unit`/
`consumption_ratio` em `products`) foi commitado e mergeado direto via git/GitHub —
rota usada quando os créditos da Lovable acabam. O código do frontend publicou
normalmente (a Lovable sincroniza a partir do `main`), mas a migração em si nunca
rodou no banco, porque esse fluxo **não** executa migrações — só o fluxo normal da
Lovable (mensagem para o agente) faz isso. A dona só descobriu porque bateu no erro
"Could not find the column... in the schema cache" ao tentar usar a funcionalidade.

Regra permanente: sempre que um PR for mesclado por git direto (não pelo agente da
Lovable) **e** incluir arquivo novo/alterado em `supabase/migrations/`, isso conta
como um lembrete automático — não esperar a dona bater no erro:

1. Imediatamente depois do merge, **aplicar a migração manualmente** rodando o SQL do
   arquivo direto no banco de produção (via `query_database` ou equivalente).
2. **Verificar** com a mesma rigor da regra acima (schema real + `schema_migrations`)
   e reportar a evidência, sem esperar ser perguntado.
3. Ao aplicar fora do fluxo padrão, registrar a migração em
   `supabase_migrations.schema_migrations` também manualmente (mesma versão do nome
   do arquivo), para não deixar o "livro de controle" incompleto — deixando claro em
   `created_by` que foi aplicação manual, não pelo pipeline normal da Lovable.

## `src/integrations/supabase/types.ts` desatualizado após migração manual

Descoberto em produção (01/09/2026, durante a Etapa 3 do sistema de níveis de acesso):
`types.ts` é gerado automaticamente a partir do schema e só é regenerado quando a
Lovable processa uma migração pelo fluxo dela (chat) — nunca quando a migração é
aplicada manualmente (SQL Editor ou `query_database`). Isso já causou erros de
compilação (colunas/tabelas novas ausentes de `types.ts`) e, num caso mais grave, o
inverso: `types.ts` chegou a declarar `whatsapp_confirmation_threads` e duas colunas de
`appointments` que a migração correspondente (`20260816150000`) nunca havia de fato
aplicado — ou seja, o arquivo gerado "mentia" que uma feature existia no banco quando
não existia.

Comando oficial de regeneração (requer `SUPABASE_ACCESS_TOKEN` — pedir à dona,
gerado uma vez em supabase.com/dashboard; **nunca** commitar esse token nem
imprimi-lo em nenhuma resposta):
```
npx supabase gen types typescript --project-id vsgymacenyulrefmlspo --schema public \
  > src/integrations/supabase/types.ts
```
Atenção: em pelo menos um ambiente de execução (sessão de 01/09/2026) esse comando
falhou por política de rede do ambiente (`api.supabase.com` bloqueado pelo proxy,
403), não por problema do token — não presumir que é falha de autenticação sem
checar a mensagem de erro real. Se falhar assim, usar o fallback abaixo e avisar a
dona explicitamente do motivo.

Fallback (sem depender do comando oficial): auditar `information_schema.columns` via
`query_database` para as tabelas/colunas afetadas pela migração aplicada, e editar
`types.ts` manualmente só nesses pontos, seguindo o padrão exato dos blocos
vizinhos (incluindo `Relationships` com os nomes reais de FK, confirmados via
`pg_constraint` — não adivinhar o nome da constraint).

Checklist permanente para **toda migração aplicada manualmente** (SQL Editor,
`query_database`, ou merge direto pelo GitHub) daqui pra frente:

1. Confirmar o ponto de partida (idempotência) antes de aplicar — reconfirmar em
   tempo real, não reaproveitar resultado de verificação anterior na mesma conversa.
2. Colar e rodar o SQL (dentro de `BEGIN;`/`COMMIT;`).
3. Rodar as queries de verificação pós-aplicação e reportar a evidência.
4. Regenerar `types.ts` — comando oficial acima; se a rede bloquear, aplicar o
   fallback via `information_schema` e dizer explicitamente que foi o fallback.
5. Rodar `tsc --noEmit` e `eslint` nos arquivos tocados (incluindo `types.ts`);
   comparar contagem de erros antes/depois — zero erros novos é o critério de
   aceite, não "parece que compila".
6. Commitar a migração + o `types.ts` atualizado juntos, no mesmo commit.
7. Registrar no documento de continuidade do projeto.

## Exclusão manual de colaboradora de teste sempre deixa conta órfã em `auth.users`

Descoberto em produção (01-05/09/2026, duas vezes na mesma leva de testes da Etapa 3):
qualquer exclusão de `team_members` que **não** passe pelo botão "Excluir
permanentemente" (`deleteTeamMemberPermanently`, que chama
`supabaseAdmin.auth.admin.deleteUser()` depois de apagar a linha) deixa a conta de
`auth.users` correspondente órfã para sempre — e como `auth.users` tem `UNIQUE` em
`phone` e `email`, isso bloqueia esse telefone/e-mail de ser reusado em qualquer
cadastro futuro, silenciosamente, até alguém achar e apagar a conta órfã manualmente.

Isso vale pra **qualquer** exclusão fora do botão: `DELETE FROM team_members` direto
via SQL/`query_database`, edição manual, ou qualquer script futuro. Não existe atalho
seguro — a única forma de remover uma colaboradora sem deixar rastro em `auth.users` é
pelo fluxo da UI ("Excluir permanentemente"), porque só ele tem acesso à Admin API do
Supabase Auth.

Regra permanente: ao limpar dado de teste manualmente (SQL direto, painel Cloud →
Users, ou qualquer via que não seja o botão da UI), **sempre** verificar depois se
sobrou conta órfã em `auth.users` com o mesmo telefone/e-mail antes de dar o caso por
encerrado — não presumir que "apaguei a linha" e "conta de auth sumiu junto" são a
mesma coisa.

**Trade-off aceito conscientemente (05/09/2026, junto da remoção da aba de
Auditoria):** `deleteTeamMemberPermanently` não grava mais log estruturado do
resultado da chamada de `auth.admin.deleteUser()` em `audit_log` — só
`console.error()` no servidor quando ela falha. Isso foi exatamente a evidência
(`details.auth_account_deleted`/`auth_delete_error`) usada pra diagnosticar o caso de
órfã acima. Se um bug parecido de conta órfã voltar a acontecer, o diagnóstico vai ser
mais lento — sem nada consultável via SQL, só o que aparecer no log do servidor no
momento exato da falha. A dona já sabia disso e decidiu que valia a pena de qualquer
forma; não é um esquecimento a corrigir numa sessão futura.
