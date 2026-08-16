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
//
// Fluxo principal: código de pareamento (a profissional normalmente está no
// mesmo celular que tem o WhatsApp a conectar). QR Code fica como alternativa
// secundária, sem alteração de comportamento além do necessário pra caber
// nesse novo layout.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, AlertTriangle, MessageCircle, Copy, QrCode } from "lucide-react";
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

type ConnectMode = "idle" | "phoneEntry" | "pairing" | "qrcode";

function qrImageSrc(base64: string): string {
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
}

/** Só formatação visual — o backend normaliza e valida de verdade, nunca confia na máscara. */
function formatPhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function WhatsAppConnectionCard() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getWhatsAppStatus);
  const connectFn = useServerFn(createWhatsAppConnection);
  const disconnectFn = useServerFn(disconnectWhatsApp);
  const testSendFn = useServerFn(testSendWhatsapp);

  const [mode, setMode] = useState<ConnectMode>("idle");
  const [connecting, setConnecting] = useState(false);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: (query) => (query.state.data?.status === "connecting" ? POLL_MS : false),
  });

  // Sai do modo "aguardando pareamento" assim que o webhook confirmar a conexão.
  useEffect(() => {
    if (status?.status === "connected") {
      setMode("idle");
      setPairingCode(null);
      setQrCode(null);
      setConnecting(false);
    }
  }, [status?.status]);

  const resetToIdle = () => {
    setMode("idle");
    setPairingCode(null);
    setQrCode(null);
    setPhone("");
  };

  const handleRequestPairingCode = async () => {
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Digite um telefone válido (com DDD)");
      return;
    }
    setConnecting(true);
    try {
      const res = await connectFn({ data: { phone } });
      if (res.status === "connected") {
        toast.success("WhatsApp já estava conectado");
        resetToIdle();
      } else if (res.pairingCode) {
        setPairingCode(res.pairingCode);
        setMode("pairing");
      } else {
        toast.error("Não foi possível gerar o código de conexão.");
      }
      await qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o código de conexão.");
    } finally {
      setConnecting(false);
    }
  };

  const handleUseQrCode = async () => {
    setMode("qrcode");
    setConnecting(true);
    try {
      const res = await connectFn({ data: {} });
      if (res.status === "connected") {
        toast.success("WhatsApp já estava conectado");
        resetToIdle();
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

  const handleCopyCode = async () => {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode);
      toast.success("Código copiado");
    } catch {
      toast.error("Não foi possível copiar — selecione o código manualmente.");
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectFn();
      resetToIdle();
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
            <span className="text-sm font-medium">WhatsApp conectado ✓</span>
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
      ) : currentStatus === "error" ? (
        <div className="mt-4 py-6 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Não foi possível gerar o código de conexão.</span>
          </div>
          <Button onClick={resetToIdle} className="rounded-full">
            Tentar novamente
          </Button>
        </div>
      ) : mode === "pairing" && pairingCode ? (
        <div className="mt-4 py-6 text-center space-y-5">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Seu código de conexão
          </div>
          <div className="text-4xl font-display font-semibold tracking-[0.3em] py-2">
            {pairingCode}
          </div>
          <Button onClick={handleCopyCode} variant="outline" className="rounded-full">
            <Copy className="w-3.5 h-3.5 mr-1.5" /> Copiar código
          </Button>
          <div className="max-w-xs mx-auto space-y-2 text-xs text-muted-foreground">
            <p>
              Agora abra o WhatsApp neste celular e siga: WhatsApp → Configurações → Aparelhos
              conectados → Conectar aparelho → Conectar com número de telefone.
            </p>
            <p>Digite o código acima no WhatsApp para conectar este aparelho ao AURA.</p>
          </div>
          <div className="text-xs text-muted-foreground/70 pt-1">aguardando conexão…</div>
        </div>
      ) : mode === "phoneEntry" ? (
        <div className="mt-4 py-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Informe o número do WhatsApp que será conectado ao AURA.
          </p>
          <Input
            value={phone}
            onChange={(e) => setPhone(formatPhoneBR(e.target.value))}
            placeholder="(47) 99999-9999"
            inputMode="numeric"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleRequestPairingCode}
              disabled={connecting}
              className="rounded-full"
            >
              {connecting ? "Gerando código…" : "Confirmar"}
            </Button>
            <Button variant="ghost" size="sm" className="rounded-full" onClick={resetToIdle}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : mode === "qrcode" ? (
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
              {connecting ? "Gerando QR Code…" : "Não foi possível gerar o QR Code."}
            </div>
          )}
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho
          </p>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={resetToIdle}>
            Voltar
          </Button>
        </div>
      ) : currentStatus === "connecting" ? (
        // Backend é a fonte de verdade: se o status persistido é "connecting"
        // (ex: depois de um reload, quando o modo local volta pra "idle"),
        // mostra que há uma conexão em andamento em vez da tela inicial de
        // "Conectar por código" — evita sugerir que nada foi feito ainda.
        <div className="mt-4 py-6 text-center space-y-4">
          <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mx-auto">
            <MessageCircle className="w-4 h-4 text-muted-foreground animate-pulse" />
          </div>
          <div className="text-sm font-medium">Aguardando confirmação da conexão…</div>
          <p className="text-xs text-muted-foreground max-w-xs mx-auto">
            Finalize a conexão no seu WhatsApp (Aparelhos conectados). Isso pode levar alguns
            segundos.
          </p>
        </div>
      ) : (
        <div className="mt-4 py-6 text-center space-y-4">
          <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mx-auto">
            <MessageCircle className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Conecte seu WhatsApp à AURA para que ela possa enviar confirmações, lembretes e atender
            suas clientes.
          </p>
          <Button onClick={() => setMode("phoneEntry")} className="rounded-full">
            Conectar por código
          </Button>
          <p className="text-[11px] text-muted-foreground/70 max-w-xs mx-auto">
            Está usando o AURA neste mesmo celular? Conecte seu WhatsApp usando um código de
            pareamento.
          </p>
          <div className="pt-2">
            <button
              onClick={handleUseQrCode}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
            >
              <QrCode className="w-3.5 h-3.5" /> Prefere conectar usando QR Code?
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
