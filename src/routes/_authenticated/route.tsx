import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentRole, getSelfTeamMember } from "@/lib/team";
import { getMyTermsOutdated } from "@/lib/professional-terms";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const authRedirect = () =>
      redirect({ to: "/auth", search: { next: location.href, signup: false } });

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw authRedirect();
    }

    const role = await context.queryClient.ensureQueryData({
      queryKey: ["current-role"],
      queryFn: getCurrentRole,
      staleTime: 60_000,
    });

    if (role !== "admin" && role !== "staff") {
      throw authRedirect();
    }

    // Checagem pós-login independente de como a sessão foi criada (Apple/Google via
    // lovable.auth.signInWithOAuth, telefone via signInWithOtp, ou e-mail/senha via
    // signInWithPassword) — todas resultam na mesma sessão do Supabase, e este
    // beforeLoad roda igual pra qualquer uma. Não afeta a dona (role === "admin");
    // 'vacation' continua com acesso normal, só 'inactive'/'terminated' são barradas.
    // /conta-desativada é rota irmã (fora de _authenticated) de propósito, pra não
    // reentrar neste mesmo beforeLoad e criar loop.
    if (role === "staff") {
      const selfMember = await context.queryClient.ensureQueryData({
        queryKey: ["self-member"],
        queryFn: getSelfTeamMember,
        staleTime: 60_000,
      });
      if (!selfMember || selfMember.status === "inactive" || selfMember.status === "terminated") {
        throw redirect({ to: "/conta-desativada" });
      }
    }

    // FASE CONSENT-1C (16/11/2026) — vale pra dona E colaboradora (ambas
    // chegam aqui com role admin/staff já confirmado acima). /seguranca
    // fica de fora de propósito: é o único jeito de a profissional
    // bloqueada pelo gate ainda conseguir chegar em "Excluir minha
    // conta" (exigência da Apple 5.1.1(v) — a conta tem que continuar
    // excluível mesmo com o aceite pendente) — ver o link em
    // /aceitar-termos. Nenhuma outra rota fica de fora: só essa exceção,
    // sem enfraquecer o resto do bloqueio.
    if (location.pathname !== "/seguranca") {
      const outdated = await context.queryClient.ensureQueryData({
        queryKey: ["terms-outdated"],
        queryFn: getMyTermsOutdated,
        staleTime: 60_000,
      });
      if (outdated) {
        throw redirect({ to: "/aceitar-termos" });
      }
    }
  },
  component: () => <Outlet />,
});