import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/exclusao-de-dados")({
  head: () => ({
    meta: [
      { title: "Exclusão de dados do usuário — AURA" },
      {
        name: "description",
        content: "Como solicitar a exclusão dos seus dados pessoais na plataforma AURA.",
      },
    ],
  }),
  component: ExclusaoDeDados,
});

const intro = [
  "O AURA respeita sua privacidade e permite que você solicite a exclusão dos dados associados à sua conta.",
  "Se você deseja excluir sua conta e os dados pessoais armazenados pelo AURA, envie uma solicitação de exclusão utilizando o canal de atendimento indicado abaixo.",
  "Após recebermos a solicitação, faremos a verificação necessária e processaremos a exclusão dos dados aplicáveis, respeitando obrigações legais e regulatórias que eventualmente exijam a manutenção de determinadas informações.",
  "A solicitação de exclusão não poderá ser revertida após sua conclusão.",
];

const sections: { title: string; paragraphs: string[] }[] = [
  {
    title: "Como solicitar a exclusão",
    paragraphs: [
      "Para solicitar a exclusão dos seus dados, entre em contato com o suporte do AURA e informe o e-mail utilizado na sua conta.",
      "E-mail para solicitação: suporte@auraagendaia.com",
      'Assunto sugerido: "Solicitação de exclusão de dados — AURA"',
      "A solicitação será analisada e processada após a confirmação da identidade do titular da conta.",
    ],
  },
  {
    title: "Quais dados podem ser excluídos",
    paragraphs: [
      "Quando aplicável, podem ser excluídos: dados de cadastro da conta; informações pessoais associadas à conta; dados de clientes armazenados pelo profissional, quando aplicável e permitido; e informações relacionadas às integrações utilizadas pelo usuário.",
      "Nem todos os dados podem ser apagados imediatamente — determinados registros podem precisar ser mantidos por obrigação legal, segurança, prevenção a fraude ou outras obrigações legítimas.",
    ],
  },
  {
    title: "Após a solicitação",
    paragraphs: [
      "Após recebermos uma solicitação válida, o AURA poderá solicitar informações adicionais para confirmar a identidade do titular da conta. Após a confirmação, a solicitação será processada conforme as políticas de privacidade e os requisitos legais aplicáveis.",
    ],
  },
  {
    title: "Contato",
    paragraphs: ["E-mail: suporte@auraagendaia.com; WhatsApp/Telefone: (47) 98868-0883."],
  },
];

function ExclusaoDeDados() {
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
        <h1 className="mt-2 text-3xl font-display">Exclusão de dados do usuário</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Solicite a exclusão dos seus dados do AURA
        </p>

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
