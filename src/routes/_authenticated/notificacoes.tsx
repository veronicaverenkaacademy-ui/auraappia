import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PanelHeader, Field, Row, Section } from "@/components/settings-ui";
import { useControlCenter, type ControlCenterState } from "@/lib/control-center";

export const Route = createFileRoute("/_authenticated/notificacoes")({
  head: () => ({
    meta: [
      { title: "Notificações — AURA" },
      { name: "description", content: "Canais, tópicos e horários silenciosos." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NotificacoesPage,
});

function NotificacoesPage() {
  const { state, setState } = useControlCenter();
  const n = state.notifications;
  const update = (patch: Partial<ControlCenterState["notifications"]>) =>
    setState((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));

  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <Link to="/mais" className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </Link>

      <div className="space-y-6">
        <PanelHeader title="Notificações" desc="Canais, tópicos e horários silenciosos." />

        <Section title="Canais">
          {(Object.keys(n.channels) as (keyof typeof n.channels)[]).map((k) => (
            <Row key={k} title={k.charAt(0).toUpperCase() + k.slice(1)}>
              <Switch checked={n.channels[k]} onCheckedChange={(v) => update({ channels: { ...n.channels, [k]: v } })} />
            </Row>
          ))}
        </Section>

        <Section title="Tópicos">
          {(Object.keys(n.topics) as (keyof typeof n.topics)[]).map((k) => (
            <Row key={k} title={{
              reminders: "Lembretes de agenda",
              campaigns: "Campanhas de marketing",
              ai: "Insights da Aura IA",
              finance: "Alertas financeiros",
              agenda: "Movimentações na agenda",
              stock: "Alertas de estoque",
            }[k]}>
              <Switch checked={n.topics[k]} onCheckedChange={(v) => update({ topics: { ...n.topics, [k]: v } })} />
            </Row>
          ))}
        </Section>

        <Section title="Silêncio & Resumos">
          <div className="grid md:grid-cols-2 gap-4 py-2">
            <Field label="Silenciar a partir de"><Input type="time" value={n.quietStart} onChange={(e) => update({ quietStart: e.target.value })} /></Field>
            <Field label="Retomar às"><Input type="time" value={n.quietEnd} onChange={(e) => update({ quietEnd: e.target.value })} /></Field>
          </div>
          <Row title="Resumo diário"><Switch checked={n.dailyDigest} onCheckedChange={(v) => update({ dailyDigest: v })} /></Row>
          <Row title="Resumo semanal"><Switch checked={n.weeklyDigest} onCheckedChange={(v) => update({ weeklyDigest: v })} /></Row>
          <Row title="Resumo mensal"><Switch checked={n.monthlyDigest} onCheckedChange={(v) => update({ monthlyDigest: v })} /></Row>
        </Section>
      </div>
    </AppShell>
  );
}

