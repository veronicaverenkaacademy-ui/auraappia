# Portal da Cliente

## Landing Pública (`/l/:slug`)

`/l/:slug` é a porta de entrada pública do Portal da Cliente — link exclusivo por empresa,
compartilhado com clientes para elas conhecerem o negócio e (numa PR futura) agendar um
horário.

### Fluxo do slug

- `:slug` identifica uma **empresa** (`company_profiles.slug`), não uma profissional
  individual. Isso é intencional: o fluxo de agendamento é sempre "empresa → serviço →
  profissional (ou "qualquer uma") → horário" — a profissional é um passo dentro do
  fluxo, não a porta de entrada.
- A leitura pública nunca acessa `company_profiles` diretamente (RLS exige
  `owner_id = auth.uid()`, e uma visitante anônima não tem sessão). Em vez disso, lê a
  view `public_company_profiles`, que expõe só o subconjunto de colunas destinado a
  exibição pública — mesmo padrão já usado por `public_professionals` (ver
  `supabase/migrations/20260802120000_client_portal_auth.sql`).
- Slug inexistente → tela "Empresa não encontrada" com botão Voltar (nenhuma query
  adicional é feita, nenhum dado é presumido).
- Cada campo ausente (sem descrição, sem logo, sem redes, sem endereço) **oculta a seção
  correspondente**, nunca mostra "0", campo vazio ou dado de exemplo (Estados
  Inteligentes).

### Estrutura da Landing (`src/routes/l.$slug.tsx`)

`Hero` (logo, capa, nome, categoria, descrição curta, cidade, horário, CTA "Agendar
Agora") → `AboutSection` (Quem somos) → `ServicesSection` (Smart State — ainda sem
carregamento real) → `ProfessionalsSection` (Smart State — ainda sem carregamento real) →
`LocationSection` (endereço + link para Google Maps) → `SocialSection` (só redes
cadastradas) → `Footer` (nome, direitos autorais, Powered by AURA, links legais).

O CTA "Agendar Agora" ainda não abre nenhum fluxo — mostra um toast informativo. A
próxima PR conecta esse botão ao fluxo real de agendamento.

### Componentes criados nesta PR

- `src/lib/companyProfile.ts` — tipo `CompanyProfile`, leitura pública
  (`fetchCompanyProfileBySlug`, `fetchCompanySlugByOwnerId`) e `slugify`.
- `src/lib/companyProfile.functions.ts` — funções de servidor autenticadas
  (`getMyCompanyProfile`, `upsertCompanyProfile`, `checkCompanySlugAvailable`), usadas
  pela tela `/empresa`.
- `src/components/portal/client-account-panel.tsx` — login por telefone (OTP) + painel
  "Meus agendamentos", extraído da versão anterior de `l.$slug.tsx` (que era o link de
  agendamento de uma profissional individual, via `public_professionals.booking_slug`).
  Recebe `ownerId` em vez de um registro de profissional, porque o `owner_id` da empresa
  e o `owner_id` de qualquer profissional dela são o mesmo valor — nenhuma lógica interna
  mudou. **Ainda não está montado em nenhuma tela** — ver dependências abaixo.

### Dependências para a próxima PR (agendamento)

1. Montar `ClientAccountPanel` na Landing, decidindo em que ponto do fluxo o login
   acontece (antes ou depois de escolher serviço/profissional/horário).
2. Implementar a escolha de serviço → profissional → horário. `team_members.booking_slug`
   e a view `public_professionals` continuam existindo e não foram alterados nesta PR —
   candidatos naturais para pré-selecionar uma profissional via querystring
   (`/l/:slug?pro=booking_slug`), mas essa integração ainda não existe.
3. Implementar o motor de leitura real de `ServicesSection` e `ProfessionalsSection`
   (hoje são apenas Smart States).
4. `Button` "Agendar Agora" do Hero passa a abrir o fluxo real em vez do toast.

## `/empresa` (autenticada) — fonte dos dados da Landing

A partir desta PR, a seção "Portal Público" de `/empresa` lê e grava direto em
`company_profiles` (não mais `localStorage`). Os demais campos da tela (razão social,
CNPJ, IM/IE, fuso horário, idioma, moeda, formatos de data/hora) continuam em
`localStorage` — são configurações internas, não fazem parte do perfil público.

Quem já tinha preenchido dados da empresa em `localStorage` antes desta PR vê um botão
"Importar dados salvos deste navegador" na seção Portal Público, que copia esses valores
para o formulário (sem apagar o `localStorage`, sem gravar nada até clicar em Salvar).

## Link de agendamento exibido em Meu Espaço / Equipe

`meu-espaco.tsx` e `equipe.$id.tsx` mostravam, antes desta PR, um link por
`booking_slug` da profissional (`/l/{booking_slug}`). Como `/l/:slug` agora representa a
empresa, as duas telas foram atualizadas para buscar o `slug` da empresa via
`fetchCompanySlugByOwnerId` (view `public_company_profiles`, funciona mesmo para uma
colaboradora sem acesso direto a `company_profiles`) e exibir `/l/{slug da empresa}`.
