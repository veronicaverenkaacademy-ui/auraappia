import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { getMyTermsStatus, acceptMyTerms } from "@/lib/professional-terms.functions";

// FASE CONSENT-1C (16/11/2026) — rota IRMÃ de _authenticated (fora dela,
// de propósito, mesmo padrão de /conta-desativada): o beforeLoad de
// _authenticated/route.tsx redireciona pra cá quando a profissional
// logada precisa aceitar uma versão nova dos Termos/Política. Se esta
// tela vivesse dentro de _authenticated, o mesmo beforeLoad rodaria de
// novo e entraria em loop. Único requisito aqui é ter sessão — não repete
// a checagem de versão que trouxe a usuária até aqui (quem decide isso é
// o componente, via getMyTermsStatus).
export const Route = createFileRoute("/aceitar-termos")({
  ssr: false,
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      throw redirect({ to: "/auth", search: { next: undefined, signup: false } });
    }
  },
  head: () => ({
    meta: [{ title: "Termos atualizados — AURA" }, { name: "robots", content: "noindex" }],
  }),
  component: AceitarTermos,
});

function AceitarTermos() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const statusFn = useServerFn(getMyTermsStatus);
  const acceptFn = useServerFn(acceptMyTerms);
  const [checked, setChecked] = useState(false);

  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["terms-status"],
    queryFn: () => statusFn(),
  });

  const accept = useMutation({
    mutationFn: () => acceptFn(),
    onSuccess: async (res) => {
      if (!res.ok) return;
      // Duas chaves de cache diferentes de propósito: "terms-status" é a
      // usada por esta própria tela (getMyTermsStatus, createServerFn);
      // "terms-outdated" é a usada pelo beforeLoad de _authenticated
      // (getMyTermsOutdated, leitura simples) — sem invalidar as duas, o
      // beforeLoad podia servir um "ainda desatualizado" do cache
      // (staleTime de 60s) e mandar a profissional de volta pro gate
      // logo depois de ela aceitar.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["terms-status"] }),
        qc.invalidateQueries({ queryKey: ["terms-outdated"] }),
      ]);
      navigate({ to: "/dashboard", replace: true });
    },
  });

  // Mesmo padrão de logout de /conta-desativada — limpa o cache antes de
  // sair, pra não deixar dado da sessão anterior visível depois.
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true, search: { next: undefined, signup: false } });
  };

  // Já está em dia (ex.: aceitou em outra aba, ou chegou aqui sem
  // precisar) — não há nada pra bloquear, manda pra área normal do app.
  if (status && !status.isOutdated) {
    navigate({ to: "/dashboard", replace: true });
    return null;
  }

  // Carregando: nada do conteúdo protegido aparece, só um indicador —
  // evita qualquer flash do app antes do gate decidir se bloqueia.
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Fail-safe: falha de rede/leitura nunca deixa a usuária travada fora
  // do app sem explicação nem saída — "Tentar novamente" e "Sair", nunca
  // só uma tela presa.
  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="text-2xl font-display font-medium tracking-tight">AURA</div>
          <div className="space-y-2">
            <h1 className="text-lg font-medium">Não foi possível continuar</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Não conseguimos verificar o status dos Termos agora. Tente de novo em instantes.
            </p>
          </div>
          <div className="space-y-2">
            <Button onClick={() => refetch()} className="w-full h-12 rounded-xl">
              Tentar novamente
            </Button>
            <Button onClick={signOut} variant="outline" className="w-full h-12 rounded-xl">
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const version = status?.requiredVersion ?? "";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="text-2xl font-display font-medium tracking-tight">AURA</div>

        <div className="space-y-2">
          <h1 className="text-lg font-medium">Termos atualizados</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Atualizamos nossos Termos de Uso e Política de Privacidade. Para continuar usando o
            AURA, leia e aceite.
          </p>
        </div>

        <div className="rounded-2xl border border-border/70 bg-secondary/40 p-4 space-y-3 text-left">
          <div className="flex gap-3 text-sm">
            <Link to="/termos-de-uso" target="_blank" className="underline underline-offset-2">
              Termos de Uso
            </Link>
            <Link
              to="/politica-de-privacidade"
              target="_blank"
              className="underline underline-offset-2"
            >
              Política de Privacidade
            </Link>
          </div>

          <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed">
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => setChecked(v === true)}
              className="mt-0.5"
            />
            <span>
              Li e concordo com os Termos de Uso e a Política de Privacidade (versão {version}).
            </span>
          </label>

          {accept.isError && (
            <p className="text-xs text-destructive">
              Não foi possível registrar o aceite agora. Tente de novo.
            </p>
          )}
          {accept.data && !accept.data.ok && (
            <p className="text-xs text-destructive">{accept.data.error}</p>
          )}

          <Button
            onClick={() => accept.mutate()}
            disabled={!checked || accept.isPending}
            className="w-full h-11 rounded-xl"
          >
            {accept.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Aceitar e continuar"
            )}
          </Button>
        </div>

        <div className="space-y-3">
          <Button onClick={signOut} variant="outline" className="w-full h-12 rounded-xl">
            Sair
          </Button>
          <Link
            to="/seguranca"
            className="block text-xs text-muted-foreground underline underline-offset-2"
          >
            Prefere encerrar sua conta? Acesse Segurança
          </Link>
        </div>
      </div>
    </div>
  );
}
