import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useCurrentRole } from "@/hooks/use-role";
import {
  Users,
  Calendar,
  Package,
  Sparkles,
  DollarSign,
  BarChart3,
  Megaphone,
  ShoppingBag,
  FileText,
  Settings,
  HelpCircle,
  MessageCircle,
  LineChart,
  Wand2,
  UsersRound,
  User,
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
  // Mesma restrição que existia no menu lateral removido — sem isso, um perfil
  // "staff" passaria a ver (e tentar abrir) áreas que antes ficavam escondidas.
  roles?: ("admin" | "staff")[];
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
  { to: "/estoque", label: "Estoque", icon: Package, desc: "Produtos e compras", roles: ["admin"] },
  {
    to: "/financeiro",
    label: "Financeiro",
    icon: DollarSign,
    desc: "Caixa, DRE e CFO IA",
    roles: ["admin"],
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
    roles: ["admin"],
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
  },
  {
    to: "/venda-rapida",
    label: "Venda rápida",
    icon: ShoppingBag,
    desc: "Pacotes e produtos",
    soon: true,
  },
  { to: "/anamnese", label: "Anamnese", icon: FileText, desc: "Ficha de avaliação", soon: true },
  { to: "/perfil", label: "Perfil", icon: Settings, desc: "Dados da profissional", soon: true },
];

function Mais() {
  const { data: role } = useCurrentRole();
  const visible = items.filter((item) => !item.roles || (role && item.roles.includes(role)));

  return (
    <AppShell
      title="Mais"
      right={
        <Link
          to="/configuracoes"
          className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-secondary transition"
          aria-label="Control Center"
        >
          <Settings className="w-4 h-4 text-muted-foreground" />
        </Link>
      }
      className="px-4 md:px-8 py-8 md:py-12 max-w-5xl mx-auto pb-24 md:pb-12"
    >
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight mb-2">
        Tudo em um lugar
      </h1>
      <p className="text-sm text-muted-foreground mb-8">Acesse todas as áreas do seu negócio.</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {visible.map((item) => {
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
            <button
              key={item.label}
              disabled
              className="block w-full text-left opacity-70 cursor-not-allowed"
            >
              {content}
            </button>
          ) : (
            <Link key={item.label} to={item.to} className="block w-full">
              {content}
            </Link>
          );
        })}
      </div>

      <div className="mt-10 p-4 rounded-2xl bg-secondary/40 border border-border/40 flex items-start gap-3">
        <HelpCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          As funções marcadas como "em breve" serão liberadas nos próximos passos: financeiro
          completo, relatórios, campanhas automáticas e venda de pacotes.
        </p>
      </div>
    </AppShell>
  );
}
