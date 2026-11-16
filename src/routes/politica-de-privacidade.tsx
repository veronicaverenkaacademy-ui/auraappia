import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/politica-de-privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — AURA" },
      { name: "description", content: "Política de Privacidade da plataforma AURA." },
    ],
  }),
  component: PoliticaDePrivacidade,
});

const intro: string[] = [];

type Section = {
  title: string;
  paragraphs?: string[];
  items?: string[];
  table?: { headers: [string, string]; rows: [string, string][] };
  afterItems?: string[];
};

const sections: Section[] = [
  {
    title: "1. Quem trata seus dados.",
    paragraphs: [
      "Se você é cliente de um estúdio que usa o AURA, o estúdio (a Profissional) decide como seus dados são usados, e o AURA os trata em nome dele, como operador. Se você é Profissional, o AURA é o controlador dos dados da sua conta. O AURA é oferecido por Veronica Lashes, CNPJ 40.605.681/0001-36, Rua Santa Catarina, 2278, bairro Floresta, CEP 89212-212, Joinville/SC. Encarregada pelo tratamento de dados: Verônica Verenka Martins, veronicaverenkaacademy@gmail.com.",
    ],
  },
  {
    title: "2. Quais dados coletamos.",
    items: [
      "Cliente: nome, telefone (WhatsApp), data de nascimento, histórico e horários de agendamentos, ficha de anamnese (informações de saúde informadas por você), fotos de antes e depois, preferência de mensagens, respostas aos botões das mensagens e mensagens enviadas ao número central do AURA.",
      "Profissional: nome, e-mail ou identificador da conta Apple, dados do negócio, equipe e permissões, plano contratado.",
      "Registros técnicos: IP, dispositivo e navegador no momento do login ou do consentimento, códigos de verificação enviados, registros de envio de mensagens e de segurança.",
    ],
  },
  {
    title: "3. Para que usamos e em que base legal.",
    table: {
      headers: ["Finalidade", "Base legal"],
      rows: [
        ["Agendar, confirmar, lembrar e remarcar horários", "Execução de contrato (art. 7º, V)"],
        [
          "Login da cliente por código no WhatsApp",
          "Execução de contrato e segurança da conta (art. 7º, V e IX)",
        ],
        ["Ficha de anamnese (dados de saúde)", "Consentimento específico e destacado (art. 11, I)"],
        ["Fotos de antes e depois", "Consentimento, com opções de uso (art. 7º, I)"],
        ["Mensagens de marketing", "Consentimento separado e revogável (art. 7º, I)"],
        [
          "Registro dos consentimentos, segurança e prevenção a fraude",
          "Legítimo interesse e cumprimento de obrigação legal (art. 7º, II e IX)",
        ],
      ],
    },
  },
  {
    title: "4. Mensagens pelo WhatsApp.",
    paragraphs: [
      "Os lembretes do seu horário e os códigos de login são enviados pelo WhatsApp Business, da Meta, a partir de um número central do AURA, usando modelos de mensagem aprovados. Os lembretes são enviados 24 horas e 2 horas antes do horário e mostram seu nome, o serviço, o horário e o nome do estúdio. No lembrete de 24 horas, você pode responder pelos botões (confirmar, cancelar ou reagendar), e sua resposta atualiza a agenda do estúdio; vale a primeira escolha feita. Se você não quiser mais receber lembretes de um estúdio, pode responder PARAR ao número do AURA ou avisar o estúdio. O número do AURA não é canal de conversa: para falar com o estúdio, use o contato dele.",
    ],
  },
  {
    title: "5. Com quem compartilhamos.",
    items: [
      "O estúdio que você frequenta e sua equipe, conforme as permissões dele.",
      "Meta (WhatsApp), para entregar as mensagens.",
      "Provedores de hospedagem, banco de dados e segurança (Lovable Cloud / Supabase e Cloudflare).",
      "Apple, para login, assinatura e distribuição do app.",
      "Autoridades, quando a lei exigir.",
    ],
    afterItems: ["Não vendemos dados pessoais."],
  },
  {
    title: "6. Transferência internacional.",
    paragraphs: [
      "Alguns desses provedores armazenam ou processam dados fora do Brasil. Fazemos essa transferência apenas para prestar o serviço contratado e com as garantias do art. 33 da LGPD, em especial por meio de cláusulas contratuais com os provedores, nos termos aprovados pela ANPD, e, quando necessário para executar o serviço que você solicitou, com base no art. 33, IX. Você pode pedir mais informações ao encarregado.",
    ],
  },
  {
    title: "7. Por quanto tempo guardamos e como excluir.",
    items: [
      "Enquanto a conta do estúdio estiver ativa, os dados das clientes ficam guardados, incluindo a ficha de anamnese e as fotos, sem prazo fixo, até o estúdio atualizá-los ou excluí-los, ou até a cliente pedir a exclusão.",
      "Quando você (cliente) exclui sua conta no portal, apagamos ou anonimizamos seu cadastro, a ficha de anamnese, as fotos, as mensagens e os registros de lembrete que identificam você. Mantemos apenas o registro mínimo de que consentimentos foram dados ou recusados (tipo, escolha, versão do texto e data), sem seu nome, IP ou dispositivo, e o histórico de agendamentos do estúdio, sem identificar você.",
      "Quando a Profissional exclui a conta, os dados do estúdio e de suas clientes são apagados, salvo o que a lei exigir guardar.",
      "Você também pode pedir a exclusão ao estúdio ou ao encarregado.",
    ],
  },
  {
    title: "8. Seus direitos.",
    paragraphs: [
      "Você pode pedir confirmação de tratamento, acesso, correção, anonimização ou eliminação, portabilidade, informação sobre compartilhamento e revogar consentimentos a qualquer momento. No portal você vê e revoga seus consentimentos. Para os demais pedidos, fale com seu estúdio ou com o encarregado, em veronicaverenkaacademy@gmail.com. Respondemos em até 15 dias.",
    ],
  },
  {
    title: "9. Dados de saúde e imagem.",
    paragraphs: [
      "A ficha de anamnese só é preenchida depois do seu consentimento específico e só é vista pelo estúdio e por quem ele autorizar. As fotos têm três opções de uso: não autorizo; autorizo sem mostrar o rosto; autorizo. Se você não autorizar, o app avisa o estúdio disso, e o estúdio é responsável por respeitar sua escolha.",
    ],
  },
  {
    title: "10. Menores de 18 anos.",
    paragraphs: [
      "O AURA é voltado a profissionais maiores de 18 anos. Se um estúdio atender uma cliente menor de 18 anos, o estúdio é responsável por obter, antes do atendimento e do cadastro, a autorização de um dos pais ou do responsável legal. O AURA não coleta dados do responsável.",
    ],
  },
  {
    title: "11. Segurança.",
    paragraphs: [
      "Usamos conexão criptografada, controle de acesso por estúdio e por permissão, registros de segurança e limite de tentativas de login. Nenhum sistema é totalmente imune; avisaremos você e a ANPD em caso de incidente relevante, conforme a lei.",
    ],
  },
  {
    title: "12. Alterações.",
    paragraphs: [
      "Quando mudarmos esta Política de forma relevante, avisaremos no app. Versão e data ficam registradas.",
    ],
  },
];

function PoliticaDePrivacidade() {
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
        <h1 className="mt-2 text-3xl font-display">Política de Privacidade</h1>
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
                {s.paragraphs?.map((p, i) => (
                  <p key={`p-${i}`}>{p}</p>
                ))}
                {s.items && (
                  <ul className="list-disc pl-5 space-y-2">
                    {s.items.map((item, i) => (
                      <li key={`item-${i}`}>{item}</li>
                    ))}
                  </ul>
                )}
                {s.afterItems?.map((p, i) => (
                  <p key={`after-${i}`}>{p}</p>
                ))}
                {s.table && (
                  <div className="overflow-x-auto rounded-xl border border-border/60">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-secondary/50">
                          <th className="text-left font-medium p-3 align-top">
                            {s.table.headers[0]}
                          </th>
                          <th className="text-left font-medium p-3 align-top">
                            {s.table.headers[1]}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.table.rows.map((row, i) => (
                          <tr key={i} className="border-t border-border/60">
                            <td className="p-3 align-top">{row[0]}</td>
                            <td className="p-3 align-top text-foreground/85">{row[1]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
