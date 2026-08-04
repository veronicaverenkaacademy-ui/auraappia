import type { ReactNode } from "react";
import { ArrowRight, FileText, Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl bg-card border border-border/50", className)}>{children}</div>;
}

export function PanelHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl md:text-3xl font-display tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

export function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-border/50 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <div className="px-6 pt-5 pb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-medium">
        {title}
      </div>
      <div className="px-6 pb-4">{children}</div>
    </Card>
  );
}

export function StubPanel({ title, desc, icon: Icon = Users }: { title: string; desc: string; icon?: typeof Users }) {
  return (
    <div className="space-y-6">
      <PanelHeader title={title} desc={desc} />
      <Card>
        <div className="p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium">Módulo em construção</div>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            A Aura já reconhece esta configuração no Centro de Governança. Formulários detalhados serão liberados em breve.
          </p>
          <Button variant="outline" size="sm" className="rounded-full mt-5">
            Solicitar prioridade <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </Card>
      <div className="text-[11px] text-muted-foreground/60 flex items-center gap-1.5">
        <FileText className="w-3 h-3" /> Documentação completa disponível dentro do centro de ajuda.
      </div>
    </div>
  );
}
