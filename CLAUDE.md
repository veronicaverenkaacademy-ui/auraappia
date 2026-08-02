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
