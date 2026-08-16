import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  conversations,
  HANDLER_LABEL,
  TAG_LABEL,
  whatsappStats,
  type ConversationHandler,
  type Conversation,
} from "@/lib/whatsapp";
import { getWhatsAppStatus } from "@/lib/whatsapp/whatsapp.functions";
import type { WhatsAppConnectionStatus } from "@/lib/whatsapp/provider";
import {
  Search, MessageSquare, Bot, User2, CheckCheck, Circle, Sparkles,
  Signal, ChevronRight, Plus, AlertTriangle, Clock3, CheckCircle2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CONNECTION_LABEL: Record<WhatsAppConnectionStatus, string> = {
  pending: "WhatsApp não configurado ainda",
  connecting: "Conectando WhatsApp…",
  connected: "WhatsApp conectado",
  disconnected: "WhatsApp desconectado",
  error: "Erro na conexão do WhatsApp",
};

const CONNECTION_ICON: Record<WhatsAppConnectionStatus, typeof Signal> = {
  pending: AlertTriangle,
  connecting: Clock3,
  connected: CheckCircle2,
  disconnected: AlertTriangle,
  error: AlertTriangle,
};

const CONNECTION_TONE: Record<WhatsAppConnectionStatus, string> = {
  pending: "text-muted-foreground",
  connecting: "text-amber-600 dark:text-amber-400",
  connected: "text-emerald-500",
  disconnected: "text-muted-foreground",
  error: "text-rose-600 dark:text-rose-400",
};

export const Route = createFileRoute("/_authenticated/whatsapp/")({
  component: WhatsAppInbox,
});

type Filter = "all" | ConversationHandler;

function WhatsAppInbox() {
  const fetchStatus = useServerFn(getWhatsAppStatus);
  const { data: status } = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: () => fetchStatus(),
  });
  const connectionStatus = status?.status ?? "pending";
  const ConnectionIcon = CONNECTION_ICON[connectionStatus];

  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c = { all: conversations.length, ai: 0, human: 0, done: 0 };
    for (const conv of conversations) c[conv.handler]++;
    return c;
  }, []);

  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      if (filter !== "all" && c.handler !== filter) return false;
      if (q && !c.clientName.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [filter, q]);

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight">
              Central de conversas
            </h1>
            <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-dashed border-amber-300 dark:border-amber-800">
              Dados de exemplo
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            <ConnectionIcon className={cn("w-3.5 h-3.5", CONNECTION_TONE[connectionStatus])} />
            {CONNECTION_LABEL[connectionStatus]}
            {status?.phoneNumber ? ` · ${status.phoneNumber}` : ""}
          </p>
          <p className="text-xs text-muted-foreground/80 mt-1">
            As conversas abaixo são exemplos ilustrativos — ainda não refletem mensagens reais de clientes.
          </p>
        </div>
        <Link
          to="/whatsapp/config"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-foreground text-background text-sm font-medium self-start md:self-auto"
        >
          <Sparkles className="w-4 h-4" /> Recepcionista IA
        </Link>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Abertas" value={String(whatsappStats.openConversations)} />
        <MiniStat label="IA respondendo" value={String(counts.ai)} tone="ai" />
        <MiniStat label="Preciso de mim" value={String(counts.human)} tone="human" />
        <MiniStat
          label="Tempo médio resposta"
          value={`${whatsappStats.avgResponseSec}s`}
          tone="positive"
        />
      </section>

      <section className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar conversa ou cliente"
            className="pl-9 h-11 rounded-xl bg-secondary/40 border-border/50"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            Todas · {counts.all}
          </Chip>
          <Chip active={filter === "ai"} onClick={() => setFilter("ai")}>
            IA respondendo · {counts.ai}
          </Chip>
          <Chip active={filter === "human"} onClick={() => setFilter("human")}>
            Preciso de mim · {counts.human}
          </Chip>
          <Chip active={filter === "done"} onClick={() => setFilter("done")}>
            Resolvidas · {counts.done}
          </Chip>
        </div>
      </section>

      <section className="space-y-2">
        {filtered.map((c) => (
          <ConversationRow key={c.id} c={c} />
        ))}
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            Nenhuma conversa encontrada.
          </div>
        )}
      </section>

      <button
        aria-label="Nova conversa"
        className="md:hidden fixed right-4 bottom-24 w-14 h-14 rounded-full bg-foreground text-background shadow-xl flex items-center justify-center"
      >
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
}

function MiniStat({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "ai" | "human";
}) {
  const color =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "ai"
      ? "text-sky-600 dark:text-sky-400"
      : tone === "human"
      ? "text-amber-600 dark:text-amber-400"
      : "";
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-2xl font-medium tracking-tight", color)}>{value}</div>
    </div>
  );
}

function Chip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 h-9 px-4 rounded-full text-xs font-medium border transition",
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-card border-border/60 text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function ConversationRow({ c }: { c: Conversation }) {
  const HandlerIcon =
    c.handler === "ai" ? Bot : c.handler === "human" ? User2 : CheckCheck;
  const handlerColor =
    c.handler === "ai"
      ? "bg-sky-500"
      : c.handler === "human"
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <Link
      to="/whatsapp/$id"
      params={{ id: c.id }}
      className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 hover:border-border transition"
    >
      <div className="relative shrink-0">
        <div className="w-11 h-11 rounded-xl bg-secondary flex items-center justify-center text-sm font-semibold">
          {c.initials}
        </div>
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-card flex items-center justify-center",
            handlerColor
          )}
        >
          <HandlerIcon className="w-2 h-2 text-white" strokeWidth={3} />
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{c.clientName}</span>
          {c.tag && (
            <span
              className={cn(
                "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                c.tag === "vip" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
                c.tag === "nova" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
                c.tag === "inativa" && "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
                c.tag === "recorrente" && "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
              )}
            >
              {TAG_LABEL[c.tag]}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {c.lastMessagePreview}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-[10px] text-muted-foreground">{c.time}</span>
        {c.unread > 0 ? (
          <span className="text-[10px] font-semibold px-1.5 h-4 min-w-4 rounded-full bg-emerald-500 text-white inline-flex items-center justify-center">
            {c.unread}
          </span>
        ) : (
          <span
            className={cn(
              "text-[9px] font-semibold px-1.5 py-0.5 rounded-full",
              c.handler === "ai" && "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
              c.handler === "human" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
              c.handler === "done" && "bg-secondary text-muted-foreground"
            )}
          >
            {HANDLER_LABEL[c.handler]}
          </span>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

// Suppress unused imports for icons kept for future variants
void [MessageSquare, Circle];