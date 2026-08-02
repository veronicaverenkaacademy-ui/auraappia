import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — AURA" },
      { name: "description", content: "Termos de Uso da plataforma AURA." },
    ],
  }),
  component: TermosDeUso,
});

const intro = [
  "Estes Termos de Uso (\"Termos\") regem a utilização da plataforma AURA (\"Plataforma\", \"Sistema\" ou \"Serviço\"), de titularidade de [Razão Social / Nome do titular do CNPJ], inscrita no CNPJ sob o nº [000.000.000/0000-00] (\"AURA\", \"nós\" ou \"Empresa\"), por pessoas físicas ou jurídicas que utilizem o Serviço na qualidade de assinantes (\"Usuário\", \"Cliente\" ou \"você\").",
  "Ao criar uma conta, acessar ou utilizar a Plataforma, você declara que leu, compreendeu e concorda integralmente com estes Termos e com a nossa Política de Privacidade, que é parte integrante deste documento. Caso não concorde com qualquer disposição aqui prevista, você não deverá utilizar a Plataforma.",
];

const sections: { title: string; paragraphs: string[] }[] = [
  {
    title: "1. Definições",
    paragraphs: [
      "Plataforma AURA: sistema de gestão em nuvem (SaaS) destinado a profissionais e empresas do setor de beleza, incluindo, mas não se limitando a, agenda, CRM, financeiro, estoque, marketing, inteligência artificial, portal da cliente e business intelligence.",
      "Assinante: pessoa física ou jurídica que contrata um dos Planos da Plataforma e é responsável pelo pagamento e pela conta principal.",
      "Usuário Colaborador: pessoa cadastrada pelo Assinante para operar a Plataforma sob permissões definidas por ele (ex.: recepcionista, profissional, financeiro).",
      "Cliente Final: pessoa atendida pelo Assinante, cujos dados são inseridos ou coletados na Plataforma (ex.: por meio do CRM ou do Portal da Cliente).",
      "Portal da Cliente: ambiente web/PWA disponibilizado pelo Assinante aos seus próprios clientes finais para agendamento, consulta e acompanhamento de atendimentos.",
      "Aura IA: conjunto de funcionalidades de inteligência artificial integradas à Plataforma, destinadas a gerar análises, sugestões, automações e insights.",
    ],
  },
  {
    title: "2. Objeto",
    paragraphs: [
      "A AURA disponibiliza, por meio de assinatura mensal recorrente, o acesso a uma plataforma de gestão empresarial para negócios de beleza, incluindo módulos de agenda, cadastro e relacionamento com clientes (CRM), controle financeiro, gestão de estoque, motor de protocolos, automações de marketing, inteligência artificial, portal para clientes finais, relatórios e business intelligence, entre outras funcionalidades descritas na página oficial da Plataforma, cuja disponibilidade pode variar conforme o Plano contratado.",
      "A Plataforma é fornecida no modelo \"como está\" (as is) e \"conforme disponibilidade\" (as available), podendo ser atualizada, modificada ou ter funcionalidades adicionadas, alteradas ou descontinuadas a qualquer momento, mediante comunicação prévia razoável quando a alteração impactar materialmente o uso já contratado.",
    ],
  },
  {
    title: "3. Cadastro e Conta",
    paragraphs: [
      "Para utilizar a Plataforma, o Usuário deverá realizar cadastro, fornecendo informações verdadeiras, completas e atualizadas. O Usuário é o único responsável pela veracidade dos dados informados e por manter a confidencialidade de suas credenciais de acesso (login e senha, ou métodos alternativos de autenticação, como código via WhatsApp, SMS, magic link, Apple ou Google).",
      "O Assinante é integralmente responsável por todas as ações realizadas em sua conta, inclusive as praticadas por Usuários Colaboradores cadastrados por ele, e deverá configurar adequadamente as permissões de acesso de cada colaborador conforme os recursos disponíveis na Plataforma.",
      "A AURA poderá suspender ou encerrar contas que apresentem indícios de fraude, uso indevido, compartilhamento não autorizado de credenciais ou violação destes Termos, mediante notificação ao Usuário, ressalvados os casos de urgência que exijam suspensão imediata.",
    ],
  },
  {
    title: "4. Planos, Funcionalidades e Assinatura",
    paragraphs: [
      "A Plataforma é oferecida em diferentes Planos, com valores, limites de uso e funcionalidades distintos, conforme descrito na página de preços oficial da AURA no momento da contratação. A AURA poderá criar, alterar, renomear ou descontinuar Planos, observado o disposto na cláusula 4.4.",
      "O Usuário poderá alterar de Plano (upgrade ou downgrade) a qualquer momento, sendo que a mudança de valores e de funcionalidades disponíveis passará a valer a partir do próximo ciclo de cobrança, salvo disposição diversa informada no momento da alteração.",
      "Funcionalidades específicas de determinados Planos (por exemplo, recursos avançados de Inteligência Artificial, Business Intelligence, múltiplos usuários ou integrações) somente estarão disponíveis mediante contratação do Plano correspondente.",
      "Eventuais reajustes de valores serão comunicados ao Assinante com antecedência mínima de 30 (trinta) dias, aplicando-se a partir do ciclo de cobrança subsequente à comunicação. A continuidade do uso da Plataforma após esse prazo implica concordância com o novo valor.",
    ],
  },
  {
    title: "5. Pagamento e Cobrança Recorrente",
    paragraphs: [
      "A assinatura da Plataforma é cobrada de forma recorrente (mensal, ou conforme periodicidade contratada), por meio de cartão de crédito, Pix recorrente ou outro meio de pagamento disponibilizado pela AURA através de processadores de pagamento terceirizados.",
      "Ao fornecer os dados de pagamento, o Usuário autoriza a AURA e/ou seu processador de pagamentos a realizar cobranças automáticas e recorrentes no valor correspondente ao Plano contratado, até que a assinatura seja cancelada nos termos da cláusula 6.",
      "O não pagamento na data de vencimento poderá acarretar a suspensão do acesso à Plataforma após o período de tolerância informado no momento da contratação, sem prejuízo da cobrança dos valores em aberto.",
      "A AURA não armazena diretamente os dados completos de cartão de crédito, que são processados por gateways de pagamento certificados e em conformidade com os padrões de segurança do setor (PCI-DSS).",
    ],
  },
  {
    title: "6. Cancelamento, Reembolso e Período de Teste",
    paragraphs: [
      "O Usuário poderá cancelar sua assinatura a qualquer momento diretamente pela Plataforma, na área de Configurações > Assinatura, ou por meio dos canais de suporte oficiais. O cancelamento produz efeitos ao final do ciclo de cobrança vigente, sendo mantido o acesso à Plataforma até essa data, sem cobranças adicionais para os ciclos seguintes.",
      "Salvo quando expressamente previsto em oferta específica ou exigido pela legislação aplicável (incluindo o direito de arrependimento previsto no artigo 49 do Código de Defesa do Consumidor, para contratações realizadas fora do estabelecimento comercial, no prazo de 7 dias), os valores já pagos não são reembolsáveis.",
      "Caso a AURA ofereça período de teste gratuito (trial), este será claramente informado no momento da contratação, junto das condições para conversão em assinatura paga e da possibilidade de cancelamento antes da cobrança.",
    ],
  },
  {
    title: "7. Obrigações e Uso Adequado da Plataforma",
    paragraphs: [
      "O Usuário compromete-se a utilizar a Plataforma exclusivamente para finalidades lícitas, relacionadas à gestão de seu próprio negócio, sendo vedado, entre outras condutas: utilizar a Plataforma para armazenar, transmitir ou processar dados obtidos de forma ilícita ou sem o devido consentimento dos titulares; realizar engenharia reversa, copiar, reproduzir ou explorar comercialmente o código-fonte, design ou funcionalidades da Plataforma sem autorização expressa da AURA; utilizar a Plataforma, incluindo os módulos de automação de marketing e comunicação (WhatsApp, SMS, e-mail), para envio de mensagens não solicitadas, spam ou conteúdo que viole a legislação aplicável, os termos das plataformas de mensageria integradas ou os direitos de terceiros; tentar acessar áreas restritas do sistema, contas de outros Usuários ou dados de outros Assinantes sem autorização; utilizar a Plataforma de forma que sobrecarregue, comprometa a estabilidade ou a segurança da infraestrutura da AURA.",
      "O Assinante é o único responsável por obter, junto aos seus Clientes Finais e Usuários Colaboradores, todos os consentimentos e bases legais necessários para o tratamento de dados pessoais inseridos na Plataforma (incluindo dados sensíveis, como informações de saúde constantes em fichas de anamnese, fotos e assinaturas digitais), figurando a AURA, nessa relação, como operadora de dados pessoais, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).",
    ],
  },
  {
    title: "8. Dados Pessoais e Privacidade",
    paragraphs: [
      "O tratamento de dados pessoais realizado pela AURA está detalhado em Política de Privacidade específica, parte integrante destes Termos, que descreve, entre outros pontos: quais dados são coletados; as finalidades do tratamento; os prazos de retenção; as medidas de segurança adotadas; os direitos dos titulares de dados; e os procedimentos para exercício desses direitos.",
      "Em relação aos dados de Clientes Finais inseridos pelo Assinante na Plataforma (ex.: fichas de anamnese, fotos de evolução, documentos assinados digitalmente), a AURA atua como operadora, tratando os dados exclusivamente conforme as instruções do Assinante (controlador), para viabilizar as funcionalidades contratadas, sendo vedado o uso desses dados para finalidades distintas sem base legal apropriada.",
      "A AURA adota medidas técnicas e administrativas de segurança da informação, incluindo criptografia de dados sensíveis, controle de acesso baseado em permissões, autenticação multifator (quando habilitada), backups periódicos e registro de auditoria (logs), de modo a proteger os dados armazenados na Plataforma contra acessos não autorizados, incidentes de segurança e uso indevido.",
    ],
  },
  {
    title: "9. Inteligência Artificial (Aura IA)",
    paragraphs: [
      "A Plataforma disponibiliza funcionalidades de inteligência artificial (\"Aura IA\") que analisam dados operacionais do negócio do Assinante para gerar insights, sugestões, previsões, respostas conversacionais e, quando configurado pelo Assinante, automações.",
      "As saídas geradas pela Aura IA (incluindo previsões financeiras, sugestões de precificação, recomendações estratégicas e simulações de cenários) têm caráter informativo e consultivo, não constituindo aconselhamento financeiro, contábil, jurídico ou de qualquer natureza profissional regulamentada, sendo de responsabilidade exclusiva do Assinante avaliar e decidir sobre sua aplicação.",
      "Ações classificadas como críticas (ex.: envio de campanhas em massa, execução de cobranças, alterações financeiras relevantes) somente serão executadas pela Aura IA mediante confirmação expressa do Usuário, conforme o nível de autonomia configurado nas Configurações da Plataforma.",
      "O Assinante poderá configurar o nível de autonomia da Aura IA (apenas responder; responder e sugerir; executar mediante aprovação; executar automaticamente) e restringir os módulos aos quais a IA tem acesso, nos termos disponibilizados na área de Configurações.",
    ],
  },
  {
    title: "10. Portal da Cliente e Relação com Clientes Finais",
    paragraphs: [
      "O Portal da Cliente é disponibilizado pelo Assinante aos seus próprios Clientes Finais para agendamento, consulta de histórico e demais funcionalidades. A relação comercial estabelecida por meio do Portal da Cliente (agendamentos, pagamentos, cancelamentos, políticas de reagendamento) é de responsabilidade exclusiva do Assinante, não figurando a AURA como parte nessa relação, mas apenas como fornecedora da infraestrutura tecnológica.",
      "Cabe ao Assinante definir e comunicar aos seus Clientes Finais suas próprias políticas de cancelamento, reagendamento, cobrança de sinal e demais condições comerciais aplicáveis aos atendimentos agendados pelo Portal.",
    ],
  },
  {
    title: "11. Propriedade Intelectual",
    paragraphs: [
      "Todos os direitos de propriedade intelectual sobre a Plataforma AURA, incluindo, sem limitação, código-fonte, design, marca, layout, funcionalidades, documentação e conteúdos disponibilizados pela AURA, pertencem exclusivamente à AURA ou a seus licenciantes, sendo vedada qualquer forma de reprodução, distribuição ou exploração não autorizada.",
      "Os dados inseridos pelo Assinante na Plataforma (informações de clientes, histórico de atendimentos, dados financeiros, fotos, entre outros) permanecem de titularidade do Assinante e/ou dos respectivos titulares de dados, cabendo à AURA seu tratamento apenas para viabilizar o Serviço contratado, nos termos da Política de Privacidade.",
    ],
  },
  {
    title: "12. Disponibilidade, Suporte e Backups",
    paragraphs: [
      "A AURA envidará esforços comercialmente razoáveis para manter a Plataforma disponível de forma contínua, podendo, contudo, realizar interrupções programadas para manutenção, mediante aviso prévio quando possível, bem como interrupções não programadas decorrentes de caso fortuito, força maior ou fatores alheios ao seu controle (ex.: falhas de provedores de infraestrutura em nuvem ou de serviços de terceiros integrados, como WhatsApp Business, gateways de pagamento e provedores de IA).",
      "A AURA realiza rotinas de backup dos dados armazenados na Plataforma, conforme política de retenção informada na área de Configurações, sem prejuízo de recomendar ao Assinante a realização de exportações periódicas de seus próprios dados.",
    ],
  },
  {
    title: "13. Limitação de Responsabilidade",
    paragraphs: [
      "Na máxima extensão permitida pela legislação aplicável, a AURA não será responsável por: (i) danos indiretos, lucros cessantes ou perda de dados decorrentes de uso inadequado da Plataforma pelo Usuário; (ii) decisões de negócio tomadas com base em insights, projeções ou sugestões geradas pela Aura IA; (iii) indisponibilidades decorrentes de serviços de terceiros integrados à Plataforma (WhatsApp Business, gateways de pagamento, provedores de IA, serviços de nuvem); e (iv) conteúdo inserido pelo próprio Assinante ou por seus Usuários Colaboradores e Clientes Finais.",
      "Nada nestes Termos exclui ou limita responsabilidades que não possam ser legalmente excluídas ou limitadas, incluindo aquelas decorrentes de dolo, culpa grave ou de violação de direitos assegurados pelo Código de Defesa do Consumidor e pela LGPD.",
    ],
  },
  {
    title: "14. Rescisão",
    paragraphs: [
      "A AURA poderá suspender ou encerrar o acesso do Usuário à Plataforma, mediante notificação prévia, em caso de descumprimento destes Termos, inadimplência não regularizada após o prazo de tolerância, ou uso que coloque em risco a segurança da Plataforma ou de outros Usuários.",
      "Encerrada a assinatura, por qualquer motivo, o Usuário poderá solicitar a exportação de seus dados dentro do prazo informado na Política de Privacidade, findo o qual os dados poderão ser eliminados ou anonimizados, ressalvadas as hipóteses de guarda obrigatória por determinação legal.",
    ],
  },
  {
    title: "15. Alterações destes Termos",
    paragraphs: [
      "A AURA poderá alterar estes Termos a qualquer momento, para refletir mudanças na Plataforma, na legislação aplicável ou em suas práticas de negócio. Alterações materiais serão comunicadas aos Usuários com antecedência razoável, por e-mail, WhatsApp e/ou aviso na própria Plataforma. O uso continuado da Plataforma após a entrada em vigor das alterações constitui aceitação dos novos Termos.",
    ],
  },
  {
    title: "16. Legislação Aplicável e Foro",
    paragraphs: [
      "Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de [cidade/UF do Assinante da Plataforma], com renúncia expressa a qualquer outro, por mais privilegiado que seja, para dirimir eventuais controvérsias decorrentes destes Termos, ressalvada a competência dos Juizados Especiais e a proteção conferida ao consumidor pela legislação aplicável.",
    ],
  },
  {
    title: "17. Disposições Gerais",
    paragraphs: [
      "Caso qualquer disposição destes Termos seja considerada inválida ou inexequível, as demais disposições permanecerão em pleno vigor e efeito. A tolerância da AURA quanto ao eventual descumprimento de qualquer disposição destes Termos não constituirá renúncia ao direito de exigir o cumprimento das demais disposições.",
      "Dúvidas, solicitações ou reclamações relacionadas a estes Termos poderão ser encaminhadas para o canal de suporte oficial da AURA: [e-mail de suporte] ou [WhatsApp/telefone de suporte].",
    ],
  },
];

function TermosDeUso() {
  return (
    <div className="min-h-screen bg-background">
      <header className="p-6 border-b border-border/60">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-8 rounded-xl border border-dashed border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-800 dark:text-amber-400">
          <strong>Rascunho.</strong> Este documento ainda tem campos entre colchetes não preenchidos
          (razão social, CNPJ, cidade/UF do foro, e-mail de suporte). Ele serve como ponto de partida
          e não substitui revisão por um advogado especializado em Direito Digital e Proteção de
          Dados antes de ser considerado definitivo.
        </div>

        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">AURA</p>
        <h1 className="mt-2 text-3xl font-display">Termos de Uso</h1>
        <p className="mt-1 text-sm text-muted-foreground">Última atualização: [inserir data]</p>

        <div className="mt-8 space-y-4 text-sm leading-relaxed text-foreground/85">
          {intro.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <div className="mt-10 space-y-10">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="text-lg font-display">{s.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/85">
                {s.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
