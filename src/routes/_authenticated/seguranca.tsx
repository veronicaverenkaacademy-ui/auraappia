import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ScrollText } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelHeader, Field, Row, Section } from "@/components/settings-ui";
import { useControlCenter, type ControlCenterState } from "@/lib/control-center";

export const Route = createFileRoute("/_authenticated/seguranca")({
  head: () => ({
    meta: [
      { title: "Segurança — AURA" },
      { name: "description", content: "Autenticação, sessões, LGPD, backups e auditoria." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SegurancaPage,
});

function SegurancaPage() {
  const { state, setState } = useControlCenter();
  const s = state.security;
  const b = state.backup;
  const updateSec = (patch: Partial<ControlCenterState["security"]>) =>
    setState((st) => ({ ...st, security: { ...st.security, ...patch } }));
  const updateBk = (patch: Partial<ControlCenterState["backup"]>) =>
    setState((st) => ({ ...st, backup: { ...st.backup, ...patch } }));

  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <Link to="/mais" className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </Link>

      <div className="space-y-6">
        <PanelHeader title="Segurança e Privacidade" desc="Autenticação, sessões, LGPD, backups e auditoria." />

        <Section title="Autenticação">
          <Row title="Autenticação em dois fatores (2FA)" desc="Camada extra de proteção via app autenticador.">
            <Switch checked={s.twoFA} onCheckedChange={(v) => updateSec({ twoFA: v })} />
          </Row>
          <Row title="Login por SMS"><Switch checked={s.smsLogin} onCheckedChange={(v) => updateSec({ smsLogin: v })} /></Row>
          <Row title="Login com Google"><Switch checked={s.google} onCheckedChange={(v) => updateSec({ google: v })} /></Row>
          <Row title="Login com Apple"><Switch checked={s.apple} onCheckedChange={(v) => updateSec({ apple: v })} /></Row>
        </Section>

        <Section title="Sessões">
          <div className="grid md:grid-cols-2 gap-4 py-2">
            <Field label={`Timeout automático — ${s.sessionTimeoutMin} min`}>
              <Slider min={15} max={240} step={15} value={[s.sessionTimeoutMin]} onValueChange={(v) => updateSec({ sessionTimeoutMin: v[0] })} />
            </Field>
            <Field label={`Troca obrigatória de senha — ${s.forcePasswordChangeDays || "desativado"}${s.forcePasswordChangeDays ? " dias" : ""}`}>
              <Slider min={0} max={180} step={30} value={[s.forcePasswordChangeDays]} onValueChange={(v) => updateSec({ forcePasswordChangeDays: v[0] })} />
            </Field>
          </div>
        </Section>

        <Section title="LGPD & Auditoria">
          <Row title="Consentimentos LGPD ativos" desc="Termos e coleta de aceites publicados.">
            <Switch checked={s.lgpdConsent} onCheckedChange={(v) => updateSec({ lgpdConsent: v })} />
          </Row>
          <Row title="Criptografia em repouso" desc="Todos os dados sensíveis são criptografados.">
            <Switch checked={s.encryptionAtRest} onCheckedChange={(v) => updateSec({ encryptionAtRest: v })} />
          </Row>
          <Row title="Log de auditoria" desc="Registra todas as ações administrativas.">
            <Switch checked={s.auditLogs} onCheckedChange={(v) => updateSec({ auditLogs: v })} />
          </Row>
        </Section>

        <Section title="Backup">
          <Row title="Backup automático" desc={b.lastBackupAt ? `Último backup: ${new Date(b.lastBackupAt).toLocaleString("pt-BR")}` : "Nunca executado"}>
            <Switch checked={b.autoBackup} onCheckedChange={(v) => updateBk({ autoBackup: v, lastBackupAt: v ? new Date().toISOString() : b.lastBackupAt })} />
          </Row>
          <div className="grid md:grid-cols-2 gap-4 py-3">
            <Field label="Frequência">
              <Select value={b.frequency} onValueChange={(v: ControlCenterState["backup"]["frequency"]) => updateBk({ frequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Diário</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                  <SelectItem value="monthly">Mensal</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={`Retenção — ${b.retentionDays} dias`}>
              <Slider min={7} max={365} step={7} value={[b.retentionDays]} onValueChange={(v) => updateBk({ retentionDays: v[0] })} />
            </Field>
          </div>
          <div className="flex gap-2 pt-1 pb-2">
            <Button size="sm" variant="outline" className="rounded-full"
              onClick={() => updateBk({ lastBackupAt: new Date().toISOString() })}>
              Executar backup agora
            </Button>
            <Button size="sm" variant="ghost" className="rounded-full">Restaurar</Button>
          </div>
        </Section>

        <Section title="Documentos legais">
          <div className="grid md:grid-cols-3 gap-3 py-2">
            {["Termos de Uso", "Política de Privacidade", "Contrato de Serviço", "Consentimento LGPD", "Consentimento Fotos", "Anamnese"].map((d) => (
              <div key={d} className="p-4 rounded-xl bg-secondary/50 flex items-start gap-3">
                <ScrollText className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{d}</div>
                  <div className="text-[11px] text-muted-foreground">v1.0 · publicado</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
