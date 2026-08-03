import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentRole } from "@/lib/team";

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
  },
  component: () => <Outlet />,
});