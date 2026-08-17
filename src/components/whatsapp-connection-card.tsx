// Card de conexão do WhatsApp — fonte única de verdade da UI de conexão do
// AURA. A experiência pública de conexão passou a ser Meta Cloud API — este
// componente nunca chama evolutionWhatsAppProvider, createWhatsAppConnection
// nem nada específico de QR Code/pareamento; consome só
// getWhatsAppStatus/disconnectWhatsApp (já são provider-aware desde a PR
// #56, resolvem por whatsapp_instances.provider). Evolution continua
// funcionando no backend pra contas antigas já conectadas antes desta
// mudança — só não tem mais nenhum fluxo de reconexão self-service aqui.
//
// Estado "não conectado" (pending/disconnected/error/connecting, qualquer
// provider) sempre mostra o mesmo CTA "Conectar WhatsApp" — a UI nunca mais
// assume que existe QR Code ou código de pareamento por trás dele.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, AlertTriangle, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { disconnectWhatsApp, getWhatsAppStatus } from "@/lib/whatsapp/whatsapp.functions";

/** Número conectado vem do backend em E.164 (+55DDDNUMERO) — só exibição. */
function formatPhoneDisplayBR(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length <= 2) return local;
  if (local.length <= 7) return `(${local.slice(0, 2)}) ${local.slice(2)}`;
  return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
}

export function WhatsAppConnectionCard() {
  const qc = useQueryClient();
  const fetchStatus = useServerFn(getWhatsAppStatus);
  const disconnectFn = useServerFn(disconnectWhatsApp);

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

  /**
   * PONTO DE INTEGRAÇÃO DO EMBEDDED SIGNUP — ainda não implementado.
   *
   * Quando existir, este handler substitui o toast abaixo por: abrir o SDK
   * de Facebook Login configurado com o configuration_id do fluxo de
   * Embedded Signup da AURA (com a opção de coexistência habilitada) → a
   * profissional autoriza sua conta/WhatsApp Business → a Meta devolve um
   * "code" + waba_id + phone_number_id via callback → o backend troca o code
   * por um access token → chama uma função equivalente a
   * connectMetaWhatsAppManual (whatsapp-meta-admin.functions.ts), mas
   * disparada pelo próprio retorno do signup, nunca por um campo de texto
   * pedindo token/Phone Number ID pra profissional digitar → salva em
   * whatsapp_instances → invalida esta mesma query
   * (["whatsapp-status"]) pra refletir "conectado" imediatamente.
   *
   * Até o Embedded Signup existir, não simula nenhuma conexão — só avisa que
   * ainda não está disponível.
   */
  const handleConnectClick = () => {
    toast.info("Conectar WhatsApp estará disponível em breve.");
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
          <Button onClick={handleConnectClick} className="rounded-full">
            Conectar WhatsApp
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
          <Button onClick={handleConnectClick} className="rounded-full">
            Conectar WhatsApp
          </Button>
        </div>
      )}
    </section>
  );
}
