import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Square } from "lucide-react";

export const Route = createFileRoute("/termo-consentimento")({
  head: () => ({
    meta: [
      { title: "Termo de Consentimento — AURA" },
      {
        name: "description",
        content: "Termo de Consentimento para Tratamento de Dados, Anamnese e Uso de Imagem — plataforma AURA.",
      },
    ],
  }),
  component: TermoConsentimento,
});

const intro = [
  "Este documento tem como objetivo explicar, de forma clara e transparente, quais dados seus serão coletados antes do seu atendimento, para quê serão usados, e pedir sua autorização expressa para os pontos que exigem consentimento, em conformidade com a Lei Geral de Proteção de Dados (LGPD).",
  "Leia com atenção. Você pode aceitar apenas o que for obrigatório para a realização do seu procedimento com segurança, e escolher separadamente se autoriza (ou não) o uso da sua imagem para divulgação e o recebimento de comunicações de marketing.",
];

type Block =
  | { kind: "p"; text: string }
  | { kind: "field"; label: string }
  | { kind: "check"; text: string };

type Section = { title: string; blocks: Block[] };

const p = (text: string): Block => ({ kind: "p", text });
const field = (label: string): Block => ({ kind: "field", label });
const check = (text: string): Block => ({ kind: "check", text });

const sections: Section[] = [
  {
    title: "1. Seus dados",
    blocks: [
      field("Nome completo"),
      field("CPF"),
      field("Data de nascimento"),
      field("Telefone / WhatsApp"),
      field("E-mail"),
    ],
  },
  {
    title: "2. Ficha de Anamnese — Dados de Saúde (obrigatório)",
    blocks: [
      p("Para realizar seu procedimento com segurança, é necessário coletar informações sobre sua saúde, tais como alergias, contraindicações, uso de medicamentos, gestação e condições de pele/olhos relevantes ao serviço contratado. Esses são considerados \"dados sensíveis\" pela LGPD e recebem proteção reforçada."),
      p("Essas informações serão utilizadas exclusivamente para: (i) avaliar a segurança e a viabilidade do procedimento; (ii) adaptar a técnica e os produtos utilizados às suas necessidades; e (iii) registrar seu histórico clínico para atendimentos futuros. Não serão utilizadas para nenhuma outra finalidade, nem compartilhadas com terceiros alheios ao seu atendimento, exceto quando exigido por lei."),
      check("Autorizo o preenchimento e o armazenamento da minha ficha de anamnese — obrigatório para a realização do procedimento"),
    ],
  },
  {
    title: "3. Uso de Imagem — Fotos de Antes/Depois (registro do atendimento)",
    blocks: [
      p("É comum o registro fotográfico do procedimento (antes, durante e depois) para acompanhamento da sua evolução e para o seu próprio histórico de atendimentos, visível apenas para você e para a equipe do estúdio."),
      check("Autorizo o registro fotográfico do meu atendimento para fins de histórico clínico — uso interno, visível só para mim e para o estúdio"),
    ],
  },
  {
    title: "4. Uso de Imagem para Divulgação (opcional)",
    blocks: [
      p("Separadamente do item anterior, o estúdio pode usar fotos do seu atendimento (sempre resguardando sua identidade, quando solicitado) em redes sociais, portfólio, site ou materiais de divulgação. Esta autorização é totalmente opcional e pode ser revogada a qualquer momento, sem qualquer prejuízo ao seu atendimento."),
      check("Autorizo o uso das minhas fotos para divulgação (redes sociais, portfólio, site) — opcional"),
      check("Autorizo a divulgação apenas sem mostrar meu rosto (foco no procedimento) — opcional"),
      check("Não autorizo o uso das minhas fotos para divulgação — opcional"),
    ],
  },
  {
    title: "5. Comunicações (opcional)",
    blocks: [
      p("O estúdio utiliza a plataforma AURA para enviar confirmações e lembretes de agendamento (necessários para o funcionamento do serviço) e, opcionalmente, comunicações de relacionamento e marketing, como lembretes de manutenção, promoções, aniversário e novidades."),
      check("Autorizo o envio de comunicações de marketing e promoções via WhatsApp, SMS e/ou e-mail — opcional — lembretes de agendamento são enviados independentemente desta autorização, por serem necessários ao serviço"),
    ],
  },
  {
    title: "6. Seus Direitos",
    blocks: [
      p("Você pode, a qualquer momento e sem custo: solicitar acesso aos seus dados; corrigir informações desatualizadas; revogar qualquer consentimento aqui dado (incluindo o uso de imagem para divulgação e o recebimento de comunicações de marketing); e solicitar a exclusão dos seus dados, observados os prazos de guarda exigidos por lei ou necessários para fins de histórico clínico e segurança do procedimento."),
      p("Para exercer qualquer desses direitos, entre em contato diretamente com o estúdio pelos canais informados abaixo, ou utilize a área \"Perfil\" e \"Documentos\" do seu Portal da Cliente."),
    ],
  },
  {
    title: "7. Assinatura",
    blocks: [
      p("Ao assinar digitalmente este termo, você confirma que leu e compreendeu as informações acima e que as autorizações marcadas refletem sua vontade livre e informada."),
      field("Local e data"),
      field("Assinatura do(a) responsável legal (se menor de idade)"),
      p("Registro da assinatura digital (preenchido automaticamente pela Plataforma): Nome do titular · CPF · Data e hora · Endereço IP · Dispositivo utilizado · Versão deste termo."),
    ],
  },
];

function TermoConsentimento() {
  return (
    <div className="min-h-screen bg-background">
      <header className="p-6 border-b border-border/60">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </Link>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">AURA — VERÔNICA VERENKA MARTINS</p>
        <h1 className="mt-2 text-3xl font-display">
          Termo de Consentimento para Tratamento de Dados, Anamnese e Uso de Imagem
        </h1>

        <div className="mt-8 space-y-4 text-sm leading-relaxed text-foreground/85">
          {intro.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </div>

        <div className="mt-10 space-y-10">
          {sections.map((s) => (
            <section key={s.title}>
              <h2 className="text-lg font-display">{s.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/85">
                {s.blocks.map((b, i) => {
                  if (b.kind === "p") return <p key={i}>{b.text}</p>;
                  if (b.kind === "field") {
                    return (
                      <div key={i} className="pt-1">
                        <div className="text-xs font-medium text-muted-foreground">{b.label}</div>
                        <div className="mt-1.5 h-px w-full bg-border" />
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="flex items-start gap-2.5">
                      <Square className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/70" />
                      <span>{b.text}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-10 text-xs text-muted-foreground/70 leading-relaxed">
          Para mais detalhes sobre como seus dados são tratados, incluindo prazos de retenção e medidas de
          segurança, consulte a{" "}
          <Link to="/politica-de-privacidade" className="underline underline-offset-2">
            Política de Privacidade
          </Link>{" "}
          da Plataforma AURA.
        </p>
      </div>
    </div>
  );
}
