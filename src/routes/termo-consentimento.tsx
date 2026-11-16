import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Square } from "lucide-react";

export const Route = createFileRoute("/termo-consentimento")({
  head: () => ({
    meta: [
      { title: "Termo de Consentimento — AURA" },
      {
        name: "description",
        content:
          "Termo de Consentimento para Tratamento de Dados, Anamnese e Uso de Imagem — plataforma AURA.",
      },
    ],
  }),
  component: TermoConsentimento,
});

// FASE CONSENT-1B (15/11/2026) — o texto original (redigido pela dona) usa
// um marcador de modelo entre colchetes (nome do estúdio), pensado para
// ser preenchido com o nome real numa tela futura. Nesta página pública e
// genérica (sem contexto de nenhum estúdio específico), esse marcador foi
// substituído por "o estúdio"/"do estúdio"/"no estúdio"/"pelo estúdio",
// com o ajuste gramatical mínimo necessário (contrações de preposição +
// concordância de pronome em um ponto — ver relatório da fase). Nenhuma
// outra palavra do texto foi alterada.
const intro = [
  'Cada autorização abaixo é separada: você marca uma caixa para cada uma, nenhuma vem marcada de antemão, e recusar uma não impede as outras, exceto onde indicado. Você pode marcar no seu celular ou na tela do estúdio. Em "o estúdio", lê-se o nome do estúdio que atende você.',
];

type Block = { kind: "p"; text: string } | { kind: "check"; text: string };

type Section = { title: string; blocks: Block[] };

const p = (text: string): Block => ({ kind: "p", text });
const check = (text: string): Block => ({ kind: "check", text });

const sections: Section[] = [
  {
    title: "A. Termos e Política de Privacidade (necessário para usar o serviço)",
    blocks: [check("Li e aceito a Política de Privacidade do estúdio e do AURA.")],
  },
  {
    title:
      "B. Lembretes por WhatsApp (necessário para receber lembretes; sem ele a agenda continua funcionando, só sem mensagens)",
    blocks: [
      check(
        "Autorizo receber, no WhatsApp, os lembretes do meu horário no estúdio, 24 horas e 2 horas antes, enviados pelo número central do AURA. Posso responder pelos botões e posso pedir para parar de receber a qualquer momento.",
      ),
    ],
  },
  {
    title: "C. Dados de saúde (ficha de anamnese) (consentimento específico e destacado)",
    blocks: [
      check(
        "Autorizo o estúdio a registrar no AURA as informações de saúde que eu informar na ficha de anamnese (por exemplo, alergias, condições de saúde, uso de medicamentos e gestação), para que o procedimento seja feito com segurança. Entendo que essas informações são dados sensíveis, serão vistas apenas pelo estúdio e por quem ele autorizar, e que posso revogar este consentimento e pedir a exclusão a qualquer momento.",
      ),
      p("A ficha só pode ser preenchida depois deste aceite."),
    ],
  },
  {
    title: "D. Uso de imagem (três opções; escolha uma)",
    blocks: [
      check("Não autorizo o uso das minhas fotos além do meu prontuário e acompanhamento."),
      check("Autorizo o uso das minhas fotos em divulgação sem mostrar meu rosto."),
      check("Autorizo o uso das minhas fotos em divulgação, inclusive com o rosto."),
      p(
        "A autorização vale para redes sociais, portfólio e materiais impressos do estúdio, pode ser revogada a qualquer tempo e não gera pagamento. A revogação não alcança o que já foi publicado em material impresso.",
      ),
    ],
  },
  {
    title: "E. Marketing (opcional, separado de tudo o mais)",
    blocks: [
      check(
        "Autorizo o estúdio a me enviar promoções, novidades e campanhas por WhatsApp. Posso cancelar quando quiser.",
      ),
      p("Sem este aceite, nenhuma mensagem de marketing é enviada."),
    ],
  },
  {
    title: "Registro",
    blocks: [
      p(
        "Para cada aceite o sistema grava o tipo, a escolha, a versão do texto, a data e a hora, a origem (seu celular ou a tela do estúdio), o IP e o dispositivo, para provar que a autorização foi dada. Você pode ver e revogar suas autorizações no portal ou pedindo ao estúdio. Para dúvidas sobre seus dados: veronicaverenkaacademy@gmail.com.",
      ),
    ],
  },
  {
    title: "Menores de 18 anos",
    blocks: [
      p(
        "O estúdio é responsável por obter a autorização de um dos pais ou do responsável legal antes do atendimento, conforme a Política de Privacidade.",
      ),
    ],
  },
];

function TermoConsentimento() {
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
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          AURA — VERÔNICA VERENKA MARTINS
        </p>
        <h1 className="mt-2 text-3xl font-display">
          Termo de Consentimento para Tratamento de Dados, Anamnese e Uso de Imagem
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Última atualização: 15 de novembro de 2026.
        </p>

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
      </div>
    </div>
  );
}
