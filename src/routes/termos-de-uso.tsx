import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/termos-de-uso")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — AURA" },
      { name: "description", content: "Termos de Uso da plataforma AURA." },
    ],
  }),
  component: TermosDeUso,
});

const intro: string[] = [];

const sections: { title: string; paragraphs: string[] }[] = [
  {
    title: "1. Quem somos e o que oferecemos.",
    paragraphs: [
      'O AURA é um aplicativo de agenda e gestão para profissionais de estética e beleza, oferecido por Veronica Lashes, CNPJ 40.605.681/0001-36, com sede na Rua Santa Catarina, 2278, bairro Floresta, CEP 89212-212, Joinville/SC ("AURA"). Ao criar uma conta, a profissional ("Profissional") declara ter lido e aceitar estes Termos e a Política de Privacidade.',
    ],
  },
  {
    title: "2. Conta e acesso.",
    paragraphs: [
      "A Profissional deve ter 18 anos ou mais e informar dados verdadeiros. A conta é pessoal. A Profissional é responsável por manter seu acesso seguro e pelo que a equipe cadastrada por ela fizer dentro do app, conforme as permissões que ela mesma definir.",
    ],
  },
  {
    title: "3. Papéis sobre os dados das clientes.",
    paragraphs: [
      "A Profissional é a controladora dos dados pessoais das suas clientes inseridos no app (cadastro, agenda, ficha de anamnese, fotos). O AURA atua como operador desses dados, tratando-os somente para prestar o serviço e conforme as instruções da Profissional. A Profissional se compromete a (a) coletar das clientes apenas os dados necessários, (b) obter e registrar os consentimentos exigidos por lei, em especial para dados de saúde, uso de imagem e mensagens de marketing, (c) atender os pedidos das clientes sobre seus dados e (d) responder pelo uso que fizer de fotos e fichas, inclusive em divulgação.",
    ],
  },
  {
    title: "4. Consentimentos dentro do app.",
    paragraphs: [
      "O AURA oferece um registro de consentimentos da cliente (aceite, data, hora, versão do texto, IP e dispositivo). Esse registro é uma ferramenta de apoio e não substitui a responsabilidade da Profissional de explicar à cliente o que está sendo coletado. O app avisa quando uma cliente não autorizou o uso de imagem, mas não impede o uso das fotos; a decisão e a responsabilidade são da Profissional.",
    ],
  },
  {
    title: "5. Mensagens por WhatsApp em nome da Profissional.",
    paragraphs: [
      "Ao ativar lembretes, a Profissional autoriza o AURA a enviar, em nome do estúdio e pelo número central do AURA, as mensagens de lembrete do agendamento 24 horas e 2 horas antes do horário (a de 24 horas com botões para a cliente confirmar, cancelar ou pedir para reagendar), além de respostas curtas a esses botões e códigos de acesso ao portal. A Profissional declara que a cliente forneceu o número para esse fim. Clientes que pedirem para parar de receber mensagens deixarão de recebê-las daquele estúdio, e a Profissional só poderá reativar o envio se a cliente voltar a querer. O AURA não envia mensagens de marketing sem autorização específica da cliente. As mensagens dependem do WhatsApp (Meta), e o AURA não garante a entrega.",
    ],
  },
  {
    title: "6. Uso permitido.",
    paragraphs: [
      "É proibido usar o app para atividade ilegal, envio de spam, coleta de dados de quem não é cliente, tentativa de acessar dados de outro estúdio ou engenharia reversa.",
    ],
  },
  {
    title: "7. Planos e pagamento.",
    paragraphs: [
      "O AURA é oferecido em planos de assinatura (Essencial, Profissional e Estúdio). Os valores, os recursos e os limites de cada plano, como o número de pessoas na equipe, são exibidos no app e na App Store e podem ser atualizados, sem efeito sobre o período já pago. A assinatura é contratada e paga pela App Store, com cobrança na conta Apple da Profissional. Ela renova automaticamente por períodos iguais, até ser cancelada, e o cancelamento deve ser feito em Ajustes do iPhone > seu nome > Assinaturas, pelo menos 24 horas antes do fim do período atual. Eventual período de teste gratuito, se oferecido, termina ao fim do prazo informado e passa a ser cobrado, salvo cancelamento antes. Cobranças, reembolsos e mudanças de plano seguem as regras da Apple. Se a assinatura acabar, a conta passa a ter acesso limitado, e os dados ficam guardados conforme a Política de Privacidade.",
    ],
  },
  {
    title: "8. Disponibilidade.",
    paragraphs: [
      "O AURA se esforça para manter o serviço disponível, mas pode haver paradas para manutenção ou falhas de terceiros (hospedagem, WhatsApp). O AURA não garante funcionamento ininterrupto.",
    ],
  },
  {
    title: "9. Responsabilidade.",
    paragraphs: [
      "O AURA é uma ferramenta de organização. Não presta serviços de estética ou saúde, não avalia a ficha de anamnese e não responde por procedimentos realizados pela Profissional. A responsabilidade do AURA fica limitada ao valor pago pela Profissional nos 12 meses anteriores ao fato, salvo nos casos em que a lei não permite essa limitação.",
    ],
  },
  {
    title: "10. Cancelamento e exclusão da conta.",
    paragraphs: [
      "A Profissional pode excluir a conta no app a qualquer momento. A exclusão apaga os dados do estúdio e das clientes, salvo o que precisarmos guardar por obrigação legal (veja a Política de Privacidade). A exclusão da conta não cancela a assinatura na Apple; o cancelamento deve ser feito nas Assinaturas do Apple ID. Quem entrou com a conta Apple deve também desconectar o AURA nas configurações do Apple ID. O AURA pode suspender ou encerrar contas que violem estes Termos.",
    ],
  },
  {
    title: "11. Alterações.",
    paragraphs: [
      "Estes Termos têm versão e data. Quando mudarem de forma relevante, avisaremos no app e pediremos novo aceite. A versão aceita fica registrada.",
    ],
  },
  {
    title: "12. Contato, lei e foro.",
    paragraphs: [
      "Dúvidas: veronicaverenkaacademy@gmail.com. Aplica-se a lei brasileira. Fica eleito o foro de Joinville/SC, salvo regra de consumidor que permita outro.",
    ],
  },
];

function TermosDeUso() {
  return (
    <div className="min-h-screen bg-background">
      <header className="p-6 border-b border-border/60">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">AURA</p>
        <h1 className="mt-2 text-3xl font-display">Termos de Uso</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Última atualização: 15 de novembro de 2026.
        </p>

        {intro.length > 0 && (
          <div className="mt-8 space-y-4 text-sm leading-relaxed text-foreground/85">
            {intro.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}

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
