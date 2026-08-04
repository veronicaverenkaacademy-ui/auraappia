import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelHeader, Field, Section } from "@/components/settings-ui";
import { useControlCenter, type ControlCenterState } from "@/lib/control-center";

export const Route = createFileRoute("/_authenticated/personalizacao")({
  head: () => ({
    meta: [
      { title: "Personalização — AURA" },
      { name: "description", content: "Identidade visual do sistema, portal e comunicações." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PersonalizacaoPage,
});

function PersonalizacaoPage() {
  const { state, setState } = useControlCenter();
  const b = state.brand;
  const update = (patch: Partial<ControlCenterState["brand"]>) =>
    setState((s) => ({ ...s, brand: { ...s.brand, ...patch } }));

  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <Link to="/mais" className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </Link>

      <div className="space-y-6">
        <PanelHeader title="Personalização" desc="Identidade visual do sistema, portal e comunicações." />

        <Section title="Marca">
          <div className="grid md:grid-cols-2 gap-4 py-2">
            <Field label="Nome da marca"><Input value={b.brandName} onChange={(e) => update({ brandName: e.target.value })} /></Field>
            <Field label="Tema">
              <Select value={b.theme} onValueChange={(v: "light" | "dark" | "auto") => update({ theme: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Claro</SelectItem>
                  <SelectItem value="dark">Escuro</SelectItem>
                  <SelectItem value="auto">Automático</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Section>

        <Section title="Cores">
          <div className="grid md:grid-cols-3 gap-4 py-2">
            {(["primaryColor", "secondaryColor", "accentColor"] as const).map((key, i) => (
              <Field key={key} label={["Cor principal", "Cor secundária", "Cor de destaque"][i]}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={b[key]}
                    onChange={(e) => update({ [key]: e.target.value } as Partial<typeof b>)}
                    className="h-10 w-14 rounded-lg border border-border cursor-pointer bg-transparent"
                  />
                  <Input value={b[key]} onChange={(e) => update({ [key]: e.target.value } as Partial<typeof b>)} className="uppercase" />
                </div>
              </Field>
            ))}
          </div>
        </Section>

        <Section title="Tipografia & Formas">
          <div className="grid md:grid-cols-2 gap-4 py-2">
            <Field label="Fonte títulos"><Input value={b.fontHeading} onChange={(e) => update({ fontHeading: e.target.value })} /></Field>
            <Field label="Fonte corpo"><Input value={b.fontBody} onChange={(e) => update({ fontBody: e.target.value })} /></Field>
            <div className="md:col-span-2">
              <Field label={`Raio das bordas — ${b.borderRadius}px`}>
                <Slider min={0} max={32} step={1} value={[b.borderRadius]} onValueChange={(v) => update({ borderRadius: v[0] })} />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Portal da Cliente">
          <div className="space-y-4 py-2">
            <Field label="Mensagem de boas-vindas">
              <Textarea rows={2} value={b.welcomeMessage} onChange={(e) => update({ welcomeMessage: e.target.value })} />
            </Field>
            <Field label="Imagem de capa (URL)" hint="Recomendado 2400×1200px, JPEG.">
              <Input value={b.portalCover} onChange={(e) => update({ portalCover: e.target.value })} placeholder="https://..." />
            </Field>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
