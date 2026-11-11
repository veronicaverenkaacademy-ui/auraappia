# FASE K2 — Preparação do visual novo do portal (K2a)

Documento de apoio da K2a (mapa do modelo + plano da K2b). Nenhum código de
tela mudou nesta fase — só banco (migração preparada, **não aplicada**) e
camada de dados (TypeScript, testada, **não usada** por nenhuma tela ainda).

> **Nota sobre a imagem de referência**: esta sessão não recebeu nenhum
> arquivo de imagem anexado — só a descrição em texto, bem detalhada, que a
> dona escreveu no pedido (lista de elementos da HOME e da tela
> AGENDAR–Passo 1). O mapa abaixo foi feito a partir dessa descrição. Se a
> imagem real tiver algum detalhe que o texto não cobriu, isso só vai
> aparecer quando ela for anexada de verdade numa sessão futura.

## Parte 1 — Mapa do modelo → dado hoje → o que falta

### HOME

| Elemento do modelo | De onde vem hoje | O que falta |
|---|---|---|
| Logo largo no topo | **Não existe.** Hoje só existem `logo_path`/`logo_light_path` (quadrados, `portal_configurations`) e o `company_profiles.logo_url` antigo (também tratado como quadrado/avatar). | Precisa de um tipo de imagem novo ("logo largo") — decisão a tomar (ver seção 6). |
| Botão de menu (hambúrguer) | Não existe (não há menu lateral no portal hoje). | É só UI/navegação (K2b) — não depende de dado novo. |
| Capa/hero **vertical (4:5)** com título e subtítulo sobre a foto | `cover_path` (imagem), `cover_title`/`cover_subtitle` (texto) já existem em `portal_configurations` e já voltam em `portal_obter_publico()`. Hoje a capa é renderizada **horizontal** (`l.$slug.tsx`, `Hero`, `h-48 md:h-64 w-full`), sem usar `cover_title`/`cover_subtitle` (usa `company.display_name`/`description` em texto puro). | O dado já existe — é troca de proporção/layout (K2b), não de schema. |
| Cartão com 4 atalhos (Agendar, Meus Agendamentos, Benefícios, Ajuda) | Não existe nenhum desses hoje como seção. "Agendar" e "Meus Agendamentos" já têm destino (abrir o `BookingFlow`/`ClientAccountPanel`); "Benefícios" e "Ajuda" não têm nada por trás ainda. | Navegação/UI (K2b) — "Benefícios" fica **escondido** por decisão já tomada nesta fase (ver Parte 4). "Ajuda" precisa de um destino a decidir (ver seção 6). |
| Botão grande "Agendar agora" | Já existe (`Hero`, botão "Agendar Agora"). | Nada — só reestilizar. |
| Faixa de destaque (ícone + frase + imagem de fundo) | `banner_path`/`banner_text`/`show_banner` já existem em `portal_configurations` — a própria tela de edição já avisa "preparado para a próxima fase" nesse campo. Nunca renderizado em `l.$slug.tsx` hoje. | O dado já existe — só falta ligar ao render (K2b), exatamente como o texto já anunciava. |
| "Nossos Serviços" (título + seta) com tiles de categoria/serviço com foto | Hoje é uma lista simples de linhas (nome + duração + preço), sem foto, sem categoria (`ServicesSection`, `l.$slug.tsx`). `services.description`/`price`/`duration_min` já existem e já são públicos (`public_services`). `services.image_path`/`category_id` **existem no banco, mas não são expostos na view pública** — é exatamente o que a migração desta fase (não aplicada) resolve. | Migração (Parte 2, não aplicada) + troca de layout pra tiles (K2b). |
| Cartão "Importante" (aviso/política) | `important_title`/`important_text`/`show_important` já existem em `portal_configurations` e voltam em `portal_obter_publico()` — mesma situação do banner: a tela de edição já avisa "preparado para a próxima fase", nunca renderizado em `l.$slug.tsx`. | O dado já existe — só falta ligar ao render (K2b). |
| Rodapé fixo: nome do estúdio, cidade, WhatsApp, Instagram | `display_name`, `city`, `state`, `whatsapp`, `instagram` já existem em `company_profiles` **e já são públicos** (view `public_company_profiles`). Hoje aparecem, mas num rodapé que rola com a página, não fixo, e numa seção "Redes sociais" separada (não junto do rodapé). | O dado já existe — é só reposicionar/juntar no layout (K2b), não precisa de nada novo no banco. |

