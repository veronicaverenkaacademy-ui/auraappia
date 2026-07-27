import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/financeiro")({
  head: () => ({
    meta: [
      { title: "Financeiro — AURA" },
      { name: "description", content: "Caixa, fluxo, DRE e CFO inteligente para o seu negócio da beleza." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <Outlet />,
});

export function FinTabs() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const tabs = [
    { to: "/financeiro", label: "Painel" },
    { to: "/financeiro/fluxo", label: "Fluxo & DRE" },
    { to: "/financeiro/cfo", label: "CFO IA" },
  ] as const;
  return (
    <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-2">
      {tabs.map((t) => {
        const active = pathname === t.to;
        return (
          <Link
            key={t.to}
            to={t.to}
            className={
              "text-xs font-semibold px-3.5 py-2 rounded-full whitespace-nowrap transition " +
              (active
                ? "bg-foreground text-background"
                : "bg-secondary text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}