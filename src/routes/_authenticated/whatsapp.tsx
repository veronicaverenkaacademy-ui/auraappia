import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp — AURA IA" },
      {
        name: "description",
        content:
          "Recepcionista virtual inteligente da AURA no WhatsApp: agendamentos, lembretes e atendimento 24h.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WhatsAppLayout,
});

function WhatsAppLayout() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isConfig = pathname.startsWith("/whatsapp/config");
  const isHistory = !isConfig;

  return (
    <AppShell title="WhatsApp" className="pb-24 md:pb-12">
      <div className="border-b border-border/50 px-4 md:px-8">
        <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar">
          <Tab to="/whatsapp" active={isHistory}>
            Histórico
          </Tab>
          <Tab to="/whatsapp/config" active={isConfig}>
            Conexão &amp; IA
          </Tab>
        </nav>
      </div>
      <Outlet />
    </AppShell>
  );
}

function Tab({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={
        "px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition " +
        (active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </Link>
  );
}