### AGENDAR — Passo 1

| Elemento do modelo | De onde vem hoje | O que falta |
|---|---|---|
| Cabeçalho (logo, voltar, fechar) | Botão fechar já existe (`BookingFlow`, `X`). Logo: mesma situação do logo largo da Home — não existe ainda. "Voltar" não existe no passo 1 (é o primeiro passo). | Logo largo (mesma decisão da Home). |
| Indicador de 3 passos (Serviço, Agenda, Confirmação) | Hoje o fluxo tem 6 estados internos (`service`→`professional`→`slot`→`auth`→`confirm`→`done`), sem indicador visual de progresso. | Só UI (K2b) — os 3 passos do modelo agrupam os 6 estados internos (ex.: "Agenda" cobre profissional+horário); não muda a lógica de agendamento. |
| Título e subtítulo | Não existe texto configurável específico pra essa tela hoje. | Hardcoded na tela (K2b) — ex.: "Escolha seu procedimento" (já definido na Parte 4), não precisa de campo novo no banco. |
| Busca | Não existe hoje (a lista de serviços não tem busca). | Só UI/filtro client-side (K2b) sobre a lista já carregada — não precisa de dado novo. |
| Chips de categoria ("Todos" + categorias existentes) | `portal_service_categories` já existe (nome, ordem, foto) — **sem view pública hoje** (só a dona lê, autenticada). É o segundo ponto que a migração desta fase resolve. | Migração (Parte 2, não aplicada). |
| Cartões de serviço: foto, nome, duração, preço, descrição, botão "Selecionar" | nome/duração/preço/descrição já públicos (`public_services`); foto = `services.image_path`, não exposto ainda (mesmo ponto do item anterior). | Migração (Parte 2, não aplicada) + troca de layout pra cartões com foto (K2b). |
| Barra inferior: contador, total, "Avançar" | Não existe hoje (o fluxo atual já avança sozinho ao escolher o serviço, sem contador/total visíveis nesse passo). | Só UI (K2b) — computado a partir do(s) serviço(s) escolhido(s), sem dado novo; nesta etapa é sempre 1 serviço (ver Parte 4). |

### Confirmado especificamente (perguntas do pedido)

- **Descrição do serviço**: existe (`services.description`) e **já é pública** hoje (`public_services.description`, desde a criação da view).
- **Preço e duração**: existem e já são públicos (`price`, `duration_min`).
- **Foto do serviço** (`services.image_path`): existe no banco, **não é pública ainda** — é o que esta fase prepara (não aplica).
- **Categoria** (`services.category_id` + `portal_service_categories`): existe no banco, **não é pública ainda** — mesma situação da foto.
- **Cidade/endereço, WhatsApp, Instagram públicos**: `company_profiles.city/state/address/whatsapp/instagram`, já expostos via `public_company_profiles` — nada a fazer no banco.
- **Textos do portal** (título/subtítulo da capa, aviso "Importante", frase da faixa): todos já existem em `portal_configurations` (`cover_title`, `cover_subtitle`, `important_title`, `important_text`, `banner_text`) e já voltam em `portal_obter_publico()` — só não são renderizados em `l.$slug.tsx` hoje. Nenhum texto do modelo ficou sem campo correspondente.

## Parte 4 — Plano da K2b (documento, sem código)

Ordem sugerida dos componentes e como cada um lê a configuração publicada:

1. **`PortalThemeProvider`** (escopo, não um componente visual) — aplica as
   variáveis CSS (`--portal-color-primary`, `--portal-color-secondary`,
   `--portal-color-button`, `--portal-color-button-text`,
   `--portal-color-text`, `--portal-color-background`, `--portal-font`) num
   `<div>` contêiner que envolve só o portal — nunca em `:root`/`body` (mesmo
   cuidado já provado em `portal-preview-isolation-guard.test.ts`, K1b-A).
   Fontes via `@fontsource` (já instaladas em K1b-A: Playfair Display,
   Poppins, Inter) — nenhuma requisição externa nova.
2. **`PortalHeader`** — logo largo (`logo_path`, kind novo a decidir) ou nome
   em texto se não houver; botão de menu.
