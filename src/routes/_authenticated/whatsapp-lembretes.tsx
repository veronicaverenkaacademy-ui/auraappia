import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, CheckCircle2, AlertTriangle, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PanelHeader, Field, Row, Section, Card } from "@/components/settings-ui";
import {
  createWhatsAppConnection,
  disconnectWhatsApp,
  getWhatsAppStatus,
  testSendWhatsapp,
} from "@/lib/whatsapp/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/whatsapp-lembretes")({
  head: () => ({
    meta: [
      { title: "WhatsApp — Lembretes — AURA" },
      {
        name: "description",
        content: "Conecte o WhatsApp para enviar confirmações e lembretes automáticos.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WhatsAppLembretesPage,
});

// Enquanto "connecting", faz polling do status — a confirmação real de que o QR
// foi escaneado chega via webhook (server-side), então o front só reflete o que
// já está salvo no banco a cada poll, nunca fala direto com a Evolution.
const POLL_MS = 4000;

function qrImageSrc(base64: string): string {
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
}

function WhatsAppLembretesPage() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getWhatsAppStatus);
  const connectFn = useServerFn(createWhatsAppConnection);
  const disconnectFn = useServerFn(disconnectWhatsApp);
  const testSendFn = useServerFn(testSendWhatsapp);

  const [connecting, setConnecting] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [automation, setAutomation] = useState({
    confirmation: true,
    reminder24h: true,
    reminder2h: true,
  });

  const { data: status, isLoading } = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: (query) => (query.state.data?.status === "connecting" ? POLL_MS : false),
  });

  // Sai do modo "mostrando QR" assim que o webhook confirmar a conexão.
  useEffect(() => {
    if (status?.status === "connected") {
      setQrCode(null);
      setConnecting(false);
    }
  }, [status?.status]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await connectFn();
      if (res.status === "connected") {
        toast.success("WhatsApp já estava conectado");
      } else if (res.qrCodeBase64) {
        setQrCode(res.qrCodeBase64);
      } else {
        toast.error("Não foi possível gerar o QR Code agora. Tente novamente.");
      }
      await qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível conectar o WhatsApp.");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectFn();
      setQrCode(null);
      await qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
      toast.success("WhatsApp desconectado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desconectar.");
    }
  };

  const handleTestSend = async () => {
    if (!testPhone.trim()) {
      toast.error("Digite um telefone para o teste");
      return;
    }
    setTesting(true);
    try {
      const res = await testSendFn({ data: { phone: testPhone } });
      if (res.ok) toast.success("Mensagem de teste enviada");
      else toast.error(res.error);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar teste.");
    } finally {
      setTesting(false);
    }
  };

  const currentStatus = status?.status ?? "pending";

  return (
    <AppShell className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto pb-28 md:pb-12">
      <Link to="/mais" className="inline-flex">
        <Button variant="ghost" size="icon" className="rounded-full mb-4">
          <ChevronLeft className="w-5 h-5" />
        </Button>
      </Link>

      <div className="space-y-6">
        <PanelHeader
          title="WhatsApp — Lembretes"
          desc="Conexão provisória via QR Code para confirmações e lembretes automáticos às clientes."
        />

        <Section title="Conexão">
          {isLoading ? (
            <div className="py-6 text-sm text-muted-foreground">Carregando…</div>
          ) : currentStatus === "connected" ? (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm font-medium">WhatsApp conectado</span>
              </div>
              {status?.phoneNumber && (
                <div className="text-xs text-muted-foreground">Número: {status.phoneNumber}</div>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={handleDisconnect}
                >
                  Desconectar
                </Button>
              </div>
              <div className="pt-4 border-t border-border/50 space-y-2">
                <Field
                  label="Testar envio"
                  hint="Envia uma mensagem de teste para o número informado."
                >
                  <div className="flex gap-2">
                    <Input
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="(47) 99999-9999"
                    />
                    <Button
                      onClick={handleTestSend}
                      disabled={testing}
                      className="rounded-full shrink-0"
                    >
                      {testing ? "Enviando…" : "Testar envio"}
                    </Button>
                  </div>
                </Field>
              </div>
            </div>
          ) : currentStatus === "connecting" || qrCode ? (
            <div className="py-6 text-center space-y-4">
              <div className="text-sm font-medium">Escaneie este QR Code pelo WhatsApp</div>
              {qrCode ? (
                <img
                  src={qrImageSrc(qrCode)}
                  alt="QR Code de conexão"
                  className="mx-auto w-48 h-48 rounded-xl border border-border/50"
                />
              ) : (
                <div className="mx-auto w-48 h-48 rounded-xl border border-dashed border-border/50 flex items-center justify-center text-xs text-muted-foreground">
                  Gerando QR Code…
                </div>
              )}
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho
              </p>
            </div>
          ) : currentStatus === "error" ? (
            <div className="py-6 text-center space-y-3">
              <div className="flex items-center justify-center gap-2 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">Não foi possível conectar</span>
              </div>
              {status?.lastError && (
                <p className="text-xs text-muted-foreground">{status.lastError}</p>
              )}
              <Button onClick={handleConnect} disabled={connecting} className="rounded-full">
                {connecting ? "Tentando novamente…" : "Tentar novamente"}
              </Button>
            </div>
          ) : (
            <div className="py-6 text-center space-y-3">
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mx-auto">
                <MessageCircle className="w-4 h-4 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Seu WhatsApp ainda não está conectado. Conecte para que o AURA envie automaticamente
                confirmações e lembretes de agendamento.
              </p>
              <Button onClick={handleConnect} disabled={connecting} className="rounded-full">
                {connecting ? "Conectando…" : "Conectar WhatsApp"}
              </Button>
            </div>
          )}
        </Section>

        <Section title="Automação de WhatsApp">
          <Row title="Enviar confirmação automática" desc="Quando um agendamento é confirmado.">
            <Switch
              checked={automation.confirmation}
              onCheckedChange={(v) => setAutomation((s) => ({ ...s, confirmation: v }))}
            />
          </Row>
          <Row title="Lembrete 24h antes">
            <Switch
              checked={automation.reminder24h}
              onCheckedChange={(v) => setAutomation((s) => ({ ...s, reminder24h: v }))}
            />
          </Row>
          <Row title="Lembrete 2h antes">
            <Switch
              checked={automation.reminder2h}
              onCheckedChange={(v) => setAutomation((s) => ({ ...s, reminder2h: v }))}
            />
          </Row>
          <p className="text-[11px] text-muted-foreground/70 pt-2">
            Templates padrão neste MVP — personalização de mensagem fica para uma etapa futura.
          </p>
        </Section>

        <Card className="p-4">
          <p className="text-[11px] text-muted-foreground/70">
            Integração provisória via Evolution API (QR Code), para um grupo pequeno de teste. Será
            substituída por uma integração oficial (Meta Cloud API/360dialog) futuramente, sem
            impacto na agenda ou nas clientes.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
