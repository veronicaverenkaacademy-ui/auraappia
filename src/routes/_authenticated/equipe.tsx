import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/equipe")({
  head: () => ({
    meta: [
      { title: "Equipe · AURA" },
      { name: "description", content: "Gestão de colaboradores, papéis, permissões e desempenho da sua equipe." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EquipeLayout,
});

const tabs = [
  { to: "/equipe", label: "Colaboradores", exact: true },
  { to: "/equipe/permissoes", label: "Papéis & Permissões" },
  { to: "/equipe/auditoria", label: "Auditoria" },
];

function EquipeLayout() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  return (
    <AppShell title="Equipe">
      <div className="border-b border-border/50 px-4 md:px-8">
        <nav className="flex gap-6 overflow-x-auto">
          {tabs.map((t) => {
            const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                className={cn(
                  "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="px-4 md:px-8 py-6">
        <Outlet />
      </div>
    </AppShell>
  );
}