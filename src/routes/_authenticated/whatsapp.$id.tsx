import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  conversationById,
  sampleConversation,
  HANDLER_LABEL,
  type ChatMessage,
} from "@/lib/whatsapp";
import {
  ArrowLeft, Bot, User2, Send, Paperclip, Mic, MapPin, CreditCard,
  Calendar, ChevronRight, Info, Sparkles, CheckCheck, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/whatsapp/$id")({
  component: WhatsAppConversation,
});

function WhatsAppConversation() {
  const { id } = useParams({ from: "/_authenticated/whatsapp/$id" });
  const conv = conversationById(id);
  const [aiHandling, setAiHandling] = useState(conv?.handler !== "human");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(sampleConversation.messages);

  const sortedMessages = useMemo(() => messages, [messages]);

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

  const sendManual = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [
      ...m,
      {
        id: `local-${m.length}`,
        direction: "out",
        author: "you",
        kind: "text",
        content: text,
        time: "agora",
        status: "sent",
      },
    ]);
    setDraft("");
  };

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-0 lg:gap-6 max-w-6xl mx-auto lg:px-8 lg:py-6">
      {/* Chat column */}
      <div className="flex flex-col min-h-[calc(100vh-8rem)] lg:min-h-[calc(100vh-10rem)] lg:rounded-3xl lg:border lg:border-border/60 lg:bg-card lg:overflow-hidden">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-border/50 bg-background/80 backdrop-blur">
          <Link
            to="/whatsapp"
            aria-label="Voltar"
            className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center text-xs font-semibold shrink-0">
            {conv.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{conv.clientName}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {conv.lastAppointment ?? "Sem histórico recente"}
              {conv.nextMaintenance ? ` · Retorno ${conv.nextMaintenance}` : ""}
            </div>
          </div>
          <button
            aria-label="Perfil"
            className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center shrink-0"
          >
            <Info className="w-4 h-4" />
          </button>
        </header>

        {/* AI status bar */}
        <div
          className={cn(
            "flex items-center justify-between gap-3 px-4 md:px-5 py-2.5 border-b border-border/50",
            aiHandling
              ? "bg-sky-50 dark:bg-sky-950/30"
              : "bg-amber-50 dark:bg-amber-950/30"
          )}
        >
          <div className="flex items-center gap-2 text-xs">
            {aiHandling ? (
              <>
                <Bot className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span className="text-sky-900 dark:text-sky-200 font-medium">
                  Aura IA está atendendo esta conversa
                </span>
              </>
            ) : (
              <>
                <User2 className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span className="text-amber-900 dark:text-amber-200 font-medium">
                  Você assumiu esta conversa
                </span>
              </>
            )}
          </div>
          <button
            onClick={() => setAiHandling((v) => !v)}
            className="text-[11px] font-semibold underline underline-offset-2"
          >
            {aiHandling ? "Assumir" : "Devolver para Aura"}
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-3 bg-secondary/30 lg:bg-secondary/20">
          <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground py-2">
            Hoje
          </div>
          {sortedMessages.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}

          {/* CRM summary */}
          <div className="pt-4">
            <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground py-2">
              Resumo gerado para o CRM
            </div>
            <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-2">
              <SummaryRow label="Intenção detectada" value={sampleConversation.aiSummary.intent} />
              <SummaryRow label="Ação executada" value={sampleConversation.aiSummary.action} />
              <SummaryRow
                label="Agenda atualizada"
                value={sampleConversation.aiSummary.calendarUpdated ? "✓ Sim" : "—"}
              />
              <SummaryRow
                label="Confiança da IA"
                value={`${sampleConversation.aiSummary.confidence}%`}
              />
            </div>
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-border/50 bg-background px-3 md:px-5 py-3 space-y-2 sticky bottom-0">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            <QuickAction icon={Calendar} label="Agendar" />
            <QuickAction icon={CreditCard} label="Cobrar PIX" />
            <QuickAction icon={MapPin} label="Localização" />
            <QuickAction icon={Sparkles} label="Sugerir com IA" />
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Anexar"
              className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center shrink-0"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendManual()}
              placeholder={aiHandling ? "Assumir com uma mensagem..." : "Mensagem"}
              className="flex-1 h-11 px-4 rounded-full bg-secondary/60 border border-border/50 text-sm outline-none focus:border-border"
            />
            {draft.trim() ? (
              <button
                onClick={sendManual}
                aria-label="Enviar"
                className="w-10 h-10 rounded-full bg-foreground text-background flex items-center justify-center shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            ) : (
              <button
                aria-label="Áudio"
                className="w-10 h-10 rounded-full bg-foreground text-background flex items-center justify-center shrink-0"
              >
                <Mic className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Context panel */}
      <aside className="hidden lg:block space-y-3">
        <div className="rounded-3xl border border-border/60 bg-card p-5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Cliente</div>
          <div className="mt-2 text-lg font-medium">{conv.clientName}</div>
          <div className="text-xs text-muted-foreground">
            {HANDLER_LABEL[conv.handler]} · {conv.channel}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <PanelStat label="Gasto total" value={conv.spent ? `R$ ${conv.spent}` : "—"} />
            <PanelStat label="Última visita" value={conv.lastAppointment ?? "—"} />
          </div>
          <Link
            to="/clientes"
            className="mt-4 inline-flex items-center gap-1 text-xs font-medium hover:underline"
          >
            Abrir ficha completa <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="rounded-3xl border border-border/60 bg-card p-5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Ações da IA nesta conversa
          </div>
          <ul className="mt-3 space-y-2 text-xs">
            <li className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-500" /> Consultou agenda
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-500" /> Reservou horário
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-500" /> Atualizou financeiro (R$ 180)
            </li>
            <li className="flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-500" /> Enviou preparo do procedimento
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function PanelStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function QuickAction({
  icon: Icon, label,
}: {
  icon: typeof Calendar;
  label: string;
}) {
  return (
    <button className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-secondary text-xs font-medium text-muted-foreground hover:text-foreground">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isOut = m.direction === "out";
  const isAura = m.author === "aura";
  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
          isOut
            ? isAura
              ? "bg-foreground text-background rounded-br-md"
              : "bg-emerald-600 text-white rounded-br-md"
            : "bg-card border border-border/60 rounded-bl-md"
        )}
      >
        {isOut && isAura && (
          <div className="flex items-center gap-1 text-[10px] font-semibold opacity-70 mb-1">
            <Sparkles className="w-3 h-3" /> AURA IA
          </div>
        )}
        <div>{m.content}</div>
        {m.slots && m.slots.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.slots.map((s) => (
              <span
                key={s}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-background/15 border border-background/20"
              >
                {s}
              </span>
            ))}
          </div>
        )}
        <div
          className={cn(
            "mt-1 text-[10px] flex items-center gap-1 justify-end",
            isOut ? "opacity-70" : "text-muted-foreground"
          )}
        >
          {m.time}
          {isOut &&
            (m.status === "read" ? (
              <CheckCheck className="w-3 h-3 text-sky-300" />
            ) : m.status === "delivered" ? (
              <CheckCheck className="w-3 h-3" />
            ) : (
              <Check className="w-3 h-3" />
            ))}
        </div>
      </div>
    </div>
  );
}