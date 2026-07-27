import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/marketing")({
  head: () => ({
    meta: [
      { title: "Marketing — AURA" },
      { name: "description", content: "Central inteligente de automações e relacionamento." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MarketingLayout,
});

function MarketingLayout() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const isIndex = pathname === "/marketing";
  const isJornadas = pathname.startsWith("/marketing/jornadas");
  const isIA = pathname.startsWith("/marketing/ia");

  return (
    <AppShell title="Marketing" className="pb-24 md:pb-12">
      <div className="border-b border-border/50 px-4 md:px-8">
        <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar">
          <Tab to="/marketing" active={isIndex && !isJornadas && !isIA}>Automações</Tab>
          <Tab to="/marketing/jornadas" active={isJornadas}>Jornadas</Tab>
          <Tab to="/marketing/ia" active={isIA}>AURA IA</Tab>
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