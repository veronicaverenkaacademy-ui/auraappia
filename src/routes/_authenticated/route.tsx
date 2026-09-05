import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentRole, getSelfTeamMember } from "@/lib/team";

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
  },
  component: () => <Outlet />,
});