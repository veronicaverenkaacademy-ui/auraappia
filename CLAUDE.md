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
