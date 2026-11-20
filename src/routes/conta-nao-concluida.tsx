import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// FASE AUTH-1 (20/11/2026) — rota IRMÃ de _authenticated (não filha), mesmo
// motivo de /conta-desativada (ver o comentário lá): o beforeLoad de
// _authenticated é quem manda pra cá quando a sessão existe mas não tem
// NENHUM papel (user_roles) — uma conta que autenticou (Apple/Google/
// telefone) mas nunca virou profissional nem foi vinculada como
// colaboradora (ver src/lib/claim-professional-role.server.ts). Se esta
// tela vivesse dentro do mesmo layout, o beforeLoad rodaria de novo e
// voltaria pra cá em loop. Aqui só exige ter uma sessão — não repete a
// checagem de papel que trouxe a usuária até aqui.
export const Route = createFileRoute("/conta-nao-concluida")({
  ssr: false,
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      throw redirect({ to: "/auth", search: { next: undefined, signup: false } });
    }
  },
  component: ContaNaoConcluida,
});

function ContaNaoConcluida() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Mesmo padrão de logout já usado em /conta-desativada e
  // _authenticated/mais.tsx — limpa o cache de queries antes de sair pra
  // não deixar dado da sessão anterior visível depois.
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true, search: { next: undefined, signup: false } });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="text-2xl font-display font-medium tracking-tight">AURA</div>
        <div className="space-y-2">
          <h1 className="text-lg font-medium">Sua conta ainda não foi concluída</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Toque em "Criar conta" para terminar o cadastro com os mesmos dados de identidade que
            você já usou.
          </p>
        </div>
        <Button asChild className="w-full h-12 rounded-xl">
          <Link to="/cadastro" search={{ next: undefined }}>
            Criar conta
          </Link>
        </Button>
        <Button onClick={signOut} variant="outline" className="w-full h-12 rounded-xl">
          Sair
        </Button>
      </div>
    </div>
  );
}
