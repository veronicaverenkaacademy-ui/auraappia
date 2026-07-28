import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/bi")({
  head: () => ({
    meta: [
      { title: "BI — AURA" },
      { name: "description", content: "Business Intelligence executivo com IA preditiva para o seu negócio da beleza." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <Outlet />,
});

export function BITabs() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const tabs = [
    { to: "/bi", label: "Resumo" },
    { to: "/bi/clientes", label: "Clientes" },
    { to: "/bi/servicos", label: "Serviços" },
    { to: "/bi/preditivo", label: "BI Preditivo" },
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
              (active ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}