import { createFileRoute, redirect } from "@tanstack/react-router";

// A área da cliente real vive dentro de "/l/:slug" (o link da profissional), não mais
// aqui — esta rota existia com um painel inteiro mockado (pontos, pacotes, cupons) sem
// nenhuma autenticação real. Mantida como redirecionamento para não quebrar links
// antigos que alguém possa ter salvo.
export const Route = createFileRoute("/portal")({
  beforeLoad: () => {
    throw redirect({ to: "/auth" });
  },
});
