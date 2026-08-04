import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronLeft, Plug, Wifi } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { PanelHeader, Card } from "@/components/settings-ui";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/integracoes")({
  head: () => ({
    meta: [
      { title: "Integrações — AURA" },
      { name: "description", content: "Centralize conexões, tokens e testes de integração." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: IntegracoesPage,
});

const integrations = [
  { name: "WhatsApp Business Platform", status: "warn", desc: "Conexão perdida — reautentique." },
  { name: "Google Calendar", status: "ok", desc: "Sincronizado" },
  { name: "Apple Calendar", status: "off", desc: "Não conectado" },
  { name: "Mercado Pago", status: "ok", desc: "PIX e cartão ativos" },
  { name: "Stripe", status: "off", desc: "Não conectado" },
  { name: "OpenAI", status: "ok", desc: "Aura IA operacional" },
  { name: "Meta Ads", status: "off", desc: "Não conectado" },
  { name: "Google Drive", status: "ok", desc: "Backup de mídias" },
  { name: "Webhooks & API", status: "ok", desc: "3 endpoints ativos" },
];

function IntegracoesPage() {
  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <Link to="/mais" className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </Link>

      <div className="space-y-6">
        <PanelHeader title="Integrações" desc="Centralize conexões, tokens e testes de integração." />
        <div className="grid md:grid-cols-2 gap-3">
          {integrations.map((i) => (
            <Card key={i.name}>
              <div className="p-4 flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center",
                  i.status === "ok" && "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40",
                  i.status === "warn" && "bg-amber-50 text-amber-600 dark:bg-amber-950/40",
                  i.status === "off" && "bg-secondary text-muted-foreground"
                )}>
                  {i.status === "ok" ? <Wifi className="w-4 h-4" /> : i.status === "warn" ? <AlertTriangle className="w-4 h-4" /> : <Plug className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{i.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{i.desc}</div>
                </div>
                <Button size="sm" variant="outline" className="rounded-full h-8 shrink-0">
                  {i.status === "ok" ? "Testar" : i.status === "warn" ? "Reconectar" : "Conectar"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
