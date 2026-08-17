import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getConversationMessages,
  type ConversationMessage,
} from "@/lib/whatsapp/conversations.functions";
import { ArrowLeft, ChevronRight, Check, CheckCheck, Clock3, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/whatsapp/$id")({
  component: WhatsAppConversation,
});

const MESSAGE_TYPE_LABEL: Record<string, string> = {
  appointment_confirmation: "Confirmação de agendamento",
  appointment_reminder_24h: "Lembrete 24h",
  appointment_reminder_2h: "Lembrete 2h",
  confirmation_reply: "Resposta automática",
  test: "Mensagem de teste",
};

/** id da rota: "client:<uuid>" (cliente identificada) ou "phone:<dígitos>" (contato ainda não cadastrado). */
function parseConversationId(id: string): { clientId?: string; phone?: string } {
  if (id.startsWith("client:")) return { clientId: id.slice("client:".length) };
  if (id.startsWith("phone:")) return { phone: id.slice("phone:".length) };
  return {};
}

function initialsFor(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-2) || "?";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function WhatsAppConversation() {
  const { id } = useParams({ from: "/_authenticated/whatsapp/$id" });
  const { clientId, phone } = parseConversationId(id);

  const fetchMessages = useServerFn(getConversationMessages);
  const { data: conv, isLoading } = useQuery({
    queryKey: ["whatsapp-conversation", id],
    queryFn: () => fetchMessages({ data: { clientId, phone } }),
    // Mesmo motivo/intervalo do polling da lista (ver whatsapp.index.tsx) —
    // Realtime não funciona hoje sem uma policy de SELECT que ainda não
    // existe em whatsapp_messages para `authenticated`.
    refetchInterval: 6000,
  });

  if (isLoading) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Carregando…</div>;
  }

  if (!conv) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        Conversa não encontrada.
        <div className="mt-4">
          <Link to="/whatsapp" className="underline">
            Voltar para a central
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-0 lg:gap-6 max-w-6xl mx-auto lg:px-8 lg:py-6">
      {/* Chat column */}
      <div className="flex flex-col min-h-[calc(100vh-8rem)] lg:min-h-[calc(100vh-10rem)] lg:rounded-3xl lg:border lg:border-border/60 lg:bg-card lg:overflow-hidden">
        <header className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-border/50 bg-background/80 backdrop-blur">
          <Link
            to="/whatsapp"
            aria-label="Voltar"
            className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-xs font-semibold shrink-0">
            {initialsFor(conv.clientName, conv.phone)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">
              {conv.clientName ?? "Contato não identificado"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">{conv.phone}</div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-3 bg-secondary/30 lg:bg-secondary/20">
          {conv.messages.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
        </div>

        {/* Envio manual ainda não disponível — nunca simular uma mensagem
            enviada sem que ela seja de fato entregue via WhatsAppMessageService. */}
        <div className="border-t border-border/50 bg-background px-4 py-3 text-center text-xs text-muted-foreground sticky bottom-0">
          Envio de mensagens pela Central ainda não está disponível nesta etapa.
        </div>
      </div>

      {/* Context panel */}
      <aside className="hidden lg:block space-y-3">
        <div className="rounded-3xl border border-border/60 bg-card p-5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Contato</div>
          <div className="mt-2 text-lg font-medium">
            {conv.clientName ?? "Contato não identificado"}
          </div>
          <div className="text-xs text-muted-foreground">{conv.phone}</div>
          {conv.clientId && (
            <Link
              to="/clientes/$id"
              params={{ id: conv.clientId }}
              className="mt-4 inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              Abrir ficha completa <ChevronRight className="w-3 h-3" />
            </Link>
          )}
          {!conv.clientId && (
            <p className="mt-4 text-xs text-muted-foreground">
              Este número ainda não está cadastrado como cliente.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function MessageBubble({ m }: { m: ConversationMessage }) {
  const isOut = m.direction === "out";
  const typeLabel = isOut ? MESSAGE_TYPE_LABEL[m.messageType] : undefined;
  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
          isOut
            ? "bg-foreground text-background rounded-br-md"
            : "bg-card border border-border/60 rounded-bl-md",
        )}
      >
        {typeLabel && <div className="text-[10px] font-semibold opacity-70 mb-1">{typeLabel}</div>}
        <div>{m.content || "(sem conteúdo)"}</div>
        <div
          className={cn(
            "mt-1 text-[10px] flex items-center gap-1 justify-end",
            isOut ? "opacity-70" : "text-muted-foreground",
          )}
        >
          {formatTime(m.at)}
          {isOut && <StatusIcon status={m.status} />}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "read") return <CheckCheck className="w-3 h-3 text-sky-300" />;
  if (status === "delivered") return <CheckCheck className="w-3 h-3" />;
  if (status === "sent") return <Check className="w-3 h-3" />;
  if (status === "failed") return <AlertTriangle className="w-3 h-3 text-rose-400" />;
  return <Clock3 className="w-3 h-3" />;
}
