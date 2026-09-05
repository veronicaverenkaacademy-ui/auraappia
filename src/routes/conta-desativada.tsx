import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

// Rota IRMÃ de _authenticated (não filha) — de propósito. O beforeLoad de
// _authenticated é justamente quem redireciona pra cá quando o status da
// colaboradora é inactive/terminated; se esta tela vivesse dentro do mesmo layout,
// ela rodaria o mesmo beforeLoad de novo e entraria em loop de redirecionamento
// (checa status → redireciona → checa de novo → redireciona de novo). Aqui, o único
// requisito é ter uma sessão — não repete a checagem de status que trouxe o usuário
// até aqui.
export const Route = createFileRoute("/conta-desativada")({
  ssr: false,
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      throw redirect({ to: "/auth", search: { next: undefined, signup: false } });
    }
  },
  component: ContaDesativada,
});

function ContaDesativada() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Mesmo padrão de logout já usado em _authenticated/mais.tsx — limpa o cache de
  // queries antes de sair pra não deixar dado da sessão anterior visível depois.
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
          <h1 className="text-lg font-medium">Sua conta foi desativada</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Entre em contato com a responsável pelo estabelecimento para mais informações.
          </p>
        </div>
        <Button onClick={signOut} variant="outline" className="w-full h-12 rounded-xl">
          Sair
        </Button>
      </div>
    </div>
  );
}