3. **`PortalHero`** — capa vertical 4:5 (`cover_path`); `cover_title`/
   `cover_subtitle` sobre a foto, com camada escura/degradê por baixo do
   texto (contraste ≥ 4,5:1, igual ao que `portal-colors.ts` já calcula hoje
   pra Cores — reaproveitar `contrastRatio`/`autoFixTextContrast`).
4. **`PortalShortcuts`** — 4 atalhos; "Benefícios" escondido (ver abaixo).
5. **`PortalBanner`** — `banner_path`/`banner_text`, só se `show_banner`.
6. **`PortalServicesSection`** — chips de categoria
   (`public_portal_categories`, escondidos se a lista vier vazia) + tiles de
   serviço (`public_services.image_path`/`description`/`price`/
   `duration_min`), usando `groupServicesByCategory`/`categoryChipLabels` de
   `portal-public-services.ts` (já prontos e testados nesta fase).
7. **`PortalImportantCard`** — `important_title`/`important_text`, só se
   `show_important`.
8. **`PortalFooter`** (fixo) — `display_name`, `city`/`state`, WhatsApp,
   Instagram; ícone de cada rede some se o campo for vazio.

### Comportamentos de contorno (fallback)

- Sem capa → fundo em degradê com `color_primary`/`color_secondary` do tema.
- Sem logo → nome do estúdio em texto (mesmo padrão que `AvatarFallback` já
  usa hoje pras iniciais).
- Sem foto de serviço → placeholder elegante (ícone/monograma, não uma caixa
  cinza vazia).
- Sem categorias → esconde os chips (não mostra "Todos" sozinho) — já é o
  que `categoryChipLabels` faz quando não há nenhuma categoria com serviço.
- Sem Instagram/WhatsApp → esconde o ícone daquela rede especificamente
  (mesmo padrão que `SocialSection` já faz hoje).
- "Benefícios": **escondido** por decisão desta fase — sem destino definido
  ainda, não é renderizado, nem como item desabilitado.

### Regras transversais

- Texto sobre foto sempre numa camada com contraste garantido (≥ 4,5:1),
  nunca direto sobre a imagem.
- Alvos de toque ≥ 44px (botões, chips, "Selecionar").
- Área segura do iPhone (notch no topo, barra inferior) — mesmo cuidado já
  aplicado em `empresa.tsx`/`personalizar-portal.tsx` (H-BIS/K1b):
  `env(safe-area-inset-bottom)`.
- Sem rolagem horizontal em 320px e 390px de largura.
- Barra inferior fixa nunca cobre conteúdo (mesmo padrão de
  `personalizar-portal.tsx`: respiro = altura da barra + área segura).

### Agendamento (sem mudar cálculo de horário nem reserva)

- Nesta etapa, **um serviço por agendamento** — o botão "Selecionar" escolhe
  um serviço só (troca a seleção anterior, não acumula).
- Texto do cartão: **"Escolha seu procedimento"** (em vez de algo que sugira
  múltipla escolha).
- Contador mostra **"1 serviço selecionado"** (nunca plural) + o preço desse
  serviço como total.
- Nenhuma função de disponibilidade/reserva/cancelamento/remarcação é
  tocada — o passo "Agenda" (horário) e "Confirmação" continuam chamando
  exatamente as mesmas funções de hoje (`createClientAppointment` etc.),
  só a tela por cima muda.

### Riscos

- Logo largo e destino de "Ajuda" são decisões pendentes (ver seção 6 da
  conversa) — sem elas, a K2b não tem como desenhar esses 2 pontos.
- Texto legível sobre foto depende de a dona escolher uma foto de capa
  muito clara ou muito escura — o degradê ajuda, mas não resolve 100% dos
  casos extremos; vale medir contraste real na foto, não só confiar no
  degradê (ponto a aprofundar na K2b).
- Categorias/fotos de serviço são opcionais — uma empresa que não preencher
  nada continua vendo a lista simples de hoje (sem tiles "vazios").

### NÃO VERIFICADO

- Visual real em iPhone (qualquer iPhone) — esta sessão não tem como abrir
  um app nativo nem simular o Safari real do iOS.
- Contraste real calculado sobre uma foto de capa de verdade (só a conta
  matemática entre cor de texto e cor de fundo foi provada em código, nunca
  sobre pixels de uma imagem).
- Como o indicador de 3 passos deve se comportar ao voltar (ex.: da "Agenda"
  pro "Serviço") — não especificado pelo modelo, decisão de K2b.
