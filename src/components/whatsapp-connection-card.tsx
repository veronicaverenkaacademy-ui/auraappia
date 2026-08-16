// Card de conexão do WhatsApp — fonte única de verdade da UI de conexão do
// AURA. Consome exclusivamente getWhatsAppStatus/createWhatsAppConnection/
// disconnectWhatsApp/testSendWhatsapp (src/lib/whatsapp/whatsapp.functions.ts),
// que por sua vez falam só com a Evolution através da abstração
// WhatsAppProvider — este componente nunca importa nada de
// src/lib/whatsapp/providers/evolution.server.ts nem de
// src/lib/communication/* (isso é o domínio 360dialog/Meta, preservado no
// código mas fora da experiência atual). Usado por /whatsapp/config; qualquer
// outra tela que precise de conexão deve reaproveitar este componente, nunca
// duplicar a lógica.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, AlertTriangle, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createWhatsAppConnection,
  disconnectWhatsApp,
  getWhatsAppStatus,
  testSendWhatsapp,
} from "@/lib/whatsapp/whatsapp.functions";

const POLL_MS = 4000;

function qrImageSrc(base64: string): string {
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
}

export function WhatsAppConnectionCard() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getWhatsAppStatus);
  const connectFn = useServerFn(createWhatsAppConnection);
  const disconnectFn = useServerFn(disconnectWhatsApp);
  const testSendFn = useServerFn(testSendWhatsapp);

  const [connecting, setConnecting] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);

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
    <section className="rounded-3xl border border-border/60 bg-card p-6 md:p-7">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Conexão do WhatsApp
      </div>

      {isLoading ? (
        <div className="py-6 text-sm text-muted-foreground">Carregando…</div>
      ) : currentStatus === "connected" ? (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-sm font-medium">WhatsApp conectado</span>
          </div>
          {status?.phoneNumber && (
            <div className="text-xs text-muted-foreground">Número: {status.phoneNumber}</div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" className="rounded-full" onClick={handleDisconnect}>
              Desconectar
            </Button>
          </div>
          <div className="pt-4 border-t border-border/50 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Testar envio</div>
            <p className="text-[11px] text-muted-foreground/70">
              Envia uma mensagem de teste para o número informado.
            </p>
            <div className="flex gap-2">
              <Input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="(47) 99999-9999"
              />
              <Button onClick={handleTestSend} disabled={testing} className="rounded-full shrink-0">
                {testing ? "Enviando…" : "Testar envio"}
              </Button>
            </div>
          </div>
        </div>
      ) : currentStatus === "connecting" || qrCode ? (
        <div className="mt-4 py-6 text-center space-y-4">
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
        <div className="mt-4 py-6 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Não foi possível conectar</span>
          </div>
          {status?.lastError && <p className="text-xs text-muted-foreground">{status.lastError}</p>}
          <Button onClick={handleConnect} disabled={connecting} className="rounded-full">
            {connecting ? "Tentando novamente…" : "Tentar novamente"}
          </Button>
        </div>
      ) : (
        <div className="mt-4 py-6 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mx-auto">
            <MessageCircle className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Conecte o WhatsApp da sua empresa à AURA para enviar confirmações e lembretes
            automaticamente.
          </p>
          <Button onClick={handleConnect} disabled={connecting} className="rounded-full">
            {connecting ? "Conectando…" : "Conectar WhatsApp"}
          </Button>
        </div>
      )}
    </section>
  );
}
