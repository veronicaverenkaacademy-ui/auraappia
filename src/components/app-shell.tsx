import { useIsMobile } from "@/hooks/use-mobile";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

type AppShellProps = {
  children: ReactNode;
  title?: ReactNode;
  right?: ReactNode;
  className?: string;
};

export function AppShell({ children, title, right, className }: AppShellProps) {
  const isMobile = useIsMobile();
  const titleIsString = typeof title === "string";

  return (
    <div className="min-h-screen flex w-full bg-background">
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center gap-3 px-4 md:px-8 border-b border-border/50">
          {title && (
            <div
              className={cn(
                "min-w-0",
                titleIsString && "text-xs text-muted-foreground uppercase tracking-wider",
              )}
            >
              {title}
            </div>
          )}
          {right && <div className="ml-auto flex items-center gap-2 shrink-0">{right}</div>}
        </header>

        <main className={cn("flex-1 w-full min-w-0", className)}>{children}</main>

        {isMobile && <MobileBottomNav className="fixed bottom-0 left-0 right-0 md:hidden" />}
      </div>
    </div>
  );
}
