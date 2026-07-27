import { Link, useRouterState } from "@tanstack/react-router";
import { Calendar, Home, MoreHorizontal, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/dashboard", label: "Início", icon: Home },
  { to: "/agenda", label: "Agenda", icon: Calendar },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/aura-ia", label: "AURA IA", icon: Sparkles },
  { to: "/mais", label: "Mais", icon: MoreHorizontal },
];

export function MobileBottomNav({ className }: { className?: string }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <nav
      className={cn(
        "bg-background/80 backdrop-blur-xl border-t border-border/50 z-50",
        "pb-[env(safe-area-inset-bottom)]",
        className
      )}
    >
      <div className="flex items-center justify-around h-16 px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = pathname === tab.to;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "flex flex-col items-center justify-center gap-1 w-16 h-14 rounded-2xl transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("w-5 h-5", active && "text-primary")} strokeWidth={active ? 2.5 : 2} />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
