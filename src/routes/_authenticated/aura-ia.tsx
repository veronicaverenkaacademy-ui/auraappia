import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/aura-ia")({
  head: () => ({
    meta: [
      { title: "AURA IA — Sua gerente executiva" },
      { name: "description", content: "Painel executivo, chat inteligente e Conselho Executivo da AURA IA." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuraIALayout,
});

function AuraIALayout() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isChat = pathname.startsWith("/aura-ia/chat");
  const isCouncil = pathname.startsWith("/aura-ia/conselho");
  const isPanel = !isChat && !isCouncil;

  return (
    <AppShell title="AURA IA" className="pb-24 md:pb-12">
      <div className="border-b border-border/50 px-4 md:px-8">
        <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar">
          <Tab to="/aura-ia" active={isPanel}>Painel</Tab>
          <Tab to="/aura-ia/chat" active={isChat}>Conversar</Tab>
          <Tab to="/aura-ia/conselho" active={isCouncil}>Conselho</Tab>
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