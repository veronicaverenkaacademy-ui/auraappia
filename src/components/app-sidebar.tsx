import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Calendar, Users, Package, DollarSign, Sparkles, LogOut, Megaphone, Wand2, MessageCircle, BarChart3, SlidersHorizontal, UsersRound, User } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentRole } from "@/hooks/use-role";

type Item = { title: string; url: string; icon: typeof LayoutDashboard; soon?: boolean; roles?: ("admin" | "staff")[] };

const items: Item[] = [
  { title: "Hoje", url: "/dashboard", icon: LayoutDashboard },
  { title: "Meu Espaço", url: "/meu-espaco", icon: User, roles: ["staff"] },
  { title: "Agenda", url: "/agenda", icon: Calendar },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "Serviços", url: "/servicos", icon: Sparkles },
  { title: "Estoque", url: "/estoque", icon: Package, roles: ["admin"] },
  { title: "Financeiro", url: "/financeiro", icon: DollarSign, roles: ["admin"] },
  { title: "Marketing", url: "/marketing", icon: Megaphone, roles: ["admin"] },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle, roles: ["admin"] },
  { title: "BI", url: "/bi", icon: BarChart3, roles: ["admin"] },
  { title: "AURA IA", url: "/aura-ia", icon: Wand2, roles: ["admin"] },
  { title: "Equipe", url: "/equipe", icon: UsersRound, roles: ["admin"] },
];

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: role } = useCurrentRole();

  const visible = items.filter((it) => !it.roles || (role && it.roles.includes(role)));

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-6">
        {!collapsed ? (
          <div className="text-xl font-display font-medium tracking-tight">AURA</div>
        ) : (
          <div className="text-xl font-display font-medium">A</div>
        )}
      </SidebarHeader>

      <SidebarContent className="px-3">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {visible.map((item) => {
                const active = pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild={!item.soon}
                      isActive={active}
                      disabled={item.soon}
                      className="h-10 rounded-xl"
                      onClick={() => setOpenMobile(false)}
                    >
                      {item.soon ? (
                        <div className="flex items-center gap-3 text-muted-foreground/60 cursor-not-allowed">
                          <item.icon className="w-4 h-4" />
                          {!collapsed && (
                            <span className="flex-1 flex items-center justify-between">
                              <span>{item.title}</span>
                              <span className="text-[10px] uppercase tracking-wider opacity-60">em breve</span>
                            </span>
                          )}
                        </div>
                      ) : (
                        <Link to={item.url} className="flex items-center gap-3">
                          <item.icon className="w-4 h-4" />
                          {!collapsed && <span>{item.title}</span>}
                        </Link>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 gap-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="h-10 rounded-xl" isActive={pathname.startsWith("/configuracoes")}>
              <Link to="/configuracoes" className="flex items-center gap-3">
                <SlidersHorizontal className="w-4 h-4" />
                {!collapsed && <span>Control Center</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={signOut} className="h-10 rounded-xl">
              <LogOut className="w-4 h-4" />
              {!collapsed && <span>Sair</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}