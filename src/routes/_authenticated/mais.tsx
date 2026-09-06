import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { useStaffPermissions } from "@/hooks/use-staff-permissions";
import { supabase } from "@/integrations/supabase/client";
import type { Resource } from "@/lib/permissions";
import {
  Users, Calendar, Package, Sparkles, DollarSign, BarChart3, Megaphone, ShoppingBag,
  FileText, Settings, HelpCircle, MessageCircle, LineChart, Wand2, UsersRound, User,
  LayoutDashboard, Building2, Palette, Shield, Lock, Plug, Bell, CreditCard, Database,
  Settings2, LogOut,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/mais")({
  head: () => ({
    meta: [
      { title: "Mais — AURA" },
      { name: "description", content: "Acesso rápido a todas as áreas do AURA." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Mais,
});

type Item = {
  to: string;
  label: string;
  icon: typeof Users;
  desc: string;
  soon?: boolean;
  // Restrição estática por papel — usada quando não faz sentido nenhum nível de staff
  // ver o item (ex: feature nem lançada, ou tela exclusiva da dona).
  roles?: ("admin" | "staff")[];
  // Restrição dinâmica por permissão real (access_level_permissions) — usada nos
  // itens funcionais onde Gerente/Profissional podem legitimamente ter acesso.
  resource?: Resource;
  // Some mesmo com canView(resource)=true quando quem está vendo é kind='own'
  // (Profissional) — usado no Financeiro, que mostra dado agregado do negócio
  // inteiro, sentido pra Gerente/Recepcionista mas não pra quem só vê o próprio
  // recorte (ela tem a visão pessoal real em Meu Espaço).
  hideForOwnKind?: boolean;
};

const items: Item[] = [
  {
    to: "/meu-espaco",
    label: "Meu Espaço",
    icon: User,
    desc: "Sua agenda e comissões",
    roles: ["staff"],
  },
  { to: "/clientes", label: "Clientes", icon: Users, desc: "Fichas e histórico" },
  { to: "/agenda", label: "Agenda", icon: Calendar, desc: "Horários e compromissos" },
  { to: "/servicos", label: "Serviços", icon: Sparkles, desc: "Protocolos e preços" },
  {
    to: "/estoque",
    label: "Estoque",
    icon: Package,
    desc: "Produtos e compras",
    resource: "stock",
  },
  {
    to: "/financeiro",
    label: "Financeiro",
    icon: DollarSign,
    desc: "Caixa, DRE e CFO IA",
    resource: "finance",
    hideForOwnKind: true,
  },
  {
    to: "/marketing",
    label: "Marketing",
    icon: Megaphone,
    desc: "Automações e jornadas",
    roles: ["admin"],
  },
  {
    to: "/whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    desc: "Mensagens e templates",
    roles: ["admin"],
  },
  { to: "/bi", label: "BI", icon: LineChart, desc: "Indicadores e previsões", roles: ["admin"] },
  {
    to: "/aura-ia",
    label: "AURA IA",
    icon: Wand2,
    desc: "Assistente inteligente",
    resource: "aura_ia",
  },
  {
    to: "/equipe",
    label: "Equipe",
    icon: UsersRound,
    desc: "Colaboradores e unidades",
    roles: ["admin"],
  },
  {
    to: "/relatorios",
    label: "Relatórios",
    icon: BarChart3,
    desc: "Indicadores do negócio",
    soon: true,
    roles: ["admin"],
  },
  {
    to: "/venda-rapida",
    label: "Venda rápida",
    icon: ShoppingBag,
    desc: "Pacotes e produtos",
    soon: true,
    roles: ["admin"],
  },
  {
    to: "/anamnese",
    label: "Anamnese",
    icon: FileText,
    desc: "Ficha de avaliação",
    soon: true,
    roles: ["admin"],
  },
  {
    to: "/perfil",
    label: "Perfil",
    icon: Settings,
    desc: "Dados da profissional",
    soon: true,
    roles: ["admin"],
  },
];

// Itens que antes só existiam dentro do Control Center (removido — era uma segunda
// tela de navegação). Cada um agora é sua própria rota/tela real, sem hub no meio.
// Exclusivo da dona, sem exceção — nenhum é ação de equipe (a de equipe de verdade
// já vive em /equipe/permissoes, uma tela separada).
const settingsItems: Item[] = [
  {
    to: "/governanca",
    label: "Centro de Governança",
    icon: LayoutDashboard,
    desc: "Health Score e recomendações",
    roles: ["admin"],
  },
  {
    to: "/empresa",
    label: "Empresa",
    icon: Building2,
    desc: "Dados cadastrais e informações da empresa",
    roles: ["admin"],
  },
  {
    to: "/personalizacao",
    label: "Personalização",
    icon: Palette,
    desc: "Identidade visual e experiência",
    roles: ["admin"],
  },
  {
    to: "/permissoes",
    label: "Permissões",
    icon: Shield,
    desc: "Controle de acessos e permissões",
    roles: ["admin"],
  },
  {
    to: "/seguranca",
    label: "Segurança",
    icon: Lock,
    desc: "Proteção, sessões e autenticação",
    roles: ["admin"],
  },
  {
    to: "/integracoes",
    label: "Integrações",
    icon: Plug,
    desc: "Conexões e sistemas integrados",
    roles: ["admin"],
  },
  {
    to: "/notificacoes",
    label: "Notificações",
    icon: Bell,
    desc: "Alertas, lembretes e comunicações",
    roles: ["admin"],
  },
  {
    to: "/assinatura",
    label: "Assinatura",
    icon: CreditCard,
    desc: "Plano atual, limites e cobranças",
    roles: ["admin"],
  },
  {
    to: "/dados",
    label: "Dados",
    icon: Database,
    desc: "Importação, exportação e migração",
    roles: ["admin"],
  },
  {
    to: "/sistema",
    label: "Sistema",
    icon: Settings2,
    desc: "Configurações gerais e atualizações",
    roles: ["admin"],
  },
];

function ItemCard({ item }: { item: Item }) {
  const Icon = item.icon;
  const content = (
    <div className="relative p-4 rounded-2xl bg-card border border-border/50 hover:border-border transition text-left h-full">
      <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mb-3">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium mb-0.5">{item.label}</div>
      <div className="text-xs text-muted-foreground">{item.desc}</div>
      {item.soon && (
        <span className="absolute top-3 right-3 text-[9px] uppercase tracking-wider text-muted-foreground/70">
          em breve
        </span>
      )}
    </div>
  );

  return item.soon ? (
    <button disabled className="block w-full text-left opacity-70 cursor-not-allowed">
      {content}
    </button>
  ) : (
    <Link to={item.to} className="block w-full">
      {content}
    </Link>
  );
}

function Mais() {
  const { role, canView, isLoading, isOwnKind } = useStaffPermissions();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Caminho da dona nunca espera isLoading — canView já retorna true na hora pra
  // admin, então "role === admin" resolve o item sem depender da permissão real ter
  // carregado. Só staff passa pela checagem de isLoading (evita "aparece e some").
  const hasAccess = (item: Item): boolean => {
    if (item.roles) return !!role && item.roles.includes(role);
    if (item.resource) {
      if (role === "admin") return true;
      if (role !== "staff") return false;
      if (isLoading) return false;
      if (item.hideForOwnKind && isOwnKind) return false;
      return canView(item.resource);
    }
    return true;
  };

  const visible = items.filter(hasAccess);
  const visibleSettings = settingsItems.filter(hasAccess);

  // Logout direto por clique, igual ao antigo botão do menu lateral — nunca roda em
  // beforeLoad/render do servidor, só em resposta a um evento real do navegador.
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <AppShell title="Mais" className="px-4 md:px-8 py-8 md:py-12 max-w-5xl mx-auto pb-24 md:pb-12">
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight mb-2">Tudo em um lugar</h1>
      <p className="text-sm text-muted-foreground mb-8">Acesse todas as áreas do seu negócio.</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {visible.map((item) => (
          <ItemCard key={item.label} item={item} />
        ))}
      </div>

      <div className="mt-10 p-4 rounded-2xl bg-secondary/40 border border-border/40 flex items-start gap-3">
        <HelpCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          As funções marcadas como "em breve" serão liberadas nos próximos passos: financeiro completo, relatórios, campanhas automáticas e venda de pacotes.
        </p>
      </div>

      {visibleSettings.length > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-[0.18em] text-muted-foreground mt-12 mb-3">
            Configurações
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {visibleSettings.map((item) => (
              <ItemCard key={item.label} item={item} />
            ))}
          </div>
        </>
      )}

      <h2 className="text-xs uppercase tracking-[0.18em] text-muted-foreground mt-12 mb-3">Conta</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <button onClick={signOut} className="block w-full text-left">
          <div className="p-4 rounded-2xl bg-card border border-border/50 hover:border-destructive/50 transition text-left h-full">
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mb-3">
              <LogOut className="w-4 h-4 text-destructive" />
            </div>
            <div className="text-sm font-medium mb-0.5 text-destructive">Sair</div>
            <div className="text-xs text-muted-foreground">Encerrar sessão</div>
          </div>
        </button>
      </div>
    </AppShell>
  );
}
