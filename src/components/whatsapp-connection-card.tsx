// Card de conexão do WhatsApp — fonte única de verdade da UI de conexão do
// AURA. A experiência pública de conexão é Meta Cloud API via Embedded
// Signup — este componente nunca chama evolutionWhatsAppProvider,
// createWhatsAppConnection nem nada específico de QR Code/pareamento.
// Consome getWhatsAppStatus/disconnectWhatsApp (provider-aware desde a PR
// #56) e completeMetaEmbeddedSignup (whatsapp-meta-connect.functions.ts) —
// nunca connectMetaWhatsAppManual, que é só a ferramenta de diagnóstico
// interno (whatsapp-meta-admin.functions.ts / rota /admin-teste-meta),
// nunca a experiência pública.
//
// IMPORTANTE: a integração com o SDK JS da Meta abaixo (window.FB, evento
// "WA_EMBEDDED_SIGNUP" via postMessage) segue a implementação oficial
// documentada em
// developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
// mas não foi testada contra uma autorização real — este ambiente não tem
// rede de saída pra graph.facebook.com nem pra carregar
// connect.facebook.net. Precisa de validação manual na aplicação publicada
// antes de ser considerada funcional (ver checklist no PR).
//
// Pré-requisitos pra esse botão funcionar de verdade: VITE_META_APP_ID e
// VITE_META_EMBEDDED_SIGNUP_CONFIG_ID configurados — sem eles, mostra aviso
// claro em vez de abrir um popup quebrado.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, AlertTriangle, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { disconnectWhatsApp, getWhatsAppStatus } from "@/lib/whatsapp/whatsapp.functions";
import { completeMetaEmbeddedSignup } from "@/lib/whatsapp/whatsapp-meta-connect.functions";

const GRAPH_API_VERSION = "v26.0"; // deve acompanhar META_GRAPH_API_VERSION (meta-cloud-api.server.ts)
const FACEBOOK_SDK_URL = "https://connect.facebook.net/pt_BR/sdk.js";
const EMBEDDED_SIGNUP_ORIGINS = ["https://www.facebook.com", "https://web.facebook.com"];

type FacebookLoginResponse = { authResponse?: { code?: string } | null; status?: string };

declare global {
  interface Window {
    FB?: {
      init: (params: { appId: string; xfbml: boolean; version: string }) => void;
      login: (
        callback: (response: FacebookLoginResponse) => void,
        options: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

/** Número conectado vem do backend em E.164 (+55DDDNUMERO) — só exibição. */
function formatPhoneDisplayBR(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length <= 2) return local;
  if (local.length <= 7) return `(${local.slice(0, 2)}) ${local.slice(2)}`;
  return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
}

/** Carrega o SDK JS da Meta uma única vez e chama FB.init quando pronto. */
function useFacebookSdk(appId: string | undefined): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!appId) return;
    if (window.FB) {
      setReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, xfbml: false, version: GRAPH_API_VERSION });
      setReady(true);
    };
    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = FACEBOOK_SDK_URL;
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
  }, [appId]);

  return ready;
}

export function WhatsAppConnectionCard() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getWhatsAppStatus);
  const disconnectFn = useServerFn(disconnectWhatsApp);
  const completeSignupFn = useServerFn(completeMetaEmbeddedSignup);

  const appId = import.meta.env.VITE_META_APP_ID as string | undefined;
  const configId = import.meta.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID as string | undefined;
  const sdkReady = useFacebookSdk(appId);
  const [connecting, setConnecting] = useState(false);

  // Guarda phone_number_id/waba_id do evento que a Meta dispara via
  // postMessage durante a autorização — chega separado do "code" que o
  // callback do FB.login devolve, então precisa ficar disponível quando o
  // callback rodar. Ref (não state) porque é lido dentro de um callback
  // assíncrono do SDK, fora do ciclo de render do React.
  const signupDataRef = useRef<{ phoneNumberId: string; wabaId: string } | null>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!EMBEDDED_SIGNUP_ORIGINS.includes(event.origin)) return;
      try {
        const data = JSON.parse(event.data as string) as {
          type?: string;
          event?: string;
          data?: { phone_number_id?: string; waba_id?: string };
        };
        if (data.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH" && data.data) {
          const { phone_number_id, waba_id } = data.data;
          if (phone_number_id && waba_id) {
            signupDataRef.current = { phoneNumberId: phone_number_id, wabaId: waba_id };
          }
        }
      } catch {
        // Mensagem de outra origem/formato que não é do Embedded Signup — ignora.
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const { data: status, isLoading } = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => fetchStatus(),
  });

  const handleDisconnect = async () => {
    try {
      await disconnectFn();
      await qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
      toast.success("WhatsApp desconectado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desconectar.");
    }
  };

  const finishSignup = async (code: string) => {
    const signupData = signupDataRef.current;
    if (!signupData) {
      toast.error("Não foi possível identificar o número selecionado na autorização.");
      return;
    }
    setConnecting(true);
    try {
      const res = await completeSignupFn({
        data: { code, phoneNumberId: signupData.phoneNumberId, wabaId: signupData.wabaId },
      });
      if (res.ok) {
        toast.success("WhatsApp conectado!");
        await qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir a conexão.");
    } finally {
      setConnecting(false);
      signupDataRef.current = null;
    }
  };

  const handleConnectClick = () => {
    if (!appId || !configId) {
      toast.error("Conectar WhatsApp ainda não está configurado — fale com o suporte do AURA.");
      return;
    }
    if (!sdkReady || !window.FB) {
      toast.error("Ainda carregando a conexão com a Meta — tente de novo em instantes.");
      return;
    }
    signupDataRef.current = null;
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          toast.error("Autorização cancelada ou não concluída.");
          return;
        }
        // O evento com phone_number_id/waba_id chega por postMessage, quase
        // junto com o callback mas sem garantia de ordem síncrona — um
        // pequeno atraso dá tempo dele já ter sido capturado pelo listener
        // acima antes de tentarmos ler signupDataRef.
        setTimeout(() => {
          void finishSignup(code);
        }, 500);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { sessionInfoVersion: "3" },
      },
    );
  };

  const connected = status?.status === "connected";

  return (
    <section className="rounded-3xl border border-border/60 bg-card p-6 md:p-7">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Conexão do WhatsApp
      </div>

      {isLoading ? (
        <div className="py-6 text-sm text-muted-foreground">Carregando…</div>
      ) : connected ? (
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
      ) : status?.status === "error" ? (
        <div className="mt-4 py-6 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">
              {status?.lastError || "Não foi possível confirmar a conexão."}
            </span>
          </div>
          <Button onClick={handleConnectClick} disabled={connecting} className="rounded-full">
            {connecting ? "Conectando…" : "Tentar novamente"}
          </Button>
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
          <Button onClick={handleConnectClick} disabled={connecting} className="rounded-full">
            {connecting ? "Conectando…" : "Conectar WhatsApp"}
          </Button>
        </div>
      )}
    </section>
  );
}
