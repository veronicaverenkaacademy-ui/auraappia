// Card de conexão do WhatsApp — fonte única de verdade da UI de conexão do
// AURA. Consome exclusivamente getWhatsAppStatus/createWhatsAppConnection/
// disconnectWhatsApp (src/lib/whatsapp/whatsapp.functions.ts), que por sua
// vez falam só com a Evolution através da abstração WhatsAppProvider — este
// componente nunca importa nada de src/lib/whatsapp/providers/evolution.server.ts
// nem de src/lib/communication/* (isso é o domínio 360dialog/Meta, preservado
// no código mas fora da experiência atual). Usado por /whatsapp/config;
// qualquer outra tela que precise de conexão deve reaproveitar este
// componente, nunca duplicar a lógica.
//
// O telefone é sempre exigido antes de gerar qualquer código — é o número
// esperado que o backend usa depois pra validar (via consulta real à
// Evolution) que a sessão que abriu é realmente a desse número. Uma única
// chamada devolve código de pareamento e QR ao mesmo tempo; QR é só uma
// forma alternativa de exibir o mesmo resultado, não uma segunda tentativa.
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
} from "@/lib/whatsapp/whatsapp.functions";

const POLL_MS = 4000;

type ConnectMode = "idle" | "phoneEntry" | "result";

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

/** Número conectado vem do backend em E.164 (+55DDDNUMERO) — só exibição. */
function formatPhoneDisplayBR(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  return formatPhoneBR(local);
}

export function WhatsAppConnectionCard() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getWhatsAppStatus);
  const connectFn = useServerFn(createWhatsAppConnection);
  const disconnectFn = useServerFn(disconnectWhatsApp);

  const [mode, setMode] = useState<ConnectMode>("idle");
  const [connecting, setConnecting] = useState(false);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: (query) => (query.state.data?.status === "connecting" ? POLL_MS : false),
  });

  // Sai do modo de conexão assim que o backend confirmar (webhook ou reconciliação).
  useEffect(() => {
    if (status?.status === "connected") {
      setMode("idle");
      setPairingCode(null);
      setQrCode(null);
      setShowQr(false);
      setConnecting(false);
    }
  }, [status?.status]);

  const resetToIdle = () => {
    setMode("idle");
    setPairingCode(null);
    setQrCode(null);
    setShowQr(false);
    setPhone("");
  };

  /** Limpa qualquer código/QR/erro da tentativa anterior antes de abrir o formulário de telefone. */
  const startNewAttempt = () => {
    setPairingCode(null);
    setQrCode(null);
    setShowQr(false);
    setMode("phoneEntry");
  };

  const handleRequestConnection = async () => {
    if (phone.replace(/\D/g, "").length < 10) {
      toast.error("Digite um telefone válido (com DDD)");
      return;
    }
    setConnecting(true);
    // Limpa qualquer resquício visual de uma tentativa anterior antes de pedir a nova.
    setPairingCode(null);
    setQrCode(null);
    setShowQr(false);
    try {
      const res = await connectFn({ data: { phone } });
      if (res.status === "connected") {
        toast.success("WhatsApp já estava conectado");
        resetToIdle();
      } else if (res.pairingCode || res.qrCodeBase64) {
        setPairingCode(res.pairingCode);
        setQrCode(res.qrCodeBase64);
        setShowQr(!res.pairingCode);
        setMode("result");
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

  const currentStatus = status?.status ?? "pending";
  const showingPairing = mode === "result" && !showQr && pairingCode;
  const showingQr = mode === "result" && (showQr || !pairingCode) && qrCode;

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
            <div className="text-xs text-muted-foreground">
              Número conectado: {formatPhoneDisplayBR(status.phoneNumber)}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" className="rounded-full" onClick={handleDisconnect}>
              Desconectar
            </Button>
          </div>
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
              onClick={handleRequestConnection}
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
      ) : currentStatus === "error" ? (
        <div className="mt-4 py-6 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">
              {status?.lastError || "Não foi possível gerar o código de conexão."}
            </span>
          </div>
          <Button onClick={startNewAttempt} className="rounded-full">
            Tentar novamente
          </Button>
        </div>
      ) : mode === "result" ? (
        <div className="mt-4 py-6 text-center space-y-5">
          {showingPairing ? (
            <>
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
            </>
          ) : showingQr ? (
            <>
              <div className="text-sm font-medium">Escaneie este QR Code pelo WhatsApp</div>
              <img
                src={qrImageSrc(qrCode as string)}
                alt="QR Code de conexão"
                className="mx-auto w-48 h-48 rounded-xl border border-border/50"
              />
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho
              </p>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">
              Não foi possível gerar o código de conexão.
            </div>
          )}

          <div className="text-xs text-muted-foreground/70 pt-1">aguardando conexão…</div>

          {pairingCode && qrCode && (
            <button
              onClick={() => setShowQr((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition"
            >
              <QrCode className="w-3.5 h-3.5" />{" "}
              {showQr ? "Prefere usar o código de pareamento?" : "Prefere conectar usando QR Code?"}
            </button>
          )}

          <div>
            <Button variant="ghost" size="sm" className="rounded-full" onClick={resetToIdle}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : currentStatus === "connecting" ? (
        // Backend é a fonte de verdade: se o status persistido é "connecting"
        // (ex: depois de um reload, quando o modo local volta pra "idle"),
        // mostra que há uma conexão em andamento em vez da tela inicial de
        // "Conectar por código" — e nunca reaproveita um código antigo
        // guardado em estado local (esse já foi limpo no reload).
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
          <Button onClick={startNewAttempt} className="rounded-full">
            Conectar por código
          </Button>
        </div>
      )}
    </section>
  );
}
