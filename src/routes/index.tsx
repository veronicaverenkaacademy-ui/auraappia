import { createFileRoute, redirect } from "@tanstack/react-router";

// Não existe landing de marketing ainda — quem cai na raiz do domínio é sempre uma
// profissional (dona ou colaboradora), então "/" manda direto para o login/cadastro.
// O link público de agendamento de cada profissional é "/l/:slug", não "/".
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
