import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Target, Calendar, TrendingUp, Award } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { useSelfMember } from "@/hooks/use-role";
import { initials } from "@/lib/clients";
import { fetchCompanySlugByOwnerId } from "@/lib/companyProfile";

export const Route = createFileRoute("/_authenticated/meu-espaco")({
  head: () => ({
    meta: [
      { title: "Meu Espaço · AURA" },
      {
        name: "description",
        content: "Sua área pessoal no AURA: agenda, metas, comissão e link exclusivo.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MeuEspaco,
});

function MeuEspaco() {
  const { data: me, isLoading } = useSelfMember();
  const { data: companySlug } = useQuery({
    queryKey: ["company-slug", me?.owner_id],
    queryFn: () => fetchCompanySlugByOwnerId(me!.owner_id),
    enabled: Boolean(me),
  });

  if (isLoading)
    return (
      <AppShell title="Meu Espaço">
        <div className="p-8 text-muted-foreground">Carregando…</div>
      </AppShell>
    );
  if (!me)
    return (
      <AppShell title="Meu Espaço">
        <div className="max-w-md mx-auto p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Seu perfil ainda não foi vinculado como colaborador. Fale com o administrador.
          </p>
        </div>
      </AppShell>
    );

  // Link da empresa — a página de agendamento por profissional específica chega na
  // próxima PR (seleção de profissional dentro do fluxo de agendamento da empresa).
  const link = companySlug ? `${window.location.origin}/l/${companySlug}` : "";
  const dayGoal = Number(me.monthly_goal) / 22;
  const dayProgress = 62; // mock — plug em BI real depois

  return (
    <AppShell title="Meu Espaço">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-6">
        <div className="rounded-3xl border border-border/60 bg-card p-6 flex items-center gap-5">
          <Avatar className="w-16 h-16">
            <AvatarImage src={me.avatar_url ?? undefined} />
            <AvatarFallback className="text-lg">{initials(me.full_name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Bem-vinda</div>
            <div className="text-2xl font-display truncate">{me.full_name}</div>
            <div className="text-sm text-muted-foreground">{me.role_title ?? "Colaboradora"}</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card icon={<Target className="w-4 h-4" />} title="Meta do dia">
            <div className="text-2xl font-display">R$ {dayGoal.toFixed(0)}</div>
            <Progress value={dayProgress} className="mt-3 h-2" />
            <div className="text-xs text-muted-foreground mt-2">{dayProgress}% concluído</div>
          </Card>
          <Card icon={<Calendar className="w-4 h-4" />} title="Próximos atendimentos">
            <Link to="/agenda" className="text-sm text-primary underline underline-offset-4">
              Ver minha agenda
            </Link>
          </Card>
          {me.show_commission && (
            <Card icon={<TrendingUp className="w-4 h-4" />} title="Comissão estimada">
              <div className="text-2xl font-display">
                {me.commission_type === "percent"
                  ? `${me.commission_value}%`
                  : `R$ ${me.commission_value}`}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Sobre atendimentos concluídos.
              </div>
            </Card>
          )}
          <Card icon={<Award className="w-4 h-4" />} title="Estatísticas pessoais">
            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Confirmação" value="92%" />
              <Stat label="Pontualidade" value="98%" />
              <Stat label="Avaliação" value="4.9" />
            </div>
          </Card>
        </div>

        {link && (
          <div className="rounded-3xl border border-border/60 bg-card p-6 space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Link de agendamento da empresa
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-4 py-3 bg-muted/50 rounded-full text-sm truncate">
                {link}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="rounded-full"
                onClick={() => {
                  navigator.clipboard.writeText(link);
                  toast.success("Link copiado.");
                }}
              >
                <Copy className="w-4 h-4" />
              </Button>
              <a href={link} target="_blank" rel="noreferrer">
                <Button variant="outline" size="icon" className="rounded-full">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </a>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-border/60 bg-card p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
        {icon}
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-display">{value}</div>
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
    </div>
  );
}
