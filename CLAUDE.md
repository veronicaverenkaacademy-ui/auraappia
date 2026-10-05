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

## Codemagic — publicação ao TestFlight via Apple ID + senha específica de app (fallback temporário, 20/09/2026)

A Apple está com um bug confirmado (caso de suporte nº 20000145256294) que impede o
**download** de qualquer chave de API do App Store Connect recém-criada — 13 chaves
criadas entre 23/08 e 06/09/2026 falharam todas no download, em múltiplos dispositivos
e navegadores. Sem prazo de solução da Apple. Enquanto isso durar, `ios-release`
publica ao TestFlight via `--apple-id`/`--password` (senha específica de app) no
lugar de `--issuer-id`/`--key-id`/`--private-key`, usando o env group novo
`aura_publishing` (`AURA_APPLE_ID`, `AURA_APP_SPECIFIC_PASSWORD`) — **paralelo** ao
`aura_signing` existente, que nunca foi tocado (a assinatura de código já era manual,
via certificado/profile pré-carregados no Codemagic, e nunca dependeu da API Key).

Confirmado rodando a CLI real (`pip install codemagic-cli-tools`, versão 0.69.0, num
ambiente Linux isolado — não é o mesmo binário/versão exata da imagem `mac_mini_m2`
do Codemagic, mas as flags abaixo são centrais à ferramenta e improváveis de terem
mudado): `app-store-connect publish --apple-id/--password` é documentado pela própria
CLI como alternativa válida ao API Key, mas só para "application package validation
and upload" — não há confirmação de que `--beta-group` (atribuição automática a grupo
de teste do TestFlight) funcione combinado com esse método de autenticação, só que a
flag existe. Por isso o `ios-release` **não** usa `--beta-group` nem `--testflight`
nesta primeira versão — atribuir ao grupo de teste manualmente no App Store Connect
depois de cada upload, até confirmar isso num teste real.

**As duas lacunas acima foram resolvidas no mesmo dia (20/09/2026), autorizado pela
dona:**
1. `CURRENT_PROJECT_VERSION` agora é auto-incrementado a cada build, via
   `agvtool new-version -all "$(date -u +%Y%m%d%H%M%S)"` (etapa "Auto-increment build
   number" no `ios-release`, roda logo após `npx cap sync ios`, antes de qualquer
   assinatura). Usa timestamp UTC **com segundos** (14 dígitos, dentro do limite de
   18 da Apple) — não só minuto, pra evitar colisão num rerun manual logo após uma
   falha, que pode cair dentro do mesmo minuto — e não uma variável de build number
   própria do Codemagic (`PROJECT_BUILD_NUMBER`), já que há relatos na comunidade
   Codemagic de builds onde essa variável não incrementa como esperado; timestamp
   não depende de nenhum comportamento de plataforma e sempre cresce. Precisou
   adicionar
   `VERSIONING_SYSTEM = apple-generic;` nos build settings Debug e Release do
   `project.pbxproj` (App target) — sem isso `agvtool` falha, e essa configuração não
   existia no projeto antes desta mudança. **Não confirmável neste ambiente** (sem
   Xcode/macOS) — o primeiro build real no Codemagic é que vai confirmar se
   `agvtool` roda sem erro.
2. `ITSAppUsesNonExemptEncryption = false` adicionado em `ios/App/App/Info.plist` —
   confirmado pela dona: o AURA usa só HTTPS/TLS padrão (Supabase, WhatsApp API), sem
   criptografia própria implementada.

**Plano de reversão pra API Key**: assim que a Apple resolver o bug de download,
trocar a etapa "Publish to TestFlight" de volta pra usar `--issuer-id`/`--key-id`/
`--private-key` (grupo `aura_signing`, que já existe e nunca foi alterado) em vez de
`--apple-id`/`--password` (`aura_publishing`) — não precisa recriar nada do zero, só
trocar as flags dessa etapa específica.

## Login de cliente no Portal via OTP por WhatsApp nunca funcionou (migration `client_otp_codes` nunca aplicada, 08/08/2026 → 29/09/2026)

Descoberto em 29/09/2026, investigando a troca do número de WhatsApp da AURA: o
login de cliente no portal público (`requestClientOtp`/`verifyClientOtp`,
`src/lib/otp/otp.functions.ts`) depende da tabela `client_otp_codes`
(`supabase/migrations/20260808130000_client_otp_codes.sql`) — commitada e mergeada em
08/08/2026, mas **nunca aplicada em produção** até esta data. Mesmo padrão já descrito
no topo deste arquivo (arquivo de migration ≠ migration aplicada), só que desta vez
descoberto não por erro reportado pela dona, mas por auditoria: `audit_log` tinha
**zero linhas** com `resource = 'client_otp'` desde sempre — nem um único sucesso, nem
uma falha logada — apesar do fluxo estar de fato ligado em telas reais
(`booking-flow.tsx`, `client-auth-steps.tsx`, `client-account-panel.tsx`).

