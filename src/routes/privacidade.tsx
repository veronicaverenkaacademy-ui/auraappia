import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — AURA" },
      { name: "description", content: "Política de Privacidade da plataforma AURA." },
    ],
  }),
  component: PoliticaDePrivacidade,
});

const intro = [
  "Esta Política de Privacidade descreve como [Razão Social / Nome do titular do CNPJ], inscrita no CNPJ sob o nº [000.000.000/0000-00] (\"AURA\", \"nós\"), coleta, utiliza, armazena, compartilha e protege dados pessoais no âmbito da plataforma AURA (\"Plataforma\"), em conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais — LGPD) e demais normas aplicáveis.",
  "Esta Política é parte integrante dos Termos de Uso da Plataforma e aplica-se a todos os dados tratados por meio dela: os dados do Assinante e de seus Usuários Colaboradores, e os dados dos Clientes Finais inseridos pelo Assinante para operar seu negócio.",
];

const sections: { title: string; paragraphs: string[] }[] = [
  {
    title: "1. Papéis: Controlador e Operador",
    paragraphs: [
      "Para fins de LGPD, é importante distinguir dois papéis distintos dentro da Plataforma.",
      "Em relação aos dados do Assinante e dos Usuários Colaboradores (cadastro, dados de cobrança, dados de acesso e uso da Plataforma), a AURA atua como Controladora, definindo as finalidades e os meios do tratamento.",
      "Em relação aos dados dos Clientes Finais inseridos pelo Assinante (ex.: nome, telefone, fotos, ficha de anamnese, histórico de atendimentos, dados coletados via Portal da Cliente), o Assinante é o Controlador, e a AURA atua como Operadora, tratando esses dados exclusivamente conforme as instruções e finalidades definidas pelo próprio Assinante para a prestação de seus serviços de beleza.",
      "Isso significa que, caso um Cliente Final deseje exercer direitos sobre seus dados (acesso, correção, exclusão), a solicitação deve ser dirigida, em primeiro lugar, ao Assinante (o estúdio/profissional responsável pelo atendimento), que poderá utilizar as ferramentas da Plataforma para atendê-la. A AURA também disponibiliza canais de suporte para apoiar esse processo quando necessário.",
    ],
  },
  {
    title: "2. Quais Dados Coletamos",
    paragraphs: [
      "2.1 Dados do Assinante e Usuários Colaboradores — dados de identificação (nome completo, CPF ou CNPJ, e-mail, telefone/WhatsApp, endereço, foto de perfil); dados de conta (login, senha criptografada, histórico de acesso, dispositivo e sessões ativas); dados de cobrança (processados por gateways terceirizados — a AURA não armazena números completos de cartão); dados de uso (interações com a Plataforma, preferências, registros de auditoria).",
      "2.2 Dados de Clientes Finais (inseridos pelo Assinante) — dados de identificação e contato (nome, telefone, WhatsApp, e-mail, Instagram, cidade, data de nascimento); dados de atendimento (histórico de serviços, valores, formas de pagamento, observações, preferências); dados sensíveis de saúde (fichas de anamnese: alergias, contraindicações, medicamentos, gestação, condições de saúde relevantes ao procedimento — tratados com nível reforçado de proteção nos termos do artigo 11 da LGPD); imagens (fotos de antes/depois e evolução, quando autorizadas); documentos e assinaturas digitais (termos de consentimento, contratos e anamneses assinados eletronicamente); dados financeiros do relacionamento (valores pagos, pacotes adquiridos, saldo de pontos de fidelidade, cupons e cashback).",
      "2.3 Dados coletados automaticamente — dados técnicos (endereço IP, tipo de dispositivo, navegador, sistema operacional) e cookies e tecnologias semelhantes, usados para manter sessões ativas, lembrar preferências e, quando aplicável, mensurar desempenho da Plataforma e do Portal da Cliente.",
    ],
  },
  {
    title: "3. Finalidades do Tratamento",
    paragraphs: [
      "Os dados coletados são utilizados para: viabilizar o funcionamento da Plataforma e de suas funcionalidades (agenda, CRM, financeiro, estoque, protocolos, marketing, IA, portal da cliente, relatórios); processar pagamentos e gerenciar a assinatura recorrente; enviar comunicações operacionais (confirmações, lembretes, avisos de pagamento, atualizações de sistema); enviar comunicações de marketing sobre a própria AURA, quando o Usuário tiver consentido, com opção de descadastramento a qualquer momento; viabilizar as automações de relacionamento configuradas pelo Assinante para seus Clientes Finais, sempre sob responsabilidade e configuração do Assinante; alimentar as funcionalidades de Inteligência Artificial (Aura IA); prevenir fraudes, garantir a segurança da Plataforma e cumprir obrigações legais e regulatórias; melhorar a Plataforma por meio de análises agregadas e estatísticas, preferencialmente de forma anonimizada.",
    ],
  },
  {
    title: "4. Base Legal para o Tratamento",
    paragraphs: [
      "O tratamento de dados pessoais pela AURA fundamenta-se nas seguintes bases legais previstas na LGPD, conforme o caso: execução de contrato (art. 7º, V), para viabilizar o cadastro, a prestação do serviço contratado e a cobrança da assinatura; consentimento (art. 7º, I e art. 11, I para dados sensíveis), para envio de comunicações de marketing, uso de fotos em campanhas e tratamento de dados de saúde em fichas de anamnese, sempre coletado pelo Assinante junto ao seu Cliente Final; legítimo interesse (art. 7º, IX), para prevenção a fraudes, segurança da informação e melhoria da Plataforma; cumprimento de obrigação legal ou regulatória (art. 7º, II), para retenção de dados fiscais e contábeis pelo prazo exigido em lei.",
      "Cabe ao Assinante, como Controlador dos dados de seus Clientes Finais, assegurar-se de que possui base legal adequada e, quando exigido, o devido consentimento para o tratamento de dados sensíveis (como os de saúde constantes na anamnese) antes de inseri-los na Plataforma.",
    ],
  },
  {
    title: "5. Compartilhamento de Dados com Terceiros",
    paragraphs: [
      "A AURA poderá compartilhar dados pessoais com os seguintes tipos de terceiros, estritamente na medida necessária para viabilizar a Plataforma: processadores de pagamento (gateways de cartão, Pix); provedores de infraestrutura em nuvem; provedores de comunicação (WhatsApp Business Platform, provedores de SMS e e-mail); provedores de inteligência artificial, sempre sob contratos que estabeleçam obrigações de confidencialidade e proteção de dados; autoridades públicas, quando exigido por lei, ordem judicial ou requisição regulatória.",
      "A AURA não vende dados pessoais a terceiros. Todo compartilhamento com parceiros e fornecedores é regido por contratos que exigem padrões de proteção de dados compatíveis com a LGPD.",
    ],
  },
  {
    title: "6. Transferência Internacional de Dados",
    paragraphs: [
      "Alguns dos fornecedores utilizados pela AURA (incluindo provedores de nuvem e de inteligência artificial) podem processar dados em servidores localizados fora do Brasil. Nesses casos, a AURA adota as salvaguardas exigidas pela LGPD, buscando contratar fornecedores que ofereçam grau de proteção de dados adequado e cláusulas contratuais compatíveis com a legislação brasileira.",
    ],
  },
  {
    title: "7. Armazenamento e Prazo de Retenção",
    paragraphs: [
      "Os dados pessoais são armazenados pelo tempo necessário para cumprir as finalidades descritas nesta Política, observados os seguintes parâmetros gerais: dados de conta e cobrança do Assinante — mantidos durante a vigência da assinatura e pelo prazo adicional exigido pela legislação fiscal e contábil aplicável; dados de Clientes Finais — mantidos enquanto o Assinante mantiver sua conta ativa e conforme a política de retenção configurada por ele nas Configurações da Plataforma (padrão sugerido: 24 meses após o último contato, salvo configuração diversa); logs de auditoria e segurança — mantidos pelo prazo necessário para fins de segurança e cumprimento legal, observados os limites da LGPD.",
      "Após o encerramento da conta, os dados poderão ser mantidos por período adicional limitado para fins de cumprimento de obrigação legal ou exercício regular de direitos, sendo posteriormente eliminados ou anonimizados.",
    ],
  },
  {
    title: "8. Segurança da Informação",
    paragraphs: [
      "A AURA adota medidas técnicas e administrativas para proteger os dados pessoais contra acessos não autorizados e situações de destruição, perda, alteração, comunicação ou difusão indevida, incluindo, entre outras: criptografia de dados sensíveis em trânsito e em repouso; controle de acesso baseado em permissões (RBAC); autenticação segura, incluindo autenticação em dois fatores (2FA), quando habilitada pelo Assinante; registro de auditoria (logs) de ações relevantes; backups periódicos e criptografados; monitoramento de segurança e processos internos de resposta a incidentes.",
      "Nenhum sistema é absolutamente livre de riscos. Em caso de incidente de segurança que possa acarretar risco relevante aos titulares de dados, a AURA notificará os Assinantes afetados e, quando exigido pela LGPD, a Autoridade Nacional de Proteção de Dados (ANPD), em prazo razoável.",
    ],
  },
  {
    title: "9. Direitos dos Titulares de Dados",
    paragraphs: [
      "Nos termos do artigo 18 da LGPD, o titular dos dados pessoais tem direito a solicitar, mediante requisição ao Assinante (Controlador) ou, quando aplicável, diretamente à AURA: confirmação da existência de tratamento; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD; portabilidade dos dados a outro fornecedor de serviço; eliminação dos dados pessoais tratados com base em consentimento, ressalvadas as hipóteses legais de retenção; informação sobre entidades com as quais os dados foram compartilhados; revogação do consentimento, a qualquer momento; revisão de decisões tomadas unicamente com base em tratamento automatizado (incluindo decisões apoiadas pela Aura IA) que afetem os interesses do titular.",
      "Solicitações relacionadas a dados de Clientes Finais devem ser direcionadas prioritariamente ao Assinante responsável pelo atendimento. Solicitações relacionadas aos dados do próprio Assinante e de seus Usuários Colaboradores podem ser feitas diretamente à AURA pelo canal indicado na cláusula 12.",
    ],
  },
  {
    title: "10. Cookies e Tecnologias de Rastreamento",
    paragraphs: [
      "A Plataforma e o Portal da Cliente utilizam cookies e tecnologias semelhantes para manter sessões autenticadas, lembrar preferências de navegação e, quando configurado, mensurar desempenho e origem de acessos. O Usuário pode gerenciar preferências de cookies nas configurações de seu navegador, ciente de que a desativação de determinados cookies pode impactar funcionalidades da Plataforma.",
    ],
  },
  {
    title: "11. Dados de Menores de Idade",
    paragraphs: [
      "A Plataforma não se destina ao cadastro de Assinantes menores de 18 anos. Quando o Assinante atender Clientes Finais menores de idade, o tratamento dos dados desses menores (incluindo fichas de anamnese e imagens) deverá ser realizado pelo Assinante com o consentimento específico e em destaque de ao menos um dos pais ou do responsável legal, nos termos do artigo 14 da LGPD, sendo tal consentimento de responsabilidade do Assinante enquanto Controlador desses dados.",
    ],
  },
  {
    title: "12. Encarregado de Dados (DPO) e Contato",
    paragraphs: [
      "Para exercer seus direitos, tirar dúvidas sobre esta Política ou reportar incidentes relacionados a dados pessoais, entre em contato com nosso Encarregado de Proteção de Dados (DPO): Nome/Empresa responsável: [inserir nome do encarregado ou empresa]; E-mail: [inserir e-mail de privacidade/DPO]; WhatsApp/Telefone: [inserir contato de suporte].",
    ],
  },
  {
    title: "13. Alterações desta Política",
    paragraphs: [
      "Esta Política de Privacidade poderá ser atualizada periodicamente para refletir mudanças na Plataforma, em nossas práticas de tratamento de dados ou na legislação aplicável. Alterações materiais serão comunicadas aos Usuários com antecedência razoável, por e-mail, WhatsApp e/ou aviso na própria Plataforma, com indicação da nova data de \"última atualização\".",
    ],
  },
  {
    title: "14. Legislação Aplicável",
    paragraphs: [
      "Esta Política é regida pela legislação brasileira, em especial pela Lei nº 13.709/2018 (LGPD), pela Lei nº 12.965/2014 (Marco Civil da Internet) e pelo Código de Defesa do Consumidor, no que couber.",
    ],
  },
];

function PoliticaDePrivacidade() {
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
          (razão social, CNPJ, contato do encarregado de dados/DPO). Ele serve como ponto de partida
          e não substitui revisão por um advogado especializado em Direito Digital e Proteção de
          Dados antes de ser considerado definitivo — em especial por envolver dados sensíveis de
          saúde (fichas de anamnese).
        </div>

        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">AURA</p>
        <h1 className="mt-2 text-3xl font-display">Política de Privacidade</h1>
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
