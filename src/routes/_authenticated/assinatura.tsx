import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PanelHeader, Card } from "@/components/settings-ui";

export const Route = createFileRoute("/_authenticated/assinatura")({
  head: () => ({
    meta: [
      { title: "Assinatura — AURA" },
      { name: "description", content: "Plano, limites de uso e histórico de cobranças." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AssinaturaPage,
});

function AssinaturaPage() {
  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <Link to="/mais" className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </Link>

      <div className="space-y-6">
        <PanelHeader title="Assinatura" desc="Plano, limites de uso e histórico de cobranças." />
        <Card>
          <div className="p-6 flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Plano atual</div>
              <div className="text-2xl font-display mt-1">Premium</div>
              <div className="text-sm text-muted-foreground mt-1">Válido até 12/11/2026 · renovação automática</div>
            </div>
            <Button variant="outline" className="rounded-full">Gerenciar</Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-border/50 p-6">
            {[
              { l: "Profissionais", v: "3 de 10" },
              { l: "Clientes", v: "412" },
              { l: "Mensagens Aura IA", v: "1.284 / mês" },
              { l: "Armazenamento", v: "4,2 GB" },
            ].map((k) => (
              <div key={k.l}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{k.l}</div>
                <div className="text-sm font-medium mt-1">{k.v}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <div className="text-sm font-medium mb-3">Últimas cobranças</div>
            <div className="space-y-2">
              {[
                { d: "12/10/2026", v: "R$ 299,00", s: "Pago" },
                { d: "12/09/2026", v: "R$ 299,00", s: "Pago" },
                { d: "12/08/2026", v: "R$ 299,00", s: "Pago" },
              ].map((c, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div className="text-sm">{c.d}</div>
                  <div className="text-sm text-muted-foreground">{c.v}</div>
                  <Badge className="rounded-full bg-emerald-50 text-emerald-600 border-0 dark:bg-emerald-950/40">{c.s}</Badge>
                  <Button size="sm" variant="ghost" className="rounded-full h-7 text-xs">Nota fiscal</Button>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
