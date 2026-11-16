import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isAppleFlagTruthy } from "@/lib/apple-revoke-flag";

// FASE APPLE-1 (15/11/2026) — rota IRMÃ de _authenticated (fora dela, de
// propósito): quando a profissional chega aqui, a conta JÁ foi excluída e a
// sessão JÁ foi encerrada (seguranca.tsx faz supabase.auth.signOut() antes
// de navegar pra cá) — por isso esta rota NUNCA pode exigir sessão (sem
// beforeLoad nenhum, diferente de /conta-desativada, que exige sessão
// porque é alcançada ainDA logada).
//
// appleRevokeRequired vem como parâmetro de rota (search), não
// sessionStorage: é um booleano só de UI (mostra/esconde o bloco da Apple),
// nunca dado pessoal nem fonte de verdade de nada sensível — mesmo que
// alguém troque o valor na URL à mão, o único efeito possível é ver (ou não
// ver) um bloco de texto e um link; não há leitura de dado nem ação
// irreversível ligada a ele. Usar sessionStorage aqui exigiria lidar com o
// caso de estar bloqueado/ausente (alguns navegadores/modos privados) só
// pra guardar um valor que não tem problema nenhum de ficar visível na URL.
export const Route = createFileRoute("/conta-excluida")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    apple: isAppleFlagTruthy(search.apple),
  }),
  head: () => ({
    meta: [{ title: "Conta excluída — AURA" }, { name: "robots", content: "noindex" }],
  }),
  component: ContaExcluida,
});

const APPLE_REVOKE_URL = "https://auraappia.lovable.app/~oauth/apple/revoke";

function ContaExcluida() {
  const { apple } = Route.useSearch();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="text-2xl font-display font-medium tracking-tight">AURA</div>

        <div className="space-y-2">
          <h1 className="text-lg font-medium">Conta excluída</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Sua conta e seus dados pessoais foram apagados do AURA.
          </p>
        </div>

        {apple && (
          <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 space-y-3 text-left">
            <p className="text-sm font-medium">Para concluir, desconecte o AURA do seu Apple ID</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Você entrou no AURA com sua conta Apple. Excluir a conta no AURA não desfaz essa
              conexão do lado da Apple — você precisa remover o acesso do AURA ao seu Apple ID.
            </p>
            <a href={APPLE_REVOKE_URL} target="_blank" rel="noopener noreferrer" className="block">
              <Button variant="outline" className="w-full h-11 rounded-xl gap-2">
                Desconectar Apple
                <ExternalLink className="w-3.5 h-3.5" />
              </Button>
            </a>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Ou, se preferir, faça isso direto no iPhone: Ajustes {">"} seu nome {">"} Iniciar
              sessão com Apple {">"} AURA {">"} Parar de usar o ID Apple.
            </p>
          </div>
        )}

        <Link to="/auth" search={{ next: undefined, signup: false }} className="block">
          <Button variant="outline" className="w-full h-12 rounded-xl">
            Voltar para o início
          </Button>
        </Link>
      </div>
    </div>
  );
}
