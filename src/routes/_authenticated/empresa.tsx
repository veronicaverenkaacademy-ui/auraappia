import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelHeader, Field, Section } from "@/components/settings-ui";
import { useControlCenter, type ControlCenterState } from "@/lib/control-center";

export const Route = createFileRoute("/_authenticated/empresa")({
  head: () => ({
    meta: [
      { title: "Empresa — AURA" },
      { name: "description", content: "Dados cadastrais e informações públicas do seu negócio." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EmpresaPage,
});

function EmpresaPage() {
  const { state, setState } = useControlCenter();
  const c = state.company;
  const update = (patch: Partial<ControlCenterState["company"]>) =>
    setState((s) => ({ ...s, company: { ...s.company, ...patch } }));

  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <Link to="/mais" className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </Link>

      <div className="space-y-6">
        <PanelHeader title="Empresa" desc="Dados cadastrais e informações públicas do seu negócio." />

        <Section title="Identidade">
          <div className="grid md:grid-cols-2 gap-4 py-2">
            <Field label="Nome fantasia"><Input value={c.fantasyName} onChange={(e) => update({ fantasyName: e.target.value })} /></Field>
            <Field label="Razão social"><Input value={c.legalName} onChange={(e) => update({ legalName: e.target.value })} /></Field>
            <Field label="CNPJ"><Input value={c.cnpj} onChange={(e) => update({ cnpj: e.target.value })} placeholder="00.000.000/0000-00" /></Field>
            <Field label="Inscrição Municipal"><Input value={c.im} onChange={(e) => update({ im: e.target.value })} /></Field>
            <Field label="Inscrição Estadual"><Input value={c.ie} onChange={(e) => update({ ie: e.target.value })} /></Field>
            <Field label="E-mail"><Input value={c.email} onChange={(e) => update({ email: e.target.value })} type="email" /></Field>
          </div>
        </Section>

        <Section title="Endereço">
          <div className="grid md:grid-cols-3 gap-4 py-2">
            <Field label="CEP"><Input value={c.cep} onChange={(e) => update({ cep: e.target.value })} /></Field>
            <Field label="Cidade"><Input value={c.city} onChange={(e) => update({ city: e.target.value })} /></Field>
            <Field label="Estado"><Input value={c.state} onChange={(e) => update({ state: e.target.value })} /></Field>
            <div className="md:col-span-2"><Field label="Endereço"><Input value={c.address} onChange={(e) => update({ address: e.target.value })} /></Field></div>
            <Field label="País"><Input value={c.country} onChange={(e) => update({ country: e.target.value })} /></Field>
          </div>
        </Section>

        <Section title="Contato & Redes">
          <div className="grid md:grid-cols-2 gap-4 py-2">
            <Field label="Telefone"><Input value={c.phone} onChange={(e) => update({ phone: e.target.value })} /></Field>
            <Field label="WhatsApp"><Input value={c.whatsapp} onChange={(e) => update({ whatsapp: e.target.value })} /></Field>
            <Field label="Instagram"><Input value={c.instagram} onChange={(e) => update({ instagram: e.target.value })} placeholder="@" /></Field>
            <Field label="Facebook"><Input value={c.facebook} onChange={(e) => update({ facebook: e.target.value })} /></Field>
            <Field label="TikTok"><Input value={c.tiktok} onChange={(e) => update({ tiktok: e.target.value })} /></Field>
            <Field label="Site"><Input value={c.site} onChange={(e) => update({ site: e.target.value })} /></Field>
          </div>
        </Section>

        <Section title="Localização & Formatos">
          <div className="grid md:grid-cols-2 gap-4 py-2">
            <Field label="Horário comercial"><Input value={c.openHours} onChange={(e) => update({ openHours: e.target.value })} /></Field>
            <Field label="Fuso horário">
              <Select value={c.timezone} onValueChange={(v) => update({ timezone: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
                  <SelectItem value="America/Fortaleza">America/Fortaleza</SelectItem>
                  <SelectItem value="America/Manaus">America/Manaus</SelectItem>
                  <SelectItem value="Europe/Lisbon">Europe/Lisbon</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Idioma">
              <Select value={c.language} onValueChange={(v) => update({ language: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (BR)</SelectItem>
                  <SelectItem value="en-US">English (US)</SelectItem>
                  <SelectItem value="es-ES">Español</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Moeda">
              <Select value={c.currency} onValueChange={(v) => update({ currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">Real (R$)</SelectItem>
                  <SelectItem value="USD">Dólar (US$)</SelectItem>
                  <SelectItem value="EUR">Euro (€)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Formato de data">
              <Select value={c.dateFormat} onValueChange={(v) => update({ dateFormat: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DD/MM/YYYY">DD/MM/AAAA</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/AAAA</SelectItem>
                  <SelectItem value="YYYY-MM-DD">AAAA-MM-DD</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Formato de hora">
              <Select value={c.timeFormat} onValueChange={(v) => update({ timeFormat: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">24 horas</SelectItem>
                  <SelectItem value="12h">12 horas (AM/PM)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