**Contexto importante que não é sobre o bug em si**: login por telefone/OTP é a
**única** porta de entrada do cliente no portal — não existe e-mail/senha nem OAuth
alternativo — e é uma etapa **obrigatória** do funil de agendamento
(`booking-flow.tsx` força `auth.start()` ao chegar no step de autenticação). Ou seja,
enquanto essa migration não estava aplicada, **nenhum cliente conseguiu completar um
agendamento pelo portal público**, silenciosamente, desde 08/08/2026. Quando o envio
falha (ex.: WhatsApp fora do ar), a tela já mostra um toast genérico
("Não conseguimos enviar o código agora...") sem vazar erro técnico — mas como não há
alternativa de login, uma falha aqui bloqueia o agendamento inteiro, não é uma opção
que dá pra "esconder" sem desligar o booking por completo.

Aplicada e verificada em 29/09/2026 (tabela, colunas, RLS, grants, índice e
`supabase_migrations.schema_migrations` todos conferidos via `information_schema`/
`pg_catalog` reais). `types.ts` já tinha o bloco `client_otp_codes` correto por
coincidência (uma geração anterior já tinha "adivinhado" certo, mesmo com a tabela
não existindo ainda) — não precisou de patch desta vez.

**Conclusão prática — o portal de agendamento continua bloqueado**: aplicar esta
migration resolve o erro de banco (`relation "client_otp_codes" does not exist`), mas
não resolve o envio em si — `requestClientOtp` ainda depende de
`send-otp-360dialog.server.ts`, o canal que está sendo abandonado (ver decisão de
trocar pra um número novo direto na Meta, documentada na investigação em andamento
sobre o número de WhatsApp da AURA). Ou seja: **nenhum cliente consegue completar um
agendamento pelo portal público até o número novo estar ativo e o código de envio ser
trocado pra Meta nativa** — a migration tira um bug, mas o bloqueio de fundo
(depender de um canal 360dialog cujo plano/saldo nunca foi confirmado como ativo)
continua até aquela outra frente ser concluída.

**Achado lateral da mesma auditoria**: comparando todos os 37 arquivos em
`supabase/migrations/` contra `supabase_migrations.schema_migrations`, 9 migrations
não estavam registradas no livro de controle (`20260730130000_agenda_real`,
`20260811090000_whatsapp_evolution_mvp`, `20260816120000_whatsapp_expected_phone`,
`20260817160000_whatsapp_appointment_created_notification`,
`20260817220000_whatsapp_meta_cloud_api_provider`, `20260825120000_access_levels`,
`20260825140000_staff_access`, `20260901120000_agenda_own_scope`,
`20260906120000_commission_snapshot`) — mas, diferente do `client_otp_codes`, **todas
as 9 foram confirmadas como realmente aplicadas** (tabelas/funções/colunas/constraints
verificadas ao vivo uma a uma, incluindo contagem de políticas/triggers/índices nas
três migrations com mais objetos — `whatsapp_evolution_mvp`, `access_levels` e
`staff_access` — todas batendo exatamente com o esperado) — era só uma lacuna de
registro, não um bug funcional.

**Atualização de 05/10/2026**: as 9 migrations foram registradas em
`supabase_migrations.schema_migrations` via `INSERT ... ON CONFLICT (version) DO
NOTHING` (idempotente, sem nenhum DDL), com `created_by` citando a evidência
específica de aplicação de cada uma. Ponto de partida reconfirmado em tempo real
antes do INSERT (0 linhas para essas 9 versões) e resultado pós-INSERT confirmado
com as 9 linhas presentes. Nenhuma migration foi reaplicada — só o registro no
livro de controle, que estava faltando.

Achado inverso também presente: `20260808030000_company_assets_select_policy.sql`
estava registrado como aplicado, mas o arquivo não existia no repositório. Recriado
em PR separado (#78) a partir da definição real da policy em `pg_policies`
(`roles`/`qual` confirmados batendo exatamente), com `DROP POLICY IF EXISTS` antes
do `CREATE POLICY` para manter o padrão idempotente do projeto — também sem
necessidade de reaplicar nada, já estava ativo em produção.

Nenhuma dessas 9 tem relação com `finance_goals`/`finance_settings`/`stock_movements`
(o bug de CFO/DRE incompleto pra staff, documentado em investigação anterior) — só 5
migrations tocam essas 3 tabelas, e todas as 5 já estavam registradas e aplicadas
desde sempre; aquele bug é uma lacuna do desenho original das políticas RLS dessas
tabelas, não uma migration pendente.
