import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Shield } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { StubPanel } from "@/components/settings-ui";

export const Route = createFileRoute("/_authenticated/permissoes")({
  head: () => ({
    meta: [
      { title: "Permissões — AURA" },
      { name: "description", content: "Controle granular de acesso por módulo e ação." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PermissoesPage,
});

function PermissoesPage() {
  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <Link to="/mais" className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </Link>
      <StubPanel title="Permissões" desc="Controle granular de acesso por módulo e ação." icon={Shield} />
    </AppShell>
  );
}
